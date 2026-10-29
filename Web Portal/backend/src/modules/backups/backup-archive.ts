import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Readable, Transform, type TransformCallback } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { pipeline as pipelineCb } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import { BackupDamagedError, BackupKeyError, decryptStream, encryptStream, isEncryptedHeader } from './backup-crypto';
import { RestoreError } from './backup-errors';
import { dumpRows, fkSafeOrder, listForeignKeys, listTables, type ColumnInfo } from './db-dump';
import type { SqlRunner } from './sql-runner';
import { createTarWriter, isSafeEntryName, readTar, TarError, type TarEntry } from './tar';

export const BACKUP_FORMAT = 'mico360-tasks-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const MIGRATIONS_TABLE = '_prisma_migrations';

export interface ManifestTable {
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  rows: number;
  /** sha256 of the table's JSON-lines entry, as written. */
  sha256: string;
  bytes: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  trigger: 'nightly' | 'manual';
  appVersion: string;
  /** Database changes (Prisma migrations) applied to the database that was copied, oldest first. */
  migrations: string[];
  latestMigration: string | null;
  database: { server: string; tables: ManifestTable[] };
  files: { count: number; bytes: number; skipped: string[] };
  /** What is deliberately left out, in words. */
  notIncluded: string[];
}

export interface FileIndexEntry {
  path: string;
  size: number;
  sha256: string;
  /** The file changed size while the copy was being made (it was copied as far as it went). */
  changed?: boolean;
}

export interface ArchiveResult {
  sizeBytes: number;
  sha256: string;
  md5: string;
  tables: number;
  rows: number;
  files: number;
  fileBytes: number;
  latestMigration: string | null;
  encrypted: boolean;
}

export interface WriteArchiveOptions {
  sql: SqlRunner;
  /** The uploaded files (UPLOAD_DIR); every file under it is copied. */
  uploadDir: string;
  outFile: string;
  /** A scratch folder for the table files (removed afterwards). */
  workDir: string;
  appVersion: string;
  trigger: 'nightly' | 'manual';
  /** BACKUP_ENCRYPTION_KEY: when set, the copy is encrypted. */
  encryptionKey?: string;
  /** A pause between pages of rows, so the app stays quick while a backup runs. */
  pauseMs?: number;
  /** Folders under uploadDir to leave out. */
  excludeDirs?: string[];
  now?: () => Date;
}

/** One row as one line of the table's entry. */
export const rowLine = (row: unknown[]): string => `${JSON.stringify(row)}\n`;

class Digest extends Transform {
  private readonly sha = createHash('sha256');
  private readonly md5 = createHash('md5');
  bytes = 0;
  _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
    this.sha.update(chunk);
    this.md5.update(chunk);
    this.bytes += chunk.length;
    done(null, chunk);
  }
  result() {
    return { sha256: this.sha.digest('hex'), md5: this.md5.digest('hex'), bytes: this.bytes };
  }
}

interface FoundFile {
  rel: string;
  abs: string;
}

/** Every regular file under `dir` (sorted, forward-slash paths), leaving out `exclude` folders. */
async function listFiles(dir: string, exclude: string[], skipped: string[]): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  const excluded = new Set(exclude.map((d) => join(d)));
  async function walk(abs: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && rel === '') return; // no uploads yet
      throw err;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const childAbs = join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (excluded.has(join(childAbs))) continue;
      if (e.isDirectory()) await walk(childAbs, childRel);
      else if (e.isFile()) {
        if (isSafeEntryName(`files/${childRel}`)) out.push({ rel: childRel, abs: childAbs });
        else skipped.push(childRel);
      }
      // Links and other special files are not copied.
    }
  }
  await walk(dir, '');
  return out;
}

async function readMigrations(sql: SqlRunner): Promise<string[]> {
  try {
    const rows = await sql.query<{ m: string }>(
      `SELECT migration_name AS m FROM \`${MIGRATIONS_TABLE}\` WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    return rows.map((r) => r.m);
  } catch {
    return []; // a database made without migrations
  }
}

/**
 * Write one backup copy: the whole database (read as one consistent moment) and every uploaded file,
 * into `<outFile>.partial`, renamed to `outFile` only when complete. Nothing is held in memory: the
 * tables go to scratch files first (so the manifest with their checksums can come first), then
 * everything is streamed through gzip (and the encryption, when a key is set) to disk.
 */
export async function writeBackupArchive(opts: WriteArchiveOptions): Promise<ArchiveResult> {
  const now = opts.now ?? (() => new Date());
  const createdAt = now();
  const partial = `${opts.outFile}.partial`;
  await rm(opts.workDir, { recursive: true, force: true });
  await mkdir(opts.workDir, { recursive: true });
  try {
    const db = await opts.sql.transaction(async (tx) => {
      await tx.execute("SET time_zone = '+00:00'");
      // The first read starts the snapshot: every table below is read as the database is now.
      const migrations = await readMigrations(tx);
      const server = (await tx.query<{ v: string }>('SELECT VERSION() AS v'))[0]?.v ?? '';
      const tables = await listTables(tx);
      const order = fkSafeOrder(tables.map((t) => t.name), await listForeignKeys(tx));
      const out: (ManifestTable & { file: string })[] = [];
      for (const [i, name] of order.entries()) {
        const table = tables.find((t) => t.name === name)!;
        const file = join(opts.workDir, `${String(i).padStart(3, '0')}.jsonl`);
        const ws = createWriteStream(file);
        const hash = createHash('sha256');
        let rows = 0;
        let bytes = 0;
        try {
          for await (const row of dumpRows(tx, table, 500, opts.pauseMs ?? 0)) {
            const line = rowLine(row);
            hash.update(line);
            bytes += Buffer.byteLength(line);
            rows += 1;
            if (!ws.write(line)) await new Promise<void>((resolve, reject) => ws.once('drain', resolve).once('error', reject));
          }
        } finally {
          ws.end();
          await finished(ws);
        }
        out.push({ ...table, rows, sha256: hash.digest('hex'), bytes, file });
      }
      return { migrations, server, tables: out };
    });

    const skipped: string[] = [];
    const files = await listFiles(opts.uploadDir, [opts.workDir, ...(opts.excludeDirs ?? [])], skipped);
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: createdAt.toISOString(),
      trigger: opts.trigger,
      appVersion: opts.appVersion,
      migrations: db.migrations,
      latestMigration: db.migrations.at(-1) ?? null,
      database: { server: db.server, tables: db.tables.map(({ file: _file, ...t }) => t) },
      files: { count: 0, bytes: 0, skipped },
      notIncluded: ['The Android app file (downloads folder): it is in every release package.'],
    };

    const tarOut = new PassThrough({ highWaterMark: 1024 * 1024 });
    const digest = new Digest();
    const written = pipeline([tarOut, createGzip({ level: 6 }), ...(opts.encryptionKey ? [encryptStream(opts.encryptionKey)] : []), digest, createWriteStream(partial)]);
    written.catch(() => undefined); // awaited below; a failure also stops the writes
    const tar = createTarWriter(tarOut);
    const index: FileIndexEntry[] = [];
    try {
      // The file count and size are known only once each file is opened; the manifest has the plan.
      const plannedBytes = await Promise.all(files.map(async (f) => (await stat(f.abs).catch(() => null))?.size ?? 0));
      manifest.files = { count: files.length, bytes: plannedBytes.reduce((a, b) => a + b, 0), skipped };
      await tar.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)), createdAt);
      for (const t of db.tables) await tar.addStream(`database/${t.name}.jsonl`, t.bytes, createReadStream(t.file), createdAt);
      for (const f of files) {
        let handle;
        try {
          handle = await open(f.abs, 'r');
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; // deleted since it was listed
          throw err;
        }
        try {
          const info = await handle.stat();
          const src = info.size > 0 ? handle.createReadStream({ start: 0, end: info.size - 1, autoClose: false }) : Readable.from([]);
          const res = await tar.addStream(`files/${f.rel}`, info.size, src, info.mtime);
          index.push({ path: f.rel, size: info.size, sha256: res.sha256, ...(res.written !== info.size ? { changed: true } : {}) });
        } finally {
          await handle.close();
        }
      }
      await tar.addBuffer('files-index.json', Buffer.from(JSON.stringify(index)), createdAt);
      await tar.finish();
      tarOut.end();
    } catch (err) {
      tarOut.destroy(err as Error);
      await written.catch(() => undefined);
      throw err;
    }
    await written;
    await rename(partial, opts.outFile);
    const sums = digest.result();
    return {
      sizeBytes: sums.bytes,
      sha256: sums.sha256,
      md5: sums.md5,
      tables: db.tables.length,
      rows: db.tables.reduce((n, t) => n + t.rows, 0),
      files: index.length,
      fileBytes: index.reduce((n, f) => n + f.size, 0),
      latestMigration: manifest.latestMigration,
      encrypted: Boolean(opts.encryptionKey),
    };
  } catch (err) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw err;
  } finally {
    await rm(opts.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ─────────────────────────────── reading a copy ───────────────────────────────

async function firstBytes(file: string, n: number): Promise<Buffer> {
  const handle = await open(file, 'r').catch((err: NodeJS.ErrnoException) => {
    throw new RestoreError(err.code === 'ENOENT' ? `There is no backup file at ${file}.` : `The backup file can't be opened (${err.code ?? err.message}).`);
  });
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await handle.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** A plain-words RestoreError for anything that goes wrong reading a copy. */
export function plainReadError(err: unknown): RestoreError {
  if (err instanceof RestoreError) return err;
  if (err instanceof BackupKeyError || err instanceof BackupDamagedError || err instanceof TarError) return new RestoreError(err.message);
  const code = (err as NodeJS.ErrnoException)?.code ?? '';
  if (code === 'Z_BUF_ERROR' || /unexpected end of file/i.test(String((err as Error)?.message))) return new RestoreError('The backup file is incomplete (it stops part-way through).');
  if (code.startsWith('Z_') || /incorrect header check|invalid/i.test(String((err as Error)?.message))) return new RestoreError('The backup file is damaged, or it is not a MICO360 Tasks backup.');
  return new RestoreError(`The backup file could not be read (${(err as Error)?.message ?? String(err)}).`);
}

/** The entries of a backup copy, decrypted (with its key) and unpacked as they are read. */
export async function* openArchiveEntries(file: string, key?: string): AsyncGenerator<TarEntry> {
  const encrypted = isEncryptedHeader(await firstBytes(file, 8));
  if (encrypted && !key) throw new RestoreError('This copy is locked with a backup key (BACKUP_ENCRYPTION_KEY). Give the key that was set when it was made.');
  const out = new PassThrough({ highWaterMark: 1024 * 1024 });
  const src = createReadStream(file);
  pipelineCb([src, ...(encrypted ? [decryptStream(key!)] : []), createGunzip(), out], () => undefined);
  // A problem found while an entry is being read (gzip, the key, the tar) is said in plain words too.
  const plainBody = (body: Readable) =>
    Readable.from(
      (async function* () {
        try {
          for await (const chunk of body) yield chunk as Buffer;
        } catch (err) {
          throw plainReadError(err);
        }
      })(),
      { objectMode: false },
    );
  try {
    for await (const entry of readTar(out)) yield { ...entry, body: plainBody(entry.body) };
  } catch (err) {
    throw plainReadError(err);
  } finally {
    src.destroy();
    out.destroy();
  }
}

export async function readManifest(file: string, key?: string): Promise<BackupManifest> {
  for await (const entry of openArchiveEntries(file, key)) {
    if (entry.name !== 'manifest.json') break;
    const chunks: Buffer[] = [];
    for await (const c of entry.body) chunks.push(c as Buffer);
    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')) as BackupManifest;
    } catch {
      throw new RestoreError('The backup file is damaged (its list of contents can’t be read).');
    }
    if (manifest.format !== BACKUP_FORMAT) throw new RestoreError('This is not a MICO360 Tasks backup.');
    if (manifest.formatVersion > BACKUP_FORMAT_VERSION) throw new RestoreError('This copy was made by a newer version of MICO360 Tasks. Update the app first, then restore.');
    return manifest;
  }
  throw new RestoreError('This is not a MICO360 Tasks backup (it has no list of contents).');
}

async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Hash an entry as it is read: its sha256, size and number of lines. */
async function hashEntry(body: Readable): Promise<{ sha256: string; bytes: number; lines: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  let lines = 0;
  for await (const c of body) {
    const buf = c as Buffer;
    hash.update(buf);
    bytes += buf.length;
    for (const b of buf) if (b === 0x0a) lines += 1;
  }
  return { sha256: hash.digest('hex'), bytes, lines };
}

export interface ArchiveCheck {
  manifest: BackupManifest;
  index: FileIndexEntry[];
  tables: number;
  rows: number;
  files: number;
  fileBytes: number;
}

/**
 * Read a whole copy and check it against its own checksums (every table and every file), without a
 * database. The restore does this first, so a damaged copy is refused before anything is changed.
 */
export async function verifyArchive(file: string, key?: string): Promise<ArchiveCheck> {
  let manifest: BackupManifest | null = null;
  let index: FileIndexEntry[] | null = null;
  const tablesSeen = new Map<string, { sha256: string; lines: number }>();
  const filesSeen = new Map<string, string>();
  for await (const entry of openArchiveEntries(file, key)) {
    if (entry.name === 'manifest.json') {
      manifest = JSON.parse((await readAll(entry.body)).toString('utf8')) as BackupManifest;
      if (manifest.format !== BACKUP_FORMAT) throw new RestoreError('This is not a MICO360 Tasks backup.');
      if (manifest.formatVersion > BACKUP_FORMAT_VERSION) throw new RestoreError('This copy was made by a newer version of MICO360 Tasks. Update the app first, then restore.');
    } else if (entry.name.startsWith('database/') && entry.name.endsWith('.jsonl')) {
      const h = await hashEntry(entry.body);
      tablesSeen.set(entry.name.slice('database/'.length, -'.jsonl'.length), h);
    } else if (entry.name.startsWith('files/')) {
      filesSeen.set(entry.name.slice('files/'.length), (await hashEntry(entry.body)).sha256);
    } else if (entry.name === 'files-index.json') {
      index = JSON.parse((await readAll(entry.body)).toString('utf8')) as FileIndexEntry[];
    } else entry.body.resume();
  }
  if (!manifest) throw new RestoreError('This is not a MICO360 Tasks backup (it has no list of contents).');
  if (!index) throw new RestoreError('The backup file is incomplete (its list of files is missing).');
  for (const t of manifest.database.tables) {
    const seen = tablesSeen.get(t.name);
    if (!seen) throw new RestoreError(`The backup file is incomplete (table ${t.name} is missing).`);
    if (seen.sha256 !== t.sha256 || seen.lines !== t.rows) throw new RestoreError(`The backup file is damaged (table ${t.name} does not match its checksum).`);
  }
  for (const f of index) {
    const seen = filesSeen.get(f.path);
    if (seen === undefined) throw new RestoreError(`The backup file is incomplete (file ${f.path} is missing).`);
    if (seen !== f.sha256) throw new RestoreError(`The backup file is damaged (file ${f.path} does not match its checksum).`);
  }
  return {
    manifest,
    index,
    tables: manifest.database.tables.length,
    rows: manifest.database.tables.reduce((n, t) => n + t.rows, 0),
    files: index.length,
    fileBytes: index.reduce((n, f) => n + f.size, 0),
  };
}
