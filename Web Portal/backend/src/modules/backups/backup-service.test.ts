import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Writable } from 'node:stream';
import { createBackupService, type BackupDrive, type BackupServiceDeps } from './backup-service';
import type { BackupRepository, BackupRunLock, BackupRunRecord } from './backup-repository';
import { writeBackupArchive, type ArchiveResult } from './backup-archive';
import { fakeSqlRunner, fillingDisk } from './backup-fakes';
import { ConflictError } from '../../lib/http-errors';

/** Fails the test instead of waiting forever when `p` never settles. */
function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`still running after ${ms} ms: it hangs`)), ms)))]).finally(() => clearTimeout(timer));
}

// ── in-memory fakes ──────────────────────────────────────────────────────────
function memoryRepo(): BackupRepository & { rows: BackupRunRecord[] } {
  const rows: BackupRunRecord[] = [];
  let n = 0;
  const newest = (list: BackupRunRecord[]) => [...list].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return {
    rows,
    async create(d) {
      const row: BackupRunRecord = {
        id: `run${String(++n).padStart(6, '0')}`,
        trigger: d.trigger,
        status: 'RUNNING',
        localDate: d.localDate,
        startedAt: d.startedAt,
        finishedAt: null,
        fileName: null,
        sizeBytes: null,
        sha256: null,
        encrypted: false,
        tableCount: null,
        rowCount: null,
        fileCount: null,
        error: null,
        driveStatus: null,
        driveFileId: null,
        driveError: null,
        requestedById: d.requestedById,
      };
      rows.push(row);
      return { ...row };
    },
    async update(id, change) {
      const row = rows.find((r) => r.id === id)!;
      Object.assign(row, change);
      return { ...row };
    },
    async updateIfRunning(id, change) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== 'RUNNING') return false;
      Object.assign(row, change);
      return true;
    },
    async find(id) {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },
    async recent(limit) {
      return newest(rows).slice(0, limit);
    },
    async ok() {
      return newest(rows.filter((r) => r.status === 'OK'));
    },
    async running() {
      return rows.filter((r) => r.status === 'RUNNING');
    },
    async nightlyOn(day) {
      return rows.filter((r) => r.trigger === 'NIGHTLY' && r.localDate === day);
    },
    async remove(ids) {
      for (const id of ids) rows.splice(rows.findIndex((r) => r.id === id), 1);
    },
    async pruneFailed(before) {
      const gone = rows.filter((r) => r.status === 'FAILED' && r.startedAt < before);
      for (const g of gone) rows.splice(rows.indexOf(g), 1);
      return gone.length;
    },
  };
}

function memoryLock(): BackupRunLock & { held: boolean } {
  return {
    held: false,
    async acquire() {
      if (this.held) return false;
      this.held = true;
      return true;
    },
    async renew() {},
    async release() {
      this.held = false;
    },
    async isHeld() {
      return this.held;
    },
  };
}

const muscat = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+04:00`);

let dir: string;
let clock: Date;
let repo: ReturnType<typeof memoryRepo>;
let lock: ReturnType<typeof memoryLock>;
let alerts: { title: string; message: string }[];
let archiveCalls: number;
let archiveFails: Error | null;
let gate: Promise<void> | null;

const goodArchive = async (o: { outFile: string; workDir: string }): Promise<ArchiveResult> => {
  archiveCalls += 1;
  mkdirSync(o.workDir, { recursive: true });
  if (gate) await gate;
  if (archiveFails) throw archiveFails;
  writeFileSync(o.outFile, 'archive bytes');
  return { sizeBytes: 13, sha256: 'a'.repeat(64), md5: 'b'.repeat(32), tables: 64, rows: 1000, files: 5, fileBytes: 999, latestMigration: 'm', encrypted: false };
};

let noCopyMark: string | null;

function service(extra: Partial<BackupServiceDeps> = {}) {
  return createBackupService({
    repo,
    lock,
    writeArchive: goodArchive,
    backupDir: dir,
    timeZone: 'Asia/Muscat',
    weekStart: async () => 0,
    now: () => clock,
    alertAdmins: async (a) => {
      alerts.push(a);
    },
    noCopyAlertMark: {
      read: async () => noCopyMark,
      write: async (v) => {
        noCopyMark = v;
      },
    },
    ...extra,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mico-bk-svc-'));
  clock = muscat('2026-10-30', '02:05');
  repo = memoryRepo();
  lock = memoryLock();
  alerts = [];
  archiveCalls = 0;
  archiveFails = null;
  gate = null;
  noCopyMark = null;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Back up now', () => {
  it('starts a copy in the background: RUNNING, then OK with its file, size and counts', async () => {
    const svc = service();
    const started = await svc.start('admin1');
    expect(started).toMatchObject({ status: 'RUNNING', trigger: 'MANUAL', requestedById: 'admin1', localDate: '2026-10-30' });
    await svc.idle();
    const [row] = repo.rows;
    expect(row).toMatchObject({ status: 'OK', sizeBytes: 13, sha256: 'a'.repeat(64), tableCount: 64, rowCount: 1000, fileCount: 5, encrypted: false, error: null });
    expect(row!.fileName).toMatch(/^mico360-tasks-backup-2026-10-30-0205-[a-z0-9]{6}\.tar\.gz$/);
    expect(existsSync(join(dir, row!.fileName!))).toBe(true);
    expect(lock.held).toBe(false);
    expect(alerts).toEqual([]);
  });

  it('only one copy at a time: a second press while one is being made is refused (409)', async () => {
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const svc = service();
    await svc.start('admin1');
    await expect(svc.start('admin2')).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.start('admin2')).rejects.toMatchObject({ status: 409, code: 'BACKUP_RUNNING' });
    open();
    await svc.idle();
    expect(archiveCalls).toBe(1);
  });

  it('a failure is kept with its plain reason, leaves no file behind, and emails nobody (the admin sees it)', async () => {
    archiveFails = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    const svc = service();
    await svc.start('admin1');
    await svc.idle();
    expect(repo.rows[0]).toMatchObject({ status: 'FAILED', error: 'The server’s disk is full.', fileName: null });
    expect(readdirSync(dir)).toEqual([]);
    expect(alerts).toEqual([]);
    expect((await svc.overview()).warning).toBe('The last backup failed: The server’s disk is full.');
  });

  it('even when the result can’t be written down (the database is gone), a background copy never crashes the server', async () => {
    archiveFails = new Error('boom');
    const broken = { ...repo, update: async () => { throw new Error('database gone'); } };
    const errors: string[] = [];
    const svc = service({ repo: broken, logger: { info() {}, warn() {}, error: (msg: string) => errors.push(msg) } });
    await svc.start('admin1');
    await expect(svc.idle()).resolves.toBeUndefined();
    expect(errors).toContain('backup could not be finished');
    expect(lock.held).toBe(false);
  });

  it('checks the free space first: a short disk is refused before anything is written', async () => {
    const svc = service({ freeSpace: async () => 10 * 1024 * 1024, neededSpace: async () => 300 * 1024 * 1024 });
    await svc.start('admin1');
    await svc.idle();
    expect(archiveCalls).toBe(0);
    expect(repo.rows[0]!.error).toBe('There isn’t enough free disk space for a backup: it needs about 300 MB and 10 MB are free.');
  });

  it('refuses a backup folder the website serves, with the reason', async () => {
    const svc = service({ dirProblem: 'The backup folder is inside the uploads folder, which the website serves. Set BACKUP_DIR to a private folder outside it.' });
    await svc.start('admin1');
    await svc.idle();
    expect(archiveCalls).toBe(0);
    expect(repo.rows[0]!.error).toMatch(/inside the uploads folder/);
  });

  it('refuses a backup key that is too short (so no copy is made with a weak key)', async () => {
    const svc = service({ encryptionKey: 'short' });
    await svc.start('admin1');
    await svc.idle();
    expect(archiveCalls).toBe(0);
    expect(repo.rows[0]!.error).toMatch(/BACKUP_ENCRYPTION_KEY.*16 characters/);
  });

  it('clears what a stopped copy left behind (.partial files and work folders), never anything else', async () => {
    writeFileSync(join(dir, 'mico360-tasks-backup-2026-10-29-0200-aaaaaa.tar.gz.partial'), 'half');
    mkdirSync(join(dir, '.work-old'));
    writeFileSync(join(dir, 'mico360-20261029-020000.sql'), 'tray dump');
    const svc = service();
    await svc.start('admin1');
    await svc.idle();
    const left = readdirSync(dir).sort();
    expect(left).toContain('mico360-20261029-020000.sql');
    expect(left.some((f) => f.endsWith('.partial') || f.startsWith('.work-'))).toBe(false);
  });

  it('a copy still running after the time limit is stopped: FAILED with the reason, the lock is free, the next copy works', async () => {
    let hung: AbortSignal | undefined;
    const svc = service({
      maxRunMs: 50,
      writeArchive: async (o) => {
        if (archiveCalls++ === 0) {
          hung = o.signal;
          mkdirSync(o.workDir, { recursive: true });
          writeFileSync(`${o.outFile}.partial`, 'half');
          return new Promise<ArchiveResult>(() => undefined); // never ends, and doesn't listen to the signal
        }
        writeFileSync(o.outFile, 'archive bytes');
        return { sizeBytes: 13, sha256: 'a'.repeat(64), md5: 'b'.repeat(32), tables: 64, rows: 1000, files: 5, fileBytes: 999, latestMigration: 'm', encrypted: false };
      },
    });
    await svc.start('admin1');
    await within(5000, svc.idle());
    expect(repo.rows[0]).toMatchObject({ status: 'FAILED', error: 'The backup was stopped: it was still running after 1 minute.' });
    expect(hung?.aborted).toBe(true);
    expect(lock.held).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    await svc.start('admin1');
    await within(5000, svc.idle());
    expect(repo.rows[1]).toMatchObject({ status: 'OK' });
  });
});

describe('a disk that fills up while the copy is written (the real archive writer)', () => {
  let uploads: string;
  beforeEach(() => {
    uploads = mkdtempSync(join(tmpdir(), 'mico-bk-svc-up-'));
    writeFileSync(join(uploads, 'photo.bin'), randomBytes(1024 * 1024));
  });
  afterEach(() => rmSync(uploads, { recursive: true, force: true }));

  it.each([
    ['at the first byte', 0, 0],
    ['at the first byte, failing a moment later', 0, 5],
    ['part-way through', 200 * 1024, 0],
    ['part-way through, failing a moment later', 200 * 1024, 5],
  ])('%s: the run ends FAILED ("disk is full"), no .partial is left, and the next copy can be made', async (_when, limit, delayMs) => {
    let disk: ((path: string) => Writable) | null = fillingDisk(limit, { delayMs });
    const sql = fakeSqlRunner([{ name: 'notes', columns: [{ name: 'id', type: 'varchar' }, { name: 'body', type: 'text' }], primaryKey: ['id'], rows: [['n1', 'hello']] }]);
    const svc = service({
      writeArchive: (o) => writeBackupArchive({ ...o, sql, uploadDir: uploads, appVersion: 't', openWrite: (path) => (disk && path.endsWith('.partial') ? disk(path) : createWriteStream(path)) }),
    });
    await svc.start('admin1');
    await within(5000, svc.idle());
    expect(repo.rows[0]).toMatchObject({ status: 'FAILED', error: 'The server’s disk is full.', fileName: null });
    expect(readdirSync(dir)).toEqual([]);
    expect(lock.held).toBe(false);
    expect((await svc.overview()).running).toBeNull();

    disk = null;
    await svc.start('admin1');
    await within(5000, svc.idle());
    expect(repo.rows[1]).toMatchObject({ status: 'OK' });
    expect(readdirSync(dir)).toEqual([repo.rows[1]!.fileName]);
  });
});

describe('the nightly copy', () => {
  it('is made once a night from 02:00 company time', async () => {
    const svc = service();
    clock = muscat('2026-10-30', '01:55');
    expect(await svc.runNightlyIfDue()).toBe(false);
    clock = muscat('2026-10-30', '02:05');
    expect(await svc.runNightlyIfDue()).toBe(true);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({ trigger: 'NIGHTLY', status: 'OK', requestedById: null });
    clock = muscat('2026-10-30', '03:00');
    expect(await svc.runNightlyIfDue()).toBe(false);
  });

  it('can be turned off (BACKUP_NIGHTLY=false)', async () => {
    expect(await service({ nightlyEnabled: false }).runNightlyIfDue()).toBe(false);
    expect(repo.rows).toHaveLength(0);
  });

  it('after a failure it tries again an hour later; only the third failure emails the administrators', async () => {
    archiveFails = new Error('ETIMEDOUT');
    const svc = service();
    for (const [hhmm, emailed] of [['02:00', 0], ['03:01', 0], ['04:02', 1]] as const) {
      clock = muscat('2026-10-30', hhmm);
      expect(await svc.runNightlyIfDue()).toBe(true);
      expect(alerts).toHaveLength(emailed);
    }
    clock = muscat('2026-10-30', '05:03');
    expect(await svc.runNightlyIfDue()).toBe(false);
    expect(alerts[0]!.title).toBe('Last night’s backup failed');
    expect(alerts[0]!.message).toMatch(/Something went wrong while making the copy/);
    expect(alerts[0]!.message).toMatch(/tried 3 times/);
    expect((await svc.overview()).warning).toBe('Last night’s backup failed: Something went wrong while making the copy (the server log has the details).');
  });

  it('a later good copy clears the warning', async () => {
    archiveFails = new Error('boom');
    const svc = service();
    await svc.runNightlyIfDue();
    archiveFails = null;
    clock = muscat('2026-10-30', '10:00');
    await svc.start('admin1');
    await svc.idle();
    expect((await svc.overview()).warning).toBeNull();
  });
});

describe('Google Drive copy', () => {
  function fakeDrive(fail: Error | null = null): BackupDrive & { uploads: string[]; retained: number } {
    return {
      uploads: [],
      retained: 0,
      async state() {
        return { configured: true, connected: true, stored: true, email: 'owner@gmail.com', connectedAt: '2026-10-29T10:00:00.000Z', problem: null };
      },
      async upload(f) {
        if (fail) throw fail;
        this.uploads.push(`${f.name}${f.manual ? ' (manual)' : ''}`);
        return { fileId: `drive-${f.name}` };
      },
      async applyRetention() {
        this.retained += 1;
      },
      plainError: (err) => (err as Error).message,
    };
  }

  it('each new copy is sent to Drive and Drive’s copies are kept to 7 + 4 as well', async () => {
    const drive = fakeDrive();
    const svc = service({ drive });
    await svc.runNightlyIfDue();
    expect(repo.rows[0]).toMatchObject({ driveStatus: 'UPLOADED', driveFileId: `drive-${repo.rows[0]!.fileName}` });
    expect(drive.uploads).toEqual([repo.rows[0]!.fileName]);
    expect(drive.retained).toBe(1);
  });

  it('a failed upload keeps the copy on the server, says why, and emails the administrators after a nightly copy', async () => {
    const svc = service({ drive: fakeDrive(new Error('Google Drive is full.')) });
    await svc.runNightlyIfDue();
    expect(repo.rows[0]).toMatchObject({ status: 'OK', driveStatus: 'FAILED', driveError: 'Google Drive is full.' });
    expect(alerts).toEqual([{ title: 'Last night’s backup was not sent to Google Drive', message: expect.stringContaining('Google Drive is full.') }]);
    expect((await svc.overview()).drive.warning).toBe('The last copy wasn’t sent to Google Drive: Google Drive is full.');
  });

  it('Drive not connected: the copy is made and marked as not sent (no warning)', async () => {
    const drive = { ...fakeDrive(), state: async () => ({ configured: true, connected: false, stored: false, email: null, connectedAt: null, problem: null }) };
    const svc = service({ drive });
    await svc.runNightlyIfDue();
    expect(repo.rows[0]).toMatchObject({ status: 'OK', driveStatus: null });
    expect((await svc.overview()).drive.warning).toBeNull();
  });
});

describe('keeping 7 nightly + 4 weekly copies', () => {
  async function seedCopies(days: string[]) {
    for (const d of days) {
      const row = await repo.create({ trigger: 'NIGHTLY', localDate: d, startedAt: muscat(d, '02:00'), requestedById: null });
      const fileName = `mico360-tasks-backup-${d}-0200-${row.id.slice(-6)}.tar.gz`;
      writeFileSync(join(dir, fileName), d);
      await repo.update(row.id, { status: 'OK', fileName, sizeBytes: 10, finishedAt: muscat(d, '02:01') });
    }
  }
  const daysBetween = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
    return out;
  };

  it('deletes the older copies’ files and rows, and nothing else in the folder', async () => {
    await seedCopies(daysBetween('2026-09-20', '2026-10-30'));
    writeFileSync(join(dir, 'mico360-20261001-020000.sql'), 'the Windows tray’s own dump');
    clock = muscat('2026-10-30', '09:00');
    await service().applyRetention();
    expect(repo.rows.map((r) => r.localDate).sort()).toEqual(['2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17', ...daysBetween('2026-10-24', '2026-10-30')]);
    const files = readdirSync(dir);
    expect(files).toHaveLength(12);
    expect(files).toContain('mico360-20261001-020000.sql');
  });

  it('"Back up now" never pushes out the night’s copy; the 3 newest "Back up now" copies are kept on top', async () => {
    const svc = service();
    clock = muscat('2026-10-30', '02:05');
    await svc.runNightlyIfDue();
    for (const hhmm of ['10:00', '11:00', '12:00', '13:00']) {
      clock = muscat('2026-10-30', hhmm);
      await svc.start('admin1');
      await svc.idle();
    }
    const kept = (await svc.overview()).copies;
    expect(kept.map((c) => [c.kind, c.trigger])).toEqual([
      ['manual', 'MANUAL'],
      ['manual', 'MANUAL'],
      ['manual', 'MANUAL'],
      ['nightly', 'NIGHTLY'],
    ]);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tar.gz'))).toHaveLength(4);
  });

  it('runs after every good copy; failed tries older than 30 days are forgotten', async () => {
    await seedCopies(daysBetween('2026-10-01', '2026-10-29'));
    const old = await repo.create({ trigger: 'NIGHTLY', localDate: '2026-09-01', startedAt: muscat('2026-09-01', '02:00'), requestedById: null });
    await repo.update(old.id, { status: 'FAILED', error: 'x' });
    await service().runNightlyIfDue();
    // 1–30 October: the 7 nights of 24–30 October, then the weeks of 11, 4 and 1–3 October (no older week yet).
    expect(repo.rows.filter((r) => r.status === 'OK').map((r) => r.localDate).sort()).toEqual(['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(repo.rows.find((r) => r.id === old.id)).toBeUndefined();
  });

  it('lists the kept copies newest first with their kind (nightly / weekly) and Drive state', async () => {
    await seedCopies(daysBetween('2026-09-20', '2026-10-30'));
    clock = muscat('2026-10-30', '09:00');
    const svc = service();
    await svc.applyRetention();
    const view = await svc.overview();
    expect(view.copies).toHaveLength(11);
    expect(view.copies[0]).toMatchObject({ kind: 'nightly', sizeBytes: 10, trigger: 'NIGHTLY', drive: null });
    expect(view.copies.map((c) => c.kind)).toEqual([...Array(7).fill('nightly'), ...Array(4).fill('weekly')]);
    expect(view.lastSuccess).toEqual({ at: muscat('2026-10-30', '02:01').toISOString(), sizeBytes: 10 });
    expect(view.warning).toBeNull();
    // What the kept copies take on the server's disk, all together.
    expect(view.keptBytes).toBe(110);
  });

  it('a copy that isn’t in this server’s folder (a restored database on a new server) is not "the last backup"', async () => {
    const row = await repo.create({ trigger: 'NIGHTLY', localDate: '2026-10-29', startedAt: muscat('2026-10-29', '02:00'), requestedById: null });
    await repo.update(row.id, { status: 'OK', fileName: `mico360-tasks-backup-2026-10-29-0200-${row.id.slice(-6)}.tar.gz`, sizeBytes: 5, finishedAt: muscat('2026-10-29', '02:01') });
    clock = muscat('2026-10-29', '09:00');
    const view = await service().overview();
    expect(view.copies).toEqual([]);
    expect(view.lastSuccess).toBeNull();
    expect(view.warning).toBeNull();
  });

  it('a copy whose file is gone from the folder is not listed and can’t be downloaded', async () => {
    await seedCopies(['2026-10-29', '2026-10-30']);
    rmSync(join(dir, repo.rows[1]!.fileName!));
    const svc = service();
    expect((await svc.overview()).copies.map((c) => c.id)).toEqual([repo.rows[0]!.id]);
    expect(await svc.fileFor(repo.rows[1]!.id)).toBeNull();
    expect(await svc.fileFor(repo.rows[0]!.id)).toMatchObject({ fileName: repo.rows[0]!.fileName, path: join(dir, repo.rows[0]!.fileName!) });
    // The size sent with a download is the file's own, whatever the row says.
    await repo.update(repo.rows[0]!.id, { sizeBytes: 999 });
    expect((await svc.fileFor(repo.rows[0]!.id))!.sizeBytes).toBe(10);
  });
});

describe('the overview for System Settings', () => {
  it('a try left RUNNING by a server that stopped is shown as stopped once nothing is running', async () => {
    const row = await repo.create({ trigger: 'NIGHTLY', localDate: '2026-10-30', startedAt: muscat('2026-10-30', '02:00'), requestedById: null });
    clock = muscat('2026-10-30', '02:30');
    const view = await service().overview();
    expect(view.running).toBeNull();
    expect((await repo.find(row.id))!.status).toBe('FAILED');
    expect(view.warning).toBe('Last night’s backup failed: It stopped before it finished (the server may have restarted).');
  });

  it('says where the copies are, whether they are encrypted, the nightly time, and a copy being made', async () => {
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const svc = service({ encryptionKey: 'a long enough backup key', dirInsideApp: true });
    await svc.start('admin1');
    const view = await svc.overview();
    expect(view).toMatchObject({ folder: dir, encrypted: true, nightly: { enabled: true, hour: 2, timeZone: 'Asia/Muscat' }, running: { trigger: 'MANUAL' } });
    expect(view.folderWarning).toMatch(/inside the app folder/);
    open();
    await svc.idle();
    expect(repo.rows[0]!.fileName).toMatch(/\.tar\.gz\.enc$/);
  });

  it('warns when there has been no new copy for more than a day and a half', async () => {
    const row = await repo.create({ trigger: 'NIGHTLY', localDate: '2026-10-27', startedAt: muscat('2026-10-27', '02:00'), requestedById: null });
    const fileName = `mico360-tasks-backup-2026-10-27-0200-${row.id.slice(-6)}.tar.gz`;
    writeFileSync(join(dir, fileName), 'x');
    await repo.update(row.id, { status: 'OK', fileName, sizeBytes: 1, finishedAt: muscat('2026-10-27', '02:01') });
    clock = muscat('2026-10-30', '09:00');
    expect((await service().overview()).warning).toBe('No new copy has been made since 27 Oct 2026. Is the server running at night?');
  });
});

describe('telling the administrators when copies stop', () => {
  /** A nightly try that a server left RUNNING when it was stopped (a restart, a deploy, out of memory). */
  const leftRunning = (day: string, hhmm: string) => repo.create({ trigger: 'NIGHTLY', localDate: day, startedAt: muscat(day, hhmm), requestedById: null });
  const failedTry = async (day: string, hhmm: string) => {
    const r = await leftRunning(day, hhmm);
    await repo.update(r.id, { status: 'FAILED', error: 'boom', finishedAt: muscat(day, hhmm) });
  };
  const STOPPED = 'It stopped before it finished (the server may have restarted).';

  it('the night’s last try cut short by a stopped server: marked failed and every administrator is emailed, once', async () => {
    await failedTry('2026-10-30', '02:00');
    await failedTry('2026-10-30', '03:01');
    await leftRunning('2026-10-30', '04:02');
    clock = muscat('2026-10-30', '04:30');
    const svc = service();
    expect(await svc.runNightlyIfDue()).toBe(false);
    expect(repo.rows[2]).toMatchObject({ status: 'FAILED', error: STOPPED });
    expect(alerts).toEqual([{ title: 'Last night’s backup failed', message: expect.stringContaining(`Last night’s backup failed: ${STOPPED} It was tried 3 times.`) }]);
    await svc.runNightlyIfDue();
    await svc.overview();
    expect(alerts).toHaveLength(1);
  });

  it('found by the System Settings page instead of the nightly check: the same email', async () => {
    await failedTry('2026-10-30', '02:00');
    await failedTry('2026-10-30', '03:01');
    await leftRunning('2026-10-30', '04:02');
    clock = muscat('2026-10-30', '04:30');
    await service().overview();
    expect(alerts.map((a) => a.title)).toEqual(['Last night’s backup failed']);
  });

  it('an earlier try cut short is retried, not emailed about', async () => {
    await leftRunning('2026-10-30', '02:00');
    clock = muscat('2026-10-30', '02:30');
    await service().overview();
    expect(repo.rows[0]).toMatchObject({ status: 'FAILED', error: STOPPED });
    expect(alerts).toEqual([]);
  });

  it('a "Back up now" cut short is shown, not emailed', async () => {
    await repo.create({ trigger: 'MANUAL', localDate: '2026-10-30', startedAt: muscat('2026-10-30', '10:00'), requestedById: 'admin1' });
    clock = muscat('2026-10-30', '10:30');
    await service().overview();
    expect(alerts).toEqual([]);
  });

  async function goodCopy(day: string) {
    const row = await repo.create({ trigger: 'NIGHTLY', localDate: day, startedAt: muscat(day, '02:00'), requestedById: null });
    const fileName = `mico360-tasks-backup-${day}-0200-${row.id.slice(-6)}.tar.gz`;
    writeFileSync(join(dir, fileName), 'x');
    await repo.update(row.id, { status: 'OK', fileName, sizeBytes: 1, finishedAt: muscat(day, '02:01') });
  }

  it('no new copy for a day and a half: the administrators are emailed once, and again only after a good copy', async () => {
    await goodCopy('2026-10-27');
    // 01:00: tonight's copy isn't due yet, and the last one is from three nights ago.
    clock = muscat('2026-10-30', '01:00');
    const svc = service();
    await svc.runNightlyIfDue();
    expect(alerts).toEqual([
      {
        title: 'No new backup copy since 27 Oct 2026',
        message: 'No new backup copy has been made since 27 Oct 2026. Is the server running at night? Open System Settings → Backups to check, and press "Back up now" to make one.',
      },
    ]);
    clock = muscat('2026-10-30', '01:10');
    await svc.runNightlyIfDue();
    expect(alerts).toHaveLength(1);

    // A good copy resets it; when copies stop again, the email comes again.
    clock = muscat('2026-10-30', '02:05');
    await svc.runNightlyIfDue();
    expect(repo.rows.filter((r) => r.status === 'OK')).toHaveLength(2);
    expect(alerts).toHaveLength(1);
    clock = muscat('2026-11-01', '01:00');
    await svc.runNightlyIfDue();
    expect(alerts.map((a) => a.title)).toEqual(['No new backup copy since 27 Oct 2026', 'No new backup copy since 30 Oct 2026']);
  });

  it('no email about it while the nightly copy is off, or before a day and a half', async () => {
    await goodCopy('2026-10-29');
    clock = muscat('2026-10-30', '01:00');
    await service().runNightlyIfDue();
    clock = muscat('2026-11-02', '01:00');
    await service({ nightlyEnabled: false }).runNightlyIfDue();
    expect(alerts).toEqual([]);
  });
});
