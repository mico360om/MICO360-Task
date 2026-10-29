import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { BackupKeyError } from './backup-crypto';
import { BackupFailedError, RestoreError } from './backup-errors';

/** BACKUP_DIR, or a `backups` folder beside UPLOAD_DIR (outside the app folder, so deploys keep it). */
export function resolveBackupDir(env: { BACKUP_DIR: string; UPLOAD_DIR: string }, cwd: string): string {
  if (env.BACKUP_DIR.trim()) return resolve(cwd, env.BACKUP_DIR.trim());
  return join(dirname(resolve(cwd, env.UPLOAD_DIR)), 'backups');
}

/** Is `child` the folder `parent` or inside it? (Whole folder names; case-insensitive on Windows.) */
export function isInside(child: string, parent: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  const rel = relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Why the backup folder can't be used, or null. Copies hold everything (password hashes included),
 * so they must never sit in a folder the website serves.
 */
export function backupDirProblem(dir: string, where: { uploadDir: string; webRoot: string | null; assetsDir: string }): string | null {
  const advice = 'Set BACKUP_DIR to a private folder outside it.';
  if (isInside(dir, where.uploadDir)) return `The backup folder is inside the uploads folder, which the website serves. ${advice}`;
  if (where.webRoot && isInside(dir, where.webRoot)) return `The backup folder is inside the web app folder, which the website serves. ${advice}`;
  if (isInside(dir, where.assetsDir)) return `The backup folder is inside the email pictures folder, which the website serves. ${advice}`;
  return null;
}

const NAME = /^mico360-tasks-backup-\d{4}-\d{2}-\d{2}-\d{4}-[a-z0-9]{6}\.tar\.gz(\.enc)?$/;

const stampFormats = new Map<string, Intl.DateTimeFormat>();
function companyStamp(at: Date, timeZone: string): { day: string; hhmm: string } {
  let f = stampFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    stampFormats.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(at).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}${parts.minute}` };
}

/** `mico360-tasks-backup-<company date>-<HHMM>-<6 of the run id>.tar.gz` (`.enc` when encrypted). */
export function backupFileName(at: Date, timeZone: string, runId: string, encrypted: boolean): string {
  const { day, hhmm } = companyStamp(at, timeZone);
  const tail = runId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-6).padStart(6, '0');
  return `mico360-tasks-backup-${day}-${hhmm}-${tail}.tar.gz${encrypted ? '.enc' : ''}`;
}

/** One of our copies (anything else in the folder — the Windows tray's SQL dumps — is never touched). */
export function isBackupFileName(name: string): boolean {
  return NAME.test(name);
}

/** Why a backup failed, in words for the System Settings warning and the email. */
export function plainReason(err: unknown): string {
  if (err instanceof BackupFailedError || err instanceof BackupKeyError || err instanceof RestoreError) return err.message;
  const code = (err as NodeJS.ErrnoException | null)?.code ?? '';
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'The server’s disk is full.';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'The backup folder can’t be written to (check its permissions).';
  if (String((err as Error | null)?.name ?? '').startsWith('PrismaClient')) return 'The database couldn’t be read.';
  return 'Something went wrong while making the copy (the server log has the details).';
}
