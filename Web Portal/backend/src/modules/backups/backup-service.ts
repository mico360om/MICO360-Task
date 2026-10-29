import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ConflictError } from '../../lib/http-errors';
import { zonedDayKey } from '../../lib/due-date';
import type { ArchiveResult } from './backup-archive';
import { backupFileName, isBackupFileName, plainReason } from './backup-config';
import { BACKUP_KEY_MIN_LENGTH } from './backup-crypto';
import { BackupFailedError } from './backup-errors';
import type { BackupRepository, BackupRunLock, BackupRunRecord, BackupTrigger } from './backup-repository';
import { MAX_NIGHTLY_ATTEMPTS, NIGHTLY_HOUR, nightlyDue } from './nightly-schedule';
import { planBackupRetention, type CopyKind } from './retention';

export interface DriveState {
  /** GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set on this server. */
  configured: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  /** The connection stopped working (e.g. the access was taken back): connect again. */
  problem: string | null;
}

/** The Google Drive side of the backups (google-drive.ts + the stored connection). */
export interface BackupDrive {
  state(): Promise<DriveState>;
  upload(file: { path: string; name: string; sizeBytes: number; createdAt: Date; sha256: string; md5: string; manual: boolean }): Promise<{ fileId: string }>;
  /** Keep Drive's own copies by the same rule (7 nightly + 4 weekly, and the 3 newest "Back up now"). */
  applyRetention(opts: { timeZone: string; weekStart: 0 | 1 | 6 }): Promise<void>;
  /** A Drive failure in plain words. */
  plainError(err: unknown): string;
}

export interface BackupServiceDeps {
  repo: BackupRepository;
  lock: BackupRunLock;
  /** Makes one copy (writeBackupArchive with this server's database, uploads and key). */
  writeArchive: (o: { outFile: string; workDir: string; trigger: 'nightly' | 'manual' }) => Promise<ArchiveResult>;
  backupDir: string;
  /** Why the folder can't be used (it is served by the website), or null. */
  dirProblem?: string | null;
  /** The folder is inside the app folder, which a redeploy may replace. */
  dirInsideApp?: boolean;
  /** BACKUP_ENCRYPTION_KEY ('' = copies are not encrypted). */
  encryptionKey?: string;
  /** BACKUP_NIGHTLY (on unless turned off). */
  nightlyEnabled?: boolean;
  timeZone: string;
  /** The company week start (System Settings), for the weekly copies. */
  weekStart: () => Promise<0 | 1 | 6>;
  /** Bytes free where the copies go (null: unknown). */
  freeSpace?: (dir: string) => Promise<number | null>;
  /** About how many bytes a copy needs while it is made. */
  neededSpace?: () => Promise<number>;
  /** Emails the active administrators (best effort; not called when email isn't set up). */
  alertAdmins?: (alert: { title: string; message: string }) => Promise<void>;
  drive?: BackupDrive;
  now?: () => Date;
  logger?: { info(msg: string, ctx?: Record<string, unknown>): void; warn(msg: string, ctx?: Record<string, unknown>): void; error(msg: string, ctx?: Record<string, unknown>): void };
}

export interface BackupCopyView {
  id: string;
  fileName: string;
  createdAt: string;
  sizeBytes: number;
  kind: CopyKind;
  trigger: BackupTrigger;
  encrypted: boolean;
  drive: 'UPLOADED' | 'FAILED' | 'SKIPPED' | null;
  driveError: string | null;
}

export interface BackupOverview {
  folder: string;
  folderWarning: string | null;
  encrypted: boolean;
  nightly: { enabled: boolean; hour: number; timeZone: string };
  running: { id: string; trigger: BackupTrigger; startedAt: string } | null;
  lastSuccess: { at: string; sizeBytes: number } | null;
  warning: string | null;
  copies: BackupCopyView[];
  drive: DriveState & { warning: string | null };
}

/** A try that started this long ago while nothing holds the lock was stopped part-way. */
const STALE_AFTER_MS = 10 * 60 * 1000;
const NO_COPY_WARNING_MS = 36 * 60 * 60 * 1000;
const FORGET_FAILED_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const FORGET_MISSING_AFTER_MS = 60 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const STOPPED = 'It stopped before it finished (the server may have restarted).';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

const retentionCopy = (r: BackupRunRecord) => ({ id: r.id, createdAt: r.startedAt, manual: r.trigger === 'MANUAL' });

const failedText = (trigger: BackupTrigger) => (trigger === 'NIGHTLY' ? 'Last night’s backup failed' : 'The last backup failed');

export function createBackupService(deps: BackupServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const tz = deps.timeZone;
  const key = deps.encryptionKey ?? '';
  const nightlyEnabled = deps.nightlyEnabled ?? true;
  let current: Promise<void> | null = null;

  const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' });

  /** Tries left RUNNING by a server that stopped part-way are marked as failed. */
  async function reconcile(): Promise<void> {
    const running = await deps.repo.running();
    if (!running.length || (await deps.lock.isHeld(now()))) return;
    for (const r of running) {
      if (now().getTime() - r.startedAt.getTime() < STALE_AFTER_MS) continue;
      await deps.repo.updateIfRunning(r.id, { status: 'FAILED', error: STOPPED, finishedAt: now() });
    }
  }

  async function clearLeftovers(): Promise<void> {
    let names: string[] = [];
    try {
      names = await readdir(deps.backupDir);
    } catch {
      return;
    }
    for (const name of names) {
      const ours = (name.startsWith('mico360-tasks-backup-') && name.endsWith('.partial')) || name.startsWith('.work-');
      if (ours) await rm(join(deps.backupDir, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function checkReady(): Promise<void> {
    if (deps.dirProblem) throw new BackupFailedError(deps.dirProblem);
    if (key && key.length < BACKUP_KEY_MIN_LENGTH) {
      throw new BackupFailedError(`The backup key (BACKUP_ENCRYPTION_KEY) is too short — it needs at least ${BACKUP_KEY_MIN_LENGTH} characters.`);
    }
    await mkdir(deps.backupDir, { recursive: true });
    if (deps.freeSpace && deps.neededSpace) {
      const free = await deps.freeSpace(deps.backupDir).catch(() => null);
      if (free !== null) {
        const need = await deps.neededSpace();
        if (free < need) throw new BackupFailedError(`There isn’t enough free disk space for a backup: it needs about ${formatBytes(need)} and ${formatBytes(free)} are free.`);
      }
    }
  }

  async function alert(title: string, message: string): Promise<void> {
    try {
      await deps.alertAdmins?.({ title, message });
    } catch (err) {
      deps.logger?.warn('the backup alert email could not be sent', { err });
    }
  }

  /** The copies that are kept (good, with their file still in the folder), with their kind. */
  async function keptCopies(): Promise<{ row: BackupRunRecord; kind: CopyKind }[]> {
    const rows = (await deps.repo.ok()).filter((r) => r.fileName && isBackupFileName(r.fileName) && existsSync(join(deps.backupDir, r.fileName)));
    const plan = planBackupRetention(rows.map(retentionCopy), { timeZone: tz, weekStart: await deps.weekStart() });
    return rows.filter((r) => plan.keep.has(r.id)).map((row) => ({ row, kind: plan.keep.get(row.id)! }));
  }

  async function applyRetention(): Promise<void> {
    const at = now();
    const all = await deps.repo.ok();
    const present = all.filter((r) => r.fileName && isBackupFileName(r.fileName) && existsSync(join(deps.backupDir, r.fileName)));
    const weekStart = await deps.weekStart();
    const plan = planBackupRetention(present.map(retentionCopy), { timeZone: tz, weekStart });
    const gone: string[] = [];
    for (const id of plan.remove) {
      const row = present.find((r) => r.id === id)!;
      try {
        await unlink(join(deps.backupDir, row.fileName!));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          deps.logger?.warn('an old backup copy could not be deleted', { file: row.fileName, err });
          continue;
        }
      }
      gone.push(id);
    }
    // Rows of copies no longer in the folder (deleted by hand, or a restored database) are forgotten in time.
    for (const r of all) if (!present.includes(r) && at.getTime() - r.startedAt.getTime() > FORGET_MISSING_AFTER_MS) gone.push(r.id);
    if (gone.length) await deps.repo.remove(gone);
    await deps.repo.pruneFailed(new Date(at.getTime() - FORGET_FAILED_AFTER_MS));
    if (deps.drive && (await deps.drive.state()).connected) {
      try {
        await deps.drive.applyRetention({ timeZone: tz, weekStart });
      } catch (err) {
        deps.logger?.warn('old Google Drive copies could not be cleared', { err: deps.drive.plainError(err) });
      }
    }
  }

  async function sendToDrive(row: BackupRunRecord, result: ArchiveResult): Promise<void> {
    if (!deps.drive) return;
    const state = await deps.drive.state().catch(() => null);
    if (!state?.connected) return;
    try {
      const { fileId } = await deps.drive.upload({
        path: join(deps.backupDir, row.fileName!),
        name: row.fileName!,
        sizeBytes: result.sizeBytes,
        createdAt: row.startedAt,
        sha256: result.sha256,
        md5: result.md5,
        manual: row.trigger === 'MANUAL',
      });
      await deps.repo.update(row.id, { driveStatus: 'UPLOADED', driveFileId: fileId, driveError: null });
    } catch (err) {
      const reason = deps.drive.plainError(err);
      deps.logger?.error('a backup copy could not be sent to Google Drive', { file: row.fileName, reason });
      await deps.repo.update(row.id, { driveStatus: 'FAILED', driveError: reason });
      if (row.trigger === 'NIGHTLY') {
        await alert('Last night’s backup was not sent to Google Drive', `Last night’s copy was made and is kept on the server, but it couldn’t be sent to Google Drive: ${reason} Open System Settings → Backups to check the Google Drive connection.`);
      }
    }
  }

  /** Makes one copy from start to end (the caller already holds the lock and made the row). */
  async function work(row: BackupRunRecord): Promise<BackupRunRecord> {
    const beat = setInterval(() => void deps.lock.renew(now()).catch(() => undefined), HEARTBEAT_MS);
    beat.unref?.();
    try {
      await checkReady();
      await clearLeftovers();
      const fileName = backupFileName(row.startedAt, tz, row.id, Boolean(key));
      const result = await deps.writeArchive({
        outFile: join(deps.backupDir, fileName),
        workDir: join(deps.backupDir, `.work-${row.id}`),
        trigger: row.trigger === 'NIGHTLY' ? 'nightly' : 'manual',
      });
      const done = await deps.repo.update(row.id, {
        status: 'OK',
        finishedAt: now(),
        fileName,
        sizeBytes: result.sizeBytes,
        sha256: result.sha256,
        encrypted: result.encrypted || Boolean(key),
        tableCount: result.tables,
        rowCount: result.rows,
        fileCount: result.files,
        error: null,
      });
      deps.logger?.info('backup copy made', { file: fileName, bytes: result.sizeBytes, tables: result.tables, files: result.files });
      await sendToDrive(done, result);
      await applyRetention().catch((err) => deps.logger?.warn('old backup copies could not be cleared', { err }));
      return (await deps.repo.find(row.id)) ?? done;
    } catch (err) {
      const reason = plainReason(err);
      deps.logger?.error('backup failed', { err, reason, trigger: row.trigger });
      const failed = await deps.repo.update(row.id, { status: 'FAILED', finishedAt: now(), error: reason });
      if (row.trigger === 'NIGHTLY') {
        const tries = (await deps.repo.nightlyOn(row.localDate)).filter((r) => r.status === 'FAILED').length;
        if (tries >= MAX_NIGHTLY_ATTEMPTS) {
          await alert(
            failedText('NIGHTLY'),
            `Last night’s backup failed: ${reason} It was tried ${MAX_NIGHTLY_ATTEMPTS} times. Open System Settings → Backups and press "Back up now" once the problem is fixed.`,
          );
        }
      }
      return failed;
    } finally {
      clearInterval(beat);
      // Nothing half-made is left behind, whatever happened.
      await rm(join(deps.backupDir, `.work-${row.id}`), { recursive: true, force: true }).catch(() => undefined);
      await deps.lock.release().catch(() => undefined);
    }
  }

  async function begin(trigger: BackupTrigger, by: string | null): Promise<BackupRunRecord> {
    await reconcile();
    const startedAt = now();
    if (!(await deps.lock.acquire(startedAt))) throw new ConflictError('A backup is being made right now. Wait for it to finish.', 'BACKUP_RUNNING');
    try {
      return await deps.repo.create({ trigger, localDate: zonedDayKey(startedAt, tz), startedAt, requestedById: by });
    } catch (err) {
      await deps.lock.release().catch(() => undefined);
      throw err;
    }
  }

  return {
    /** "Back up now": starts a copy in the background and returns its row (RUNNING). */
    async start(by: string): Promise<BackupRunRecord> {
      const row = await begin('MANUAL', by);
      // In the background: nothing it throws may go unhandled (that would stop the server).
      current = work(row).then(
        () => undefined,
        (err: unknown) => deps.logger?.error('backup could not be finished', { err }),
      );
      return row;
    },

    /** Makes a copy and waits for it (the command-line tool). */
    async run(trigger: BackupTrigger, by: string | null = null): Promise<BackupRunRecord> {
      return work(await begin(trigger, by));
    },

    /** The nightly sweep: makes tonight's copy when it is due. True when it made (or tried) one. */
    async runNightlyIfDue(): Promise<boolean> {
      if (!nightlyEnabled) return false;
      await reconcile();
      const at = now();
      const today = await deps.repo.nightlyOn(zonedDayKey(at, tz));
      if (!nightlyDue({ now: at, timeZone: tz, today, running: await deps.lock.isHeld(at) })) return false;
      try {
        await work(await begin('NIGHTLY', null));
      } catch (err) {
        if (err instanceof ConflictError) return false; // another server started it a moment ago
        throw err;
      }
      return true;
    },

    /** Resolves once the copy started by `start` is finished. */
    async idle(): Promise<void> {
      await current;
    },

    applyRetention,

    /** The copy's file, when it is one of the kept copies and still in the folder. */
    async fileFor(id: string): Promise<{ path: string; fileName: string; sizeBytes: number } | null> {
      const row = await deps.repo.find(id);
      if (!row || row.status !== 'OK' || !row.fileName || !isBackupFileName(row.fileName)) return null;
      const path = join(deps.backupDir, row.fileName);
      if (!existsSync(path)) return null;
      return { path, fileName: row.fileName, sizeBytes: row.sizeBytes ?? 0 };
    },

    async overview(): Promise<BackupOverview> {
      await reconcile();
      const at = now();
      const [recent, kept, drive, held] = await Promise.all([
        deps.repo.recent(20),
        keptCopies(),
        deps.drive ? deps.drive.state().catch((): DriveState => ({ configured: true, connected: false, email: null, connectedAt: null, problem: null })) : Promise.resolve<DriveState>({ configured: false, connected: false, email: null, connectedAt: null, problem: null }),
        deps.lock.isHeld(at),
      ]);
      const running = recent.find((r) => r.status === 'RUNNING');
      const finished = recent.filter((r) => r.status !== 'RUNNING');
      // The last backup is the newest copy kept here (a restored database lists copies of another server).
      const lastOk = kept[0]?.row;
      const latest = finished[0];
      let warning: string | null = null;
      if (latest?.status === 'FAILED') warning = `${failedText(latest.trigger)}: ${latest.error ?? 'no reason was given.'}`;
      else if (lastOk && nightlyEnabled && at.getTime() - (lastOk.finishedAt ?? lastOk.startedAt).getTime() > NO_COPY_WARNING_MS) {
        warning = `No new copy has been made since ${dayFormat.format(lastOk.startedAt)}. Is the server running at night?`;
      }
      const newestKept = kept[0]?.row;
      const driveWarning =
        drive.problem ?? (drive.connected && newestKept?.driveStatus === 'FAILED' ? `The last copy wasn’t sent to Google Drive: ${newestKept.driveError ?? 'no reason was given.'}` : null);
      return {
        folder: deps.backupDir,
        folderWarning: deps.dirProblem ?? (deps.dirInsideApp ? 'The backup folder is inside the app folder, so a new deployment may remove it. Set BACKUP_DIR (or UPLOAD_DIR) to a folder outside the app.' : null),
        encrypted: Boolean(key),
        nightly: { enabled: nightlyEnabled, hour: NIGHTLY_HOUR, timeZone: tz },
        running: running && held ? { id: running.id, trigger: running.trigger, startedAt: running.startedAt.toISOString() } : null,
        lastSuccess: lastOk ? { at: (lastOk.finishedAt ?? lastOk.startedAt).toISOString(), sizeBytes: lastOk.sizeBytes ?? 0 } : null,
        warning,
        copies: kept.map(({ row, kind }) => ({
          id: row.id,
          fileName: row.fileName!,
          createdAt: row.startedAt.toISOString(),
          sizeBytes: row.sizeBytes ?? 0,
          kind,
          trigger: row.trigger,
          encrypted: row.encrypted,
          drive: row.driveStatus,
          driveError: row.driveError,
        })),
        drive: { ...drive, warning: driveWarning },
      };
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
