import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { urlForDatabase } from '../modules/backups/restore';

/** Shared by the backup command-line tools: arguments, settings files and the backend's own folders. */

export class UsageError extends Error {}

export interface RestoreArgs {
  file: string;
  into: string | null;
  url: string | null;
  filesInto: string | null;
  noFiles: boolean;
  force: boolean;
  check: boolean;
  keyFile: string | null;
  envFile: string | null;
}

const VALUE_FLAGS = ['--into', '--url', '--files-into', '--key-file', '--env-file'] as const;
const SWITCHES = ['--no-files', '--force', '--check'] as const;

export function parseRestoreArgs(argv: string[]): RestoreArgs {
  const out: RestoreArgs = { file: '', into: null, url: null, filesInto: null, noFiles: false, force: false, check: false, keyFile: null, envFile: null };
  const set = (flag: string, value: string) => {
    if (flag === '--into') out.into = value;
    else if (flag === '--url') out.url = value;
    else if (flag === '--files-into') out.filesInto = value;
    else if (flag === '--key-file') out.keyFile = value;
    else if (flag === '--env-file') out.envFile = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if ((VALUE_FLAGS as readonly string[]).includes(a)) {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new UsageError(`${a} needs a value.`);
      set(a, v);
      i += 1;
    } else if (a === '--no-files') out.noFiles = true;
    else if (a === '--force') out.force = true;
    else if (a === '--check') out.check = true;
    else if (a.startsWith('--')) throw new UsageError(`Unknown option ${a}. Options: ${[...VALUE_FLAGS, ...SWITCHES].join(' ')}`);
    else if (!out.file) out.file = a;
    else throw new UsageError(`Only one backup file at a time (got "${out.file}" and "${a}").`);
  }
  if (!out.file) throw new UsageError('Which backup file? Give its path first, e.g. backup:restore mico360-tasks-backup-….tar.gz --into <database>.');
  if (out.check) return out;
  if (!out.into && !out.url) throw new UsageError('Say which database to restore into: --into <database name> (a new, empty one).');
  if (!out.filesInto && !out.noFiles) throw new UsageError('Say where the uploaded files go: --files-into <a new, empty folder>, or --no-files to leave them out.');
  return out;
}

/** --url as given, or the database server in DATABASE_URL with the database named by --into. */
export function restoreTargetUrl(args: Pick<RestoreArgs, 'url' | 'into'>, databaseUrl: string | undefined): string {
  if (args.url) return args.url;
  if (!databaseUrl) throw new UsageError('DATABASE_URL is not set: run this in the app folder (where its .env is), add --env-file <settings file>, or give --url mysql://user:password@host:3306/<database>.');
  return urlForDatabase(databaseUrl, args.into!);
}

/**
 * The backup keys to try, from a key file's text or BACKUP_ENCRYPTION_KEY: first trimmed (how the
 * server reads it), then as written, without and with its line end — copies made before the server
 * trimmed the key were sealed with any spaces around it.
 */
export function keyCandidates(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  const asWritten = raw.replace(/\r?\n$/, '');
  if (!raw.trim()) return [];
  return [...new Set([raw.trim(), asWritten, raw])];
}

/** The backend folder (with package.json, prisma/ and node_modules), from source or from dist/. */
export function backendRoot(from: string = __dirname): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg) && /"name":\s*"@mico360\/backend"/.test(readFileSync(pkg, 'utf8'))) return dir;
    dir = dirname(dir);
  }
  throw new UsageError('The app’s backend folder could not be found next to this tool.');
}

/** The backend's .env (when there is one) and, over it, the settings file given with --env-file. */
export function loadSettings(root: string, envFile: string | null): void {
  const own = join(root, '.env');
  if (existsSync(own)) dotenv.config({ path: own });
  if (envFile) {
    const path = resolve(envFile);
    if (!existsSync(path)) throw new UsageError(`There is no settings file at ${path}.`);
    dotenv.config({ path, override: true });
  }
}
