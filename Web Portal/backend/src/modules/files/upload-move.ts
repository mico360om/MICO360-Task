import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseUploadKey } from './upload-paths';

/**
 * 1.23.38 Upload folders (docs/superpowers/specs/2026-11-18-upload-folders-design.md, "Moving the existing
 * files"): every stored file whose key isn't its folder key yet is moved, at start-up and daily, on one
 * instance (job lock "upload-folders"):
 *
 *   1. copy it to its new key (written whole under another name, then renamed into place);
 *   2. read the copy back: the same size and SHA-256 as the original, else the copy is removed, the Error
 *      log says so, and the file stays where it is;
 *   3. point its database rows at the new key and record old → new in file_key_aliases (one transaction);
 *   4. the original stays: `/uploads/<old key>` still works, and the sweep removes it 30 days later.
 *
 * The new key is the old file's own UUID in its folders, so a run that stopped half way finds the same copy
 * next time (a copy already there with the same bytes is not written again). A missing file is logged and
 * left; nothing is deleted before its copy is verified; a second start finds nothing to do.
 */

export type MoveArea = 'uploads' | 'training';

/** A database row that keeps a stored file (how the store updates it is its own business). */
export interface MoveRowRef {
  table: string;
  id: string;
}

export interface PlannedMove {
  area: MoveArea;
  oldKey: string;
  newKey: string;
  rows: MoveRowRef[];
}

export interface AliasRow {
  id: string;
  area: MoveArea;
  oldKey: string;
  newKey: string;
  movedAt: Date;
  originalRemovedAt: Date | null;
}

export interface MoveStore {
  /** Every file that should move now (rows grouped by area, old key and new key). */
  plan(): Promise<PlannedMove[]>;
  /**
   * Point the rows that still have the old key at the new one and record the alias (unless one is there),
   * in one transaction; the number of rows changed (0: none keeps that key any more — no alias recorded).
   */
  commit(move: PlannedMove): Promise<number>;
  /** Aliases whose original is still on disk, moved at or before `before`. */
  aliasesToSweep(before: Date, limit: number): Promise<AliasRow[]>;
  /** Does any row still point at this key (an undone merge can bring an old name back)? */
  stillUsed(area: MoveArea, key: string): Promise<boolean>;
  markSwept(aliasId: string, at: Date): Promise<void>;
}

export interface UploadMoverDeps {
  store: MoveStore;
  dirs: Record<MoveArea, string>;
  logger: { info(m: string, c?: Record<string, unknown>): void; warn(m: string, c?: Record<string, unknown>): void; error(m: string, c?: Record<string, unknown>): void };
  now?: () => Date;
  /** The server is stopping: finish the file in hand, start no other. */
  shouldStop?: () => boolean;
  /** Testing only: stand-ins for the file reads. */
  fs?: { readFile?: (path: string) => Promise<Buffer> };
}

export const ORIGINALS_KEPT_DAYS = 30;
const SWEEP_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The path of an old name inside its folder: one of our keys, or a plain old name with nothing odd in it. */
export function pathInside(dir: string, key: string): string | null {
  const parsed = parseUploadKey(key);
  if (parsed) return join(dir, ...parsed.key.split('/'));
  if (typeof key !== 'string' || key.length === 0 || key.length > 200) return null;
  if (/[/\\\0%]/.test(key) || key.includes('..') || key.startsWith('.')) return null;
  return join(dir, key);
}

const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const isMissing = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ENOENT';

export function createUploadMover(deps: UploadMoverDeps) {
  const now = deps.now ?? (() => new Date());
  const read = deps.fs?.readFile ?? ((p: string) => fsp.readFile(p));
  const log = deps.logger;

  async function moveOne(m: PlannedMove): Promise<'moved' | 'missing' | 'failed' | 'gone'> {
    const dir = deps.dirs[m.area];
    const from = pathInside(dir, m.oldKey);
    const to = parseUploadKey(m.newKey) ? join(dir, ...m.newKey.split('/')) : null;
    const where = { area: m.area, storageKey: m.oldKey, newKey: m.newKey };
    if (!from || !to) {
      log.error('Upload folders: a stored name isn’t one this server makes; the file was not moved', where);
      return 'failed';
    }
    let original: Buffer;
    try {
      original = await read(from);
    } catch (err) {
      if (isMissing(err)) {
        log.error('Upload folders: a file to move is missing from the disk; its record is left as it is', where);
        return 'missing';
      }
      log.error('Upload folders: a file could not be read; it was not moved', { ...where, err });
      return 'failed';
    }
    const want = { size: original.length, sha256: digest(original) };
    // A copy already there (a run that stopped after copying) is kept when it is the same bytes.
    let there: Buffer | null = null;
    try {
      there = await read(to);
    } catch {
      there = null;
    }
    if (!there || there.length !== want.size || digest(there) !== want.sha256) {
      const part = join(dirname(to), `.${randomUUID()}.part`);
      try {
        await fsp.mkdir(dirname(to), { recursive: true });
        await fsp.writeFile(part, original);
        await fsp.rename(part, to);
      } catch (err) {
        await fsp.rm(part, { force: true }).catch(() => {});
        log.error('Upload folders: a file could not be copied to its folder; it was not moved', { ...where, err });
        return 'failed';
      }
    }
    // Verify what the disk now holds before any record points at it.
    let copy: Buffer | null = null;
    try {
      copy = await read(to);
    } catch {
      copy = null;
    }
    if (!copy || copy.length !== want.size || digest(copy) !== want.sha256) {
      await fsp.rm(to, { force: true }).catch(() => {});
      log.error('Upload folders: the copy’s size or checksum did not match; the file was not moved', { ...where, size: want.size, copySize: copy?.length ?? null });
      return 'failed';
    }
    let changed: number;
    try {
      changed = await deps.store.commit(m);
    } catch (err) {
      // The copy stays (the next run finds it); the rows still point at the original, which still works.
      log.error('Upload folders: a moved file’s record could not be saved; it is tried again next run', { ...where, err });
      return 'failed';
    }
    if (changed === 0) {
      // Nothing keeps the old name any more (deleted while it was copied): the copy isn't kept either.
      await fsp.rm(to, { force: true }).catch(() => {});
      return 'gone';
    }
    return 'moved';
  }

  /** Move every file that isn't in its folder yet. */
  async function run(): Promise<{ planned: number; moved: number; missing: number; failed: number; gone: number }> {
    const plan = await deps.store.plan();
    const result = { planned: plan.length, moved: 0, missing: 0, failed: 0, gone: 0 };
    for (const m of plan) {
      if (deps.shouldStop?.()) break;
      result[await moveOne(m)] += 1;
    }
    return result;
  }

  /** Remove originals moved more than 30 days ago (and an old face copy); the aliases stay for old links. */
  async function sweep(): Promise<{ removed: number; kept: number; failed: number }> {
    const result = { removed: 0, kept: 0, failed: 0 };
    const before = new Date(now().getTime() - ORIGINALS_KEPT_DAYS * DAY_MS);
    const due = await deps.store.aliasesToSweep(before, SWEEP_BATCH);
    for (const a of due) {
      if (deps.shouldStop?.()) break;
      if (await deps.store.stillUsed(a.area, a.oldKey)) {
        // Something points at the old name again: left for the next move.
        result.kept += 1;
        continue;
      }
      const dir = deps.dirs[a.area];
      const path = pathInside(dir, a.oldKey);
      try {
        if (path) await fsp.rm(path, { force: true });
        if (a.area === 'uploads' && path) await fsp.rm(join(dir, 'faces', ...a.oldKey.split('/')) + '.webp', { force: true });
        await deps.store.markSwept(a.id, now());
        result.removed += 1;
      } catch (err) {
        log.warn('Upload folders: an original could not be removed; it is tried again tomorrow', { area: a.area, storageKey: a.oldKey, err });
        result.failed += 1;
      }
    }
    return result;
  }

  return { run, sweep };
}

export type UploadMover = ReturnType<typeof createUploadMover>;
