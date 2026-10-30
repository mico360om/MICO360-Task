import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
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
  /** Set up here and a connection is stored: new copies go to Drive. */
  connected: boolean;
  /** A connection is stored (also one this server can't use, being without the Google settings). */
  stored: boolean;
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
  /**
   * Makes one copy (writeBackupArchive with this server's database, uploads and key). `signal` says
   * the copy ran out of time: stop and leave nothing behind.
   */
  writeArchive: (o: { outFile: string; workDir: string; trigger: 'nightly' | 'manual'; signal?: AbortSignal }) => Promise<ArchiveResult>;
  /** The longest a copy may take (3 hours); after it the copy is stopped and marked failed. */
  maxRunMs?: number;
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
  /**
   * What each once-only email was last sent about (kept in system_settings), so it goes out once when
   * its problem first appears, and again only after the problem cleared and came back.
   */
  notices?: BackupNotices;
  /** NODE_ENV=production: unlocked copies (no BACKUP_ENCRYPTION_KEY) are warned about there. */
  production?: boolean;
  /** BACKUP_WARN_GB in bytes: kept copies taking more than this in all bring a warning (5 GB). */
  warnBytes?: number;
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

/** The once-only emails: no new copy for 36 hours, copies not locked with a key, disk space. */
export type BackupNoticeName = 'noCopy' | 'unlocked' | 'space';

export interface BackupNotices {
  read(name: BackupNoticeName): Promise<string | null>;
  /** null: the problem cleared (the next time it appears, it is emailed again). */
  write(name: BackupNoticeName, value: string | null): Promise<void>;
}

/** The once-only marks, all in one stored value (a system_settings row the settings API never shows). */
export function noticesIn(kv: { read(): Promise<unknown>; write(value: unknown): Promise<void> }): BackupNotices {
  const all = async (): Promise<Record<string, string>> => {
    const v = await kv.read();
    return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, string>) } : {};
  };
  return {
    async read(name) {
      const v = (await all())[name];
      return typeof v === 'string' ? v : null;
    },
    async write(name, value) {
      const marks = await all();
      if (value === null) delete marks[name];
      else marks[name] = value;
      await kv.write(marks);
    },
  };
}

export interface BackupOverview {
  folder: string;
  folderWarning: string | null;
  /** In production without BACKUP_ENCRYPTION_KEY: the copies aren't locked, and what to do. */
  keyWarning: string | null;
  /** The kept copies take more than BACKUP_WARN_GB, or the free space is short: what to do. */
  spaceWarning: string | null;
  encrypted: boolean;
  nightly: { enabled: boolean; hour: number; timeZone: string };
  running: { id: string; trigger: BackupTrigger; startedAt: string } | null;
  lastSuccess: { at: string; sizeBytes: number } | null;
  warning: string | null;
  copies: BackupCopyView[];
  /** What the kept copies take on the server's disk, all together. */
  keptBytes: number;
  drive: DriveState & { warning: string | null };
}

/** A try that started this long ago while nothing holds the lock was stopped part-way. */
const STALE_AFTER_MS = 10 * 60 * 1000;
const NO_COPY_WARNING_MS = 36 * 60 * 60 * 1000;
const FORGET_FAILED_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const FORGET_MISSING_AFTER_MS = 60 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
/** A copy still being made after this long is stopped (a hung disk or database must not hold the lock forever). */
const MAX_RUN_MS = 3 * 60 * 60 * 1000;
const STOPPED = 'It stopped before it finished (the server may have restarted).';
/** BACKUP_WARN_GB when it isn't set: 5 GB. */
const DEFAULT_WARN_BYTES = 5 * 1024 * 1024 * 1024;

const UNLOCKED_WARNING =
  'Backup copies aren’t locked with a backup key, so anyone who gets one (a downloaded copy, or the Google Drive folder) can read everything in it. ' +
  'To lock them: make a key (docs/BACKUPS.md, “Locking the copies”), set it as BACKUP_ENCRYPTION_KEY in the hosting settings, restart the app, ' +
  'and keep a copy of the key in a password manager — not in Google Drive. Keep it safe: without the key a locked copy can’t be opened.';

const SPACE_ADVICE =
  'Check the server’s disk use (on Hostinger: hPanel → the website’s Dashboard → Disk usage), remove old uploaded files that are no longer needed, or ask for fewer backup copies to be kept.';

function durationText(ms: number): string {
  if (ms >= 60 * 60 * 1000) {
    const h = Math.round(ms / (60 * 60 * 1000));
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const m = Math.max(1, Math.round(ms / (60 * 1000)));
  return `${m} minute${m === 1 ? '' : 's'}`;
}

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
  const maxRunMs = deps.maxRunMs ?? MAX_RUN_MS;
  const warnBytes = deps.warnBytes ?? DEFAULT_WARN_BYTES;
  let current: Promise<void> | null = null;

  const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' });

  /**
   * Tries left RUNNING by a server that stopped part-way (a restart, a deployment, out of memory) are
   * marked as failed — and when that was the night's last try, the administrators are told, as for
   * any other failed night. Only the server that marks the row sends it (updateIfRunning), so once.
   */
  async function reconcile(): Promise<void> {
    const running = await deps.repo.running();
    if (!running.length || (await deps.lock.isHeld(now()))) return;
    for (const r of running) {
      if (now().getTime() - r.startedAt.getTime() < STALE_AFTER_MS) continue;
      const marked = await deps.repo.updateIfRunning(r.id, { status: 'FAILED', error: STOPPED, finishedAt: now() });
      if (marked && r.trigger === 'NIGHTLY') await afterNightlyFailure(r.localDate, STOPPED);
    }
  }

  /** A nightly try failed: when it was the night's last, every administrator gets an email. */
  async function afterNightlyFailure(localDate: string, reason: string): Promise<void> {
    const tries = (await deps.repo.nightlyOn(localDate)).filter((r) => r.status === 'FAILED').length;
    if (tries < MAX_NIGHTLY_ATTEMPTS) return;
    await alert(
      failedText('NIGHTLY'),
      `Last night’s backup failed: ${reason} It was tried ${MAX_NIGHTLY_ATTEMPTS} times. Open System Settings → Backups and press "Back up now" once the problem is fixed.`,
    );
  }

  /**
   * The warning System Settings shows: the last try failed, or no new copy for a day and a half
   * (`staleSince` is then the copy the warning is about).
   */
  function warningFor(recent: BackupRunRecord[], lastOk: BackupRunRecord | undefined, at: Date): { text: string | null; staleSince: BackupRunRecord | null } {
    const latest = recent.find((r) => r.status !== 'RUNNING');
    if (latest?.status === 'FAILED') return { text: `${failedText(latest.trigger)}: ${latest.error ?? 'no reason was given.'}`, staleSince: null };
    if (lastOk && nightlyEnabled && at.getTime() - (lastOk.finishedAt ?? lastOk.startedAt).getTime() > NO_COPY_WARNING_MS) {
      return { text: `No new copy has been made since ${dayFormat.format(lastOk.startedAt)}. Is the server running at night?`, staleSince: lastOk };
    }
    return { text: null, staleSince: null };
  }

  /** The "no new copy" warning, emailed once when it first appears (again only after a newer good copy). */
  async function emailIfNoNewCopy(): Promise<void> {
    if (!deps.notices || !nightlyEnabled) return;
    const [recent, kept] = await Promise.all([deps.repo.recent(20), keptCopies()]);
    const { staleSince } = warningFor(recent, kept[0]?.row, now());
    if (!staleSince || (await deps.notices.read('noCopy')) === staleSince.id) return;
    const since = dayFormat.format(staleSince.startedAt);
    await alert(
      `No new backup copy since ${since}`,
      `No new backup copy has been made since ${since}. Is the server running at night? Open System Settings → Backups to check, and press "Back up now" to make one.`,
    );
    await deps.notices.write('noCopy', staleSince.id);
  }

  /** In production, copies made without BACKUP_ENCRYPTION_KEY: they aren't locked, and what to do. */
  const keyWarning = deps.production && !key ? UNLOCKED_WARNING : null;

  /** A good copy was just made: the first unlocked one in production is emailed about (once, until a locked one). */
  async function emailIfUnlocked(copyId: string): Promise<void> {
    if (!deps.notices) return;
    const sent = await deps.notices.read('unlocked');
    if (!keyWarning) {
      if (sent && key) await deps.notices.write('unlocked', null); // a locked copy: it cleared
      return;
    }
    if (sent) return;
    await alert('Backup copies aren’t locked with a key', `A backup copy was just made without a backup key. ${keyWarning}`);
    await deps.notices.write('unlocked', copyId);
  }

  /**
   * Too much room taken by the kept copies (more than BACKUP_WARN_GB), or too little free space for
   * the next one (under about twice the newest copy): in words, with what to do; null when fine.
   */
  async function spaceWarningFor(kept: { row: BackupRunRecord }[]): Promise<string | null> {
    const problems: string[] = [];
    const total = kept.reduce((n, { row }) => n + (row.sizeBytes ?? 0), 0);
    if (total > warnBytes) problems.push(`The backup copies kept on the server take ${formatBytes(total)} in all, more than the ${formatBytes(warnBytes)} set as the warning limit (BACKUP_WARN_GB).`);
    const newest = kept[0]?.row.sizeBytes ?? 0;
    const free = newest > 0 && deps.freeSpace ? await deps.freeSpace(deps.backupDir).catch(() => null) : null;
    if (free !== null && free < 2 * newest) problems.push(`Only ${formatBytes(free)} of disk space is free, less than twice the newest copy (${formatBytes(newest)}): the next copies may not fit.`);
    return problems.length ? `${problems.join(' ')} ${SPACE_ADVICE}` : null;
  }

  /** The disk space warning, emailed once when it first appears, and again only after it cleared and came back. */
  async function emailIfShortOfSpace(): Promise<void> {
    if (!deps.notices) return;
    const warning = await spaceWarningFor(await keptCopies());
    const sent = await deps.notices.read('space');
    if (!warning) {
      if (sent) await deps.notices.write('space', null);
      return;
    }
    if (sent) return;
    await alert('Check the disk space for backups', warning);
    await deps.notices.write('space', now().toISOString());
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
    const fileName = backupFileName(row.startedAt, tz, row.id, Boolean(key));
    // The lock is renewed while the copy is made, but never past the time limit: a copy that hangs
    // (a stuck disk or database) is stopped then, marked failed, and the next one can be made.
    const startedMs = Date.now();
    const beat = setInterval(() => {
      if (Date.now() - startedMs < maxRunMs) void deps.lock.renew(now()).catch(() => undefined);
    }, HEARTBEAT_MS);
    beat.unref?.();
    const stop = new AbortController();
    let deadline: NodeJS.Timeout | undefined;
    const outOfTime = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        const err = new BackupFailedError(`The backup was stopped: it was still running after ${durationText(maxRunMs)}.`);
        stop.abort(err);
        reject(err);
      }, maxRunMs);
      deadline.unref?.();
    });
    outOfTime.catch(() => undefined);
    try {
      const make = async () => {
        await checkReady();
        await clearLeftovers();
        return deps.writeArchive({
          outFile: join(deps.backupDir, fileName),
          workDir: join(deps.backupDir, `.work-${row.id}`),
          trigger: row.trigger === 'NIGHTLY' ? 'nightly' : 'manual',
          signal: stop.signal,
        });
      };
      const result = await Promise.race([make(), outOfTime]);
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
      await emailIfUnlocked(row.id).catch((err) => deps.logger?.warn('the "copies aren’t locked" email could not be sent', { err }));
      await emailIfShortOfSpace().catch((err) => deps.logger?.warn('the backup disk space email could not be sent', { err }));
      return (await deps.repo.find(row.id)) ?? done;
    } catch (err) {
      const reason = plainReason(err);
      deps.logger?.error('backup failed', { err, reason, trigger: row.trigger });
      const failed = await deps.repo.update(row.id, { status: 'FAILED', finishedAt: now(), error: reason });
      if (row.trigger === 'NIGHTLY') await afterNightlyFailure(row.localDate, reason);
      return failed;
    } finally {
      clearInterval(beat);
      clearTimeout(deadline);
      // Nothing half-made is left behind, whatever happened.
      await rm(join(deps.backupDir, `.work-${row.id}`), { recursive: true, force: true }).catch(() => undefined);
      await rm(join(deps.backupDir, `${fileName}.partial`), { force: true }).catch(() => undefined);
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

    /**
     * The nightly sweep: makes tonight's copy when it is due (true when it made or tried one), then
     * emails the administrators once if there has been no new copy for a day and a half.
     */
    async runNightlyIfDue(): Promise<boolean> {
      if (!nightlyEnabled) return false;
      await reconcile();
      const at = now();
      const today = await deps.repo.nightlyOn(zonedDayKey(at, tz));
      let tried = false;
      if (nightlyDue({ now: at, timeZone: tz, today, running: await deps.lock.isHeld(at) })) {
        try {
          await work(await begin('NIGHTLY', null));
          tried = true;
        } catch (err) {
          if (!(err instanceof ConflictError)) throw err; // a ConflictError: another server started it a moment ago
        }
      }
      await emailIfNoNewCopy().catch((err) => deps.logger?.warn('the "no new backup copy" email could not be sent', { err }));
      await emailIfShortOfSpace().catch((err) => deps.logger?.warn('the backup disk space email could not be sent', { err }));
      return tried;
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
      const info = await stat(path).catch(() => null);
      if (!info?.isFile()) return null;
      return { path, fileName: row.fileName, sizeBytes: info.size };
    },

    async overview(): Promise<BackupOverview> {
      await reconcile();
      const at = now();
      const [recent, kept, drive, held] = await Promise.all([
        deps.repo.recent(20),
        keptCopies(),
        deps.drive ? deps.drive.state().catch((): DriveState => ({ configured: true, connected: false, stored: false, email: null, connectedAt: null, problem: null })) : Promise.resolve<DriveState>({ configured: false, connected: false, stored: false, email: null, connectedAt: null, problem: null }),
        deps.lock.isHeld(at),
      ]);
      const running = recent.find((r) => r.status === 'RUNNING');
      // The last backup is the newest copy kept here (a restored database lists copies of another server).
      const lastOk = kept[0]?.row;
      const warning = warningFor(recent, lastOk, at).text;
      const newestKept = kept[0]?.row;
      const driveWarning =
        drive.problem ?? (drive.connected && newestKept?.driveStatus === 'FAILED' ? `The last copy wasn’t sent to Google Drive: ${newestKept.driveError ?? 'no reason was given.'}` : null);
      return {
        folder: deps.backupDir,
        folderWarning: deps.dirProblem ?? (deps.dirInsideApp ? 'The backup folder is inside the app folder, so a new deployment may remove it. Set BACKUP_DIR (or UPLOAD_DIR) to a folder outside the app.' : null),
        keyWarning,
        spaceWarning: await spaceWarningFor(kept),
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
        keptBytes: kept.reduce((n, { row }) => n + (row.sizeBytes ?? 0), 0),
        drive: { ...drive, warning: driveWarning },
      };
    },
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
