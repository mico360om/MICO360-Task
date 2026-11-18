import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUploadMover, ORIGINALS_KEPT_DAYS, type MoveStore, type PlannedMove, type AliasRow } from './upload-move';

// 1.23.38 Upload folders (design "Moving the existing files"): copy each file to its new path, check that the
// size and checksum match, point its rows at it and record old → new — resumable, idempotent, never deleting
// before the copy is verified; a missing file or a bad copy is logged and left where it is; originals go
// after 30 days.

const UUID1 = '1b4e28ba-2d11-4a2e-8c3b-0f5b2b6e9a10';
const UUID2 = '2b4e28ba-2d11-4a2e-8c3b-0f5b2b6e9a10';
const UUID3 = '3b4e28ba-2d11-4a2e-8c3b-0f5b2b6e9a10';
const DAY = 24 * 60 * 60 * 1000;

let root: string;
let uploads: string;
let training: string;
beforeEach(() => {
  now = Date.parse('2026-11-18T10:00:00Z');
  root = mkdtempSync(join(tmpdir(), 'uf-move-'));
  uploads = join(root, 'uploads');
  training = join(root, 'training-files');
  mkdirSync(uploads, { recursive: true });
  mkdirSync(training, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A small database: rows (key per row) and the alias table; the plan is every row whose key isn't its wanted one. */
function fakeStore(rows: { id: string; area: 'uploads' | 'training'; key: string; want: string }[]) {
  const aliases: AliasRow[] = [];
  let failCommit = 0;
  const store: MoveStore & { rows: typeof rows; aliases: AliasRow[]; failNextCommits(n: number): void } = {
    rows,
    aliases,
    failNextCommits(n) {
      failCommit = n;
    },
    async plan() {
      const groups = new Map<string, PlannedMove>();
      for (const r of rows) {
        if (r.key === r.want) continue;
        const id = `${r.area}|${r.key}|${r.want}`;
        const g = groups.get(id) ?? { area: r.area, oldKey: r.key, newKey: r.want, rows: [] };
        g.rows.push({ table: 'attachment', id: r.id });
        groups.set(id, g);
      }
      return [...groups.values()];
    },
    async commit(move) {
      if (failCommit > 0) {
        failCommit--;
        throw new Error('database went away');
      }
      let n = 0;
      for (const r of rows) {
        if (r.area === move.area && r.key === move.oldKey && move.rows.some((x) => x.id === r.id)) {
          r.key = move.newKey;
          n++;
        }
      }
      if (n > 0 && !aliases.some((a) => a.area === move.area && a.oldKey === move.oldKey)) {
        aliases.push({ id: `a${aliases.length + 1}`, area: move.area, oldKey: move.oldKey, newKey: move.newKey, movedAt: new Date(now), originalRemovedAt: null });
      }
      return n;
    },
    async aliasesToSweep(before, limit) {
      return aliases.filter((a) => a.originalRemovedAt === null && a.movedAt.getTime() <= before.getTime()).slice(0, limit);
    },
    async stillUsed(area, key) {
      return rows.some((r) => r.area === area && r.key === key);
    },
    async markSwept(id, at) {
      const a = aliases.find((x) => x.id === id)!;
      a.originalRemovedAt = at;
    },
  };
  return store;
}

let now = Date.parse('2026-11-18T10:00:00Z');
const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function put(dir: string, key: string, content: string) {
  const p = join(dir, ...key.split('/'));
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
}
const at = (dir: string, key: string) => join(dir, ...key.split('/'));

describe('moving the existing files', () => {
  it('copies, checks, points the rows at the copy and records the alias; the original stays (30 days)', async () => {
    put(uploads, `${UUID1}.pdf`, 'task file');
    put(training, `${UUID2}.png`, 'step picture');
    const store = fakeStore([
      { id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` },
      { id: 'r2', area: 'training', key: `${UUID2}.png`, want: `shared/2026/11/u1/learning-hub/${UUID2}.png` },
    ]);
    const log = logger();
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: log, now: () => new Date(now) });
    const result = await mover.run();
    expect(result).toMatchObject({ moved: 2, missing: 0, failed: 0 });
    expect(readFileSync(at(uploads, `coA/2026/11/u1/task-files/${UUID1}.pdf`), 'utf8')).toBe('task file');
    expect(readFileSync(at(training, `shared/2026/11/u1/learning-hub/${UUID2}.png`), 'utf8')).toBe('step picture');
    expect(store.rows.map((r) => r.key)).toEqual([`coA/2026/11/u1/task-files/${UUID1}.pdf`, `shared/2026/11/u1/learning-hub/${UUID2}.png`]);
    expect(store.aliases.map((a) => [a.area, a.oldKey, a.newKey])).toEqual([
      ['uploads', `${UUID1}.pdf`, `coA/2026/11/u1/task-files/${UUID1}.pdf`],
      ['training', `${UUID2}.png`, `shared/2026/11/u1/learning-hub/${UUID2}.png`],
    ]);
    // Nothing is deleted at the move.
    expect(existsSync(at(uploads, `${UUID1}.pdf`))).toBe(true);
    expect(existsSync(at(training, `${UUID2}.png`))).toBe(true);
  });

  it('a second start changes nothing', async () => {
    put(uploads, `${UUID1}.pdf`, 'task file');
    const store = fakeStore([{ id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` }]);
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: logger(), now: () => new Date(now) });
    await mover.run();
    const again = await mover.run();
    expect(again).toMatchObject({ moved: 0, missing: 0, failed: 0, planned: 0 });
    expect(store.aliases).toHaveLength(1);
  });

  it('is resumable: a run that stopped after the copy finds the same copy next time and finishes', async () => {
    put(uploads, `${UUID1}.pdf`, 'task file');
    const store = fakeStore([{ id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` }]);
    const log = logger();
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: log, now: () => new Date(now) });
    store.failNextCommits(1);
    const first = await mover.run();
    expect(first).toMatchObject({ moved: 0, failed: 1 });
    expect(store.rows[0]!.key).toBe(`${UUID1}.pdf`); // the row still points at the original, which still works
    expect(existsSync(at(uploads, `coA/2026/11/u1/task-files/${UUID1}.pdf`))).toBe(true);
    const second = await mover.run();
    expect(second).toMatchObject({ moved: 1, failed: 0 });
    expect(store.rows[0]!.key).toBe(`coA/2026/11/u1/task-files/${UUID1}.pdf`);
    expect(store.aliases).toHaveLength(1);
  });

  it('a half-written copy from a stopped run is written again', async () => {
    put(uploads, `${UUID1}.pdf`, 'task file');
    put(uploads, `coA/2026/11/u1/task-files/${UUID1}.pdf`, 'task f'); // cut short
    const store = fakeStore([{ id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` }]);
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: logger(), now: () => new Date(now) });
    expect(await mover.run()).toMatchObject({ moved: 1 });
    expect(readFileSync(at(uploads, `coA/2026/11/u1/task-files/${UUID1}.pdf`), 'utf8')).toBe('task file');
  });

  it('a missing original is logged (the Error log) and left as it is; the rest go on', async () => {
    put(uploads, `${UUID2}.pdf`, 'there');
    const store = fakeStore([
      { id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` },
      { id: 'r2', area: 'uploads', key: `${UUID2}.pdf`, want: `coA/2026/11/u1/task-files/${UUID2}.pdf` },
    ]);
    const log = logger();
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: log, now: () => new Date(now) });
    expect(await mover.run()).toMatchObject({ moved: 1, missing: 1, failed: 0 });
    expect(store.rows[0]!.key).toBe(`${UUID1}.pdf`);
    expect(store.rows[1]!.key).toBe(`coA/2026/11/u1/task-files/${UUID2}.pdf`);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/missing/i), expect.objectContaining({ storageKey: `${UUID1}.pdf` }));
  });

  it('a copy whose size or checksum doesn’t match is not moved: removed, logged, the row untouched', async () => {
    put(uploads, `${UUID1}.pdf`, 'task file');
    const store = fakeStore([{ id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` }]);
    const log = logger();
    const realRead = (await import('node:fs/promises')).readFile;
    const mover = createUploadMover({
      store,
      dirs: { uploads, training },
      logger: log,
      now: () => new Date(now),
      // The disk gives back something else for the copy (a failing disk, a full one).
      fs: { readFile: async (p: string) => (p.includes('task-files') ? Buffer.from('task fil?') : realRead(p)) },
    });
    expect(await mover.run()).toMatchObject({ moved: 0, failed: 1 });
    expect(store.rows[0]!.key).toBe(`${UUID1}.pdf`);
    expect(store.aliases).toHaveLength(0);
    expect(existsSync(at(uploads, `coA/2026/11/u1/task-files/${UUID1}.pdf`))).toBe(false);
    expect(existsSync(at(uploads, `${UUID1}.pdf`))).toBe(true);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/checksum/i), expect.objectContaining({ storageKey: `${UUID1}.pdf` }));
  });

  it('refuses a key that could leave the folder (never read or written)', async () => {
    const store = fakeStore([{ id: 'r1', area: 'uploads', key: '../outside.pdf', want: `coA/2026/11/u1/task-files/${UUID1}.pdf` }]);
    const log = logger();
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: log, now: () => new Date(now) });
    expect(await mover.run()).toMatchObject({ moved: 0, failed: 1 });
    expect(store.rows[0]!.key).toBe('../outside.pdf');
  });

  it('a row deleted while its file was being copied: the copy is removed, no alias', async () => {
    put(uploads, `${UUID1}.pdf`, 'task file');
    const store = fakeStore([{ id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` }]);
    const commit = store.commit;
    store.commit = async (m) => {
      store.rows.length = 0; // the task's file was deleted meanwhile
      return commit(m);
    };
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: logger(), now: () => new Date(now) });
    expect(await mover.run()).toMatchObject({ moved: 0 });
    expect(existsSync(at(uploads, `coA/2026/11/u1/task-files/${UUID1}.pdf`))).toBe(false);
    expect(store.aliases).toHaveLength(0);
  });

  it('stops between files when the server stops', async () => {
    put(uploads, `${UUID1}.pdf`, 'a');
    put(uploads, `${UUID2}.pdf`, 'b');
    const store = fakeStore([
      { id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` },
      { id: 'r2', area: 'uploads', key: `${UUID2}.pdf`, want: `coA/2026/11/u1/task-files/${UUID2}.pdf` },
    ]);
    let stop = false;
    const commit = store.commit;
    store.commit = async (m) => {
      stop = true;
      return commit(m);
    };
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: logger(), now: () => new Date(now), shouldStop: () => stop });
    expect(await mover.run()).toMatchObject({ moved: 1 });
  });
});

describe('the 30-day sweep of originals', () => {
  async function moved() {
    const PHOTO = `${UUID3}.png`;
    put(uploads, `${UUID1}.pdf`, 'task file');
    put(uploads, PHOTO, 'photo');
    put(uploads, `faces/${PHOTO}.webp`, 'old face');
    put(training, `${UUID2}.png`, 'step');
    const store = fakeStore([
      { id: 'r1', area: 'uploads', key: `${UUID1}.pdf`, want: `coA/2026/11/u1/task-files/${UUID1}.pdf` },
      { id: 'r2', area: 'uploads', key: PHOTO, want: `shared/2026/11/u1/profile-photos/${PHOTO}` },
      { id: 'r3', area: 'training', key: `${UUID2}.png`, want: `shared/2026/11/u1/learning-hub/${UUID2}.png` },
    ]);
    const mover = createUploadMover({ store, dirs: { uploads, training }, logger: logger(), now: () => new Date(now) });
    await mover.run();
    return { store, mover, PHOTO };
  }

  it('keeps originals for 30 days', async () => {
    const { mover } = await moved();
    now += (ORIGINALS_KEPT_DAYS - 1) * DAY;
    expect(await mover.sweep()).toMatchObject({ removed: 0 });
    expect(existsSync(at(uploads, `${UUID1}.pdf`))).toBe(true);
  });

  it('then removes them (and an old face copy), once; the moved files and old links stay', async () => {
    const { store, mover, PHOTO } = await moved();
    now += (ORIGINALS_KEPT_DAYS + 1) * DAY;
    expect(await mover.sweep()).toMatchObject({ removed: 3 });
    expect(existsSync(at(uploads, `${UUID1}.pdf`))).toBe(false);
    expect(existsSync(at(uploads, PHOTO))).toBe(false);
    expect(existsSync(at(uploads, `faces/${PHOTO}.webp`))).toBe(false);
    expect(existsSync(at(training, `${UUID2}.png`))).toBe(false);
    expect(existsSync(at(uploads, `coA/2026/11/u1/task-files/${UUID1}.pdf`))).toBe(true);
    expect(store.aliases).toHaveLength(3); // the aliases stay: old links keep working
    expect(store.aliases.every((a) => a.originalRemovedAt !== null)).toBe(true);
    expect(await mover.sweep()).toMatchObject({ removed: 0 });
  });

  it('never removes an original something points at again (an undone merge restored the old name)', async () => {
    const { store, mover } = await moved();
    store.rows[0]!.key = `${UUID1}.pdf`;
    store.rows[0]!.want = `${UUID1}.pdf`; // (as the planner sees it until the next move)
    now += (ORIGINALS_KEPT_DAYS + 1) * DAY;
    const r = await mover.sweep();
    expect(r.kept).toBe(1);
    expect(existsSync(at(uploads, `${UUID1}.pdf`))).toBe(true);
  });
});
