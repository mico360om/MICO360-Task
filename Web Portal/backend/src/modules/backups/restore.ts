import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PrismaClient } from '@prisma/client';
import { MIGRATIONS_TABLE, entryLines, openArchiveEntries, verifyArchive, type BackupManifest, type ManifestTable } from './backup-archive';
import { RestoreError } from './backup-errors';
import { dumpRows, insertBatches, listTables, quoteId, type TableInfo } from './db-dump';
import { prismaSqlRunner, type SqlRunner } from './sql-runner';
import { isSafeEntryName } from './tar';

export { RestoreError } from './backup-errors';

export interface RestoreOptions {
  file: string;
  /** BACKUP_ENCRYPTION_KEY of the copy, when it is encrypted. */
  key?: string;
  /** The database to restore into (it must be empty unless `force`). */
  targetUrl: string;
  /** Where the uploaded files go (empty or new, unless `forceFiles`); null/undefined = leave the files out. */
  filesInto?: string | null;
  /** Wipe a database that already holds tables (--force). */
  force?: boolean;
  /** Write into a files folder that already holds files (--force-files): asked for on its own. */
  forceFiles?: boolean;
  /** This app's prisma/migrations folder, its schema.prisma and the Prisma CLI (prisma/build/index.js). */
  migrationsDir: string;
  schemaFile: string;
  prismaCli: string;
  /** Makes the target database when it doesn't exist yet (the CLI uses the server's own connection). */
  createDatabase?: (name: string) => Promise<void>;
  log?: (line: string) => void;
}

export interface RestoreReport {
  database: string;
  createdAt: string;
  appVersion: string;
  latestMigration: string | null;
  tables: number;
  rows: number;
  files: number;
  fileBytes: number;
  warnings: string[];
}

/** The database name in a mysql:// address. */
export function databaseName(url: string): string {
  let name = '';
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new RestoreError('The database address is not valid.');
  }
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(name)) throw new RestoreError(`"${name}" is not a usable database name (letters, digits, _ and - only).`);
  return name;
}

/** The address of another database on the same server, with the same user and password. */
export function urlForDatabase(baseUrl: string, database: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${database}`;
  const url = u.toString();
  databaseName(url);
  return url;
}

function localMigrations(dir: string): string[] {
  if (!existsSync(dir)) throw new RestoreError(`The app's database changes folder is missing (${dir}).`);
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/** "Unknown database": Prisma doesn't always tag it P1003, so its message is checked too. */
const isMissingDatabase = (err: unknown) =>
  (err as { errorCode?: string } | null)?.errorCode === 'P1003' || /does not exist on the database server|unknown database/i.test(String((err as Error)?.message));

async function connect(url: string): Promise<PrismaClient> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  await client.$queryRawUnsafe('SELECT 1');
  return client;
}

async function openTarget(url: string, name: string, create?: (name: string) => Promise<void>): Promise<PrismaClient> {
  try {
    return await connect(url);
  } catch (err) {
    if (!isMissingDatabase(err)) throw new RestoreError(`The database server can't be reached with these settings (${(err as Error).message.split('\n').filter(Boolean).at(-1) ?? 'no answer'}).`);
  }
  const cantCreate = new RestoreError(`The database "${name}" doesn't exist, and it couldn't be made here. Create an empty database with that name first (on Hostinger: hPanel → Databases → MySQL Databases), then run this again.`);
  if (!create) throw cantCreate;
  try {
    await create(name);
  } catch {
    throw cantCreate;
  }
  return connect(url);
}

/** Removes every table and view (the --force path). */
async function wipe(sql: SqlRunner): Promise<void> {
  const objects = await sql.query<{ t: string; kind: string }>('SELECT TABLE_NAME AS t, TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  await sql.transaction(async (tx) => {
    await tx.execute('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const o of objects) await tx.execute(`${o.kind === 'VIEW' ? 'DROP VIEW' : 'DROP TABLE'} IF EXISTS ${quoteId(o.t)}`);
    } finally {
      await tx.execute('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

/** `prisma migrate deploy` with exactly the copy's database changes, so the tables match the copy. */
function createTables(opts: RestoreOptions, manifest: BackupManifest): void {
  const tmp = mkdtempSync(join(tmpdir(), 'mico360-restore-'));
  try {
    copyFileSync(opts.schemaFile, join(tmp, 'schema.prisma'));
    mkdirSync(join(tmp, 'migrations'));
    const lock = join(opts.migrationsDir, 'migration_lock.toml');
    if (existsSync(lock)) copyFileSync(lock, join(tmp, 'migrations', 'migration_lock.toml'));
    for (const m of manifest.migrations) cpSync(join(opts.migrationsDir, m), join(tmp, 'migrations', m), { recursive: true });
    const run = spawnSync(process.execPath, [opts.prismaCli, 'migrate', 'deploy', '--schema', join(tmp, 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: opts.targetUrl, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      encoding: 'utf8',
      windowsHide: true,
    });
    if (run.status !== 0) {
      const tail = `${run.stderr ?? ''}\n${run.stdout ?? ''}`.split(/\r?\n/).filter((l) => l.trim()).slice(-6).join('\n');
      throw new RestoreError(`The tables could not be created in the new database:\n${tail || run.error?.message || 'no output'}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// An order-free fingerprint of a table's rows in a form both MySQL and MariaDB agree on: JSON values
// compared as JSON (MySQL rewrites JSON text), base64 without line breaks. Used to check the restore.
const TWO_256 = 1n << 256n;
function stableJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stableJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stableJson((v as Record<string, unknown>)[k])]));
  return v;
}
function canonicalRow(row: unknown[], types: string[]): string {
  return JSON.stringify(
    row.map((v, i) => {
      if (typeof v !== 'string') return v;
      const t = types[i]!;
      if (t === 'json' || t === 'longtext') {
        try {
          return `json:${JSON.stringify(stableJson(JSON.parse(v)))}`;
        } catch {
          return v;
        }
      }
      if (/blob|binary/.test(t)) return v.replace(/\s+/g, '');
      return v;
    }),
  );
}
class RowsDigest {
  private sum = 0n;
  rows = 0;
  add(row: unknown[], types: string[]) {
    this.sum = (this.sum + BigInt(`0x${createHash('sha256').update(canonicalRow(row, types)).digest('hex')}`)) % TWO_256;
    this.rows += 1;
  }
  value() {
    return this.sum.toString(16);
  }
}

async function loadTable(sql: SqlRunner, table: TableInfo, body: Readable, digest: RowsDigest, types: string[]): Promise<void> {
  await sql.transaction(async (tx) => {
    await tx.execute("SET time_zone = '+00:00'");
    // Rows can point at rows of their own table (a task's repeat parent, a reply's message) that come later.
    await tx.execute('SET FOREIGN_KEY_CHECKS = 0');
    try {
      let rows: unknown[][] = [];
      let bytes = 0;
      const flush = async () => {
        for (const b of insertBatches(table, rows)) await tx.execute(b.sql, ...b.params);
        rows = [];
        bytes = 0;
      };
      for await (const line of entryLines(body)) {
        if (!line) continue;
        const row = JSON.parse(line) as unknown[];
        digest.add(row, types);
        rows.push(row);
        bytes += line.length;
        if (rows.length >= 500 || bytes >= 1_000_000) await flush();
      }
      if (rows.length) await flush();
    } finally {
      await tx.execute('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

function folderHasFiles(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).length > 0;
}

/**
 * Restore a backup copy into a named, empty database (and its files into a folder): check the whole
 * copy first, make the tables with the copy's own database changes, load every table (parents first),
 * write the files, then read everything back and compare it with the copy. Refuses a non-empty
 * database or folder unless `force`, and a copy made by a newer version of the app.
 */
export async function restoreBackup(opts: RestoreOptions): Promise<RestoreReport> {
  const log = opts.log ?? (() => undefined);
  const name = databaseName(opts.targetUrl);
  const warnings: string[] = [];

  log('Checking the backup file (every table and file against its checksum)…');
  const check = await verifyArchive(opts.file, opts.key);
  const { manifest } = check;
  log(`  Made ${manifest.createdAt} by MICO360 Tasks ${manifest.appVersion}: ${check.tables} tables, ${check.rows} rows, ${check.files} files.`);

  const known = new Set(localMigrations(opts.migrationsDir));
  const unknown = manifest.migrations.filter((m) => !known.has(m));
  if (unknown.length) {
    throw new RestoreError(
      `This copy was made by a newer version of MICO360 Tasks (${manifest.appVersion}): it has ${unknown.length} database change${unknown.length === 1 ? '' : 's'} this version doesn't know (${unknown.slice(-3).join(', ')}). Update the app to ${manifest.appVersion} or later, then restore.`,
    );
  }
  const filesInto = opts.filesInto ? resolve(opts.filesInto) : null;
  if (filesInto && folderHasFiles(filesInto) && !opts.forceFiles) {
    throw new RestoreError(`The folder ${filesInto} is not empty. Restore the files into a new, empty folder (or add --force-files to write into this one).`);
  }

  const target = await openTarget(opts.targetUrl, name, opts.createDatabase);
  const writtenFiles = new Map<string, string>();
  try {
    const sql = prismaSqlRunner(target);
    const existing = await sql.query<{ n: bigint }>('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
    const count = Number(existing[0]?.n ?? 0);
    if (count > 0 && !opts.force) {
      throw new RestoreError(`The database "${name}" is not empty (it has ${count} tables). Restore into a new, empty database, or add --force to wipe this one first.`);
    }
    // From here on the database (and the files folder) are being changed: a failure leaves them partial.
    try {
      return await loadInto(sql, count);
    } catch (err) {
      throw partialRestore(err, name, writtenFiles.size ? filesInto : null);
    }
  } finally {
    await target.$disconnect();
  }

  async function loadInto(sql: SqlRunner, count: number): Promise<RestoreReport> {
    if (count > 0) {
      log(`Wiping the database "${name}" (--force)…`);
      await wipe(sql);
    }

    log(`Creating the tables (database changes up to ${manifest.latestMigration ?? 'none'})…`);
    createTables(opts, manifest);
    const made = new Map((await listTables(sql)).map((t) => [t.name, t] as const));
    const toLoad = manifest.database.tables.filter((t) => t.name !== MIGRATIONS_TABLE);
    for (const t of toLoad) {
      const here = made.get(t.name);
      const same = here && here.columns.length === t.columns.length && t.columns.every((c) => here.columns.some((h) => h.name === c.name));
      if (!same) throw new RestoreError(`The tables made for this copy don't match it (table ${t.name}). The app's database changes folder may have been edited.`);
    }

    // Some database changes add rows of their own (the built-in roles): the copy has them already.
    await sql.transaction(async (tx) => {
      await tx.execute('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const t of toLoad) await tx.execute(`DELETE FROM ${quoteId(t.name)}`);
      } finally {
        await tx.execute('SET FOREIGN_KEY_CHECKS = 1');
      }
    });

    const byName = new Map<string, ManifestTable>(toLoad.map((t) => [t.name, t] as const));
    const expected = new Map<string, RowsDigest>();
    const typesOf = (t: ManifestTable) => t.columns.map((c) => made.get(t.name)!.columns.find((h) => h.name === c.name)!.type);
    let loadedTables = 0;
    log('Loading the tables and files…');
    for await (const entry of openArchiveEntries(opts.file, opts.key)) {
      if (entry.name.startsWith('database/') && entry.name.endsWith('.jsonl')) {
        const t = byName.get(entry.name.slice('database/'.length, -'.jsonl'.length));
        if (!t) {
          entry.body.resume(); // _prisma_migrations: made by the database changes above
          continue;
        }
        const digest = new RowsDigest();
        expected.set(t.name, digest);
        await loadTable(sql, { name: t.name, columns: t.columns, primaryKey: t.primaryKey }, entry.body, digest, typesOf(t));
        loadedTables += 1;
        if (loadedTables % 10 === 0) log(`  ${loadedTables} of ${toLoad.length} tables loaded`);
      } else if (entry.name.startsWith('files/') && filesInto) {
        const rel = entry.name.slice('files/'.length);
        const dest = resolve(filesInto, ...rel.split('/'));
        if (!isSafeEntryName(entry.name) || !dest.startsWith(filesInto + sep)) {
          warnings.push(`A file with an unsafe name was left out: ${rel}`);
          entry.body.resume();
          continue;
        }
        mkdirSync(dirname(dest), { recursive: true });
        const hash = createHash('sha256');
        await pipeline(
          entry.body,
          new Transform({
            transform(chunk: Buffer, _enc, done) {
              hash.update(chunk);
              done(null, chunk);
            },
          }),
          createWriteStream(dest),
        );
        writtenFiles.set(rel, hash.digest('hex'));
      } else entry.body.resume();
    }

    log('Checking the restored data against the copy…');
    const problems: string[] = [];
    for (const t of toLoad) {
      const actual = new RowsDigest();
      const types = typesOf(t);
      for await (const row of dumpRows(sql, { name: t.name, columns: t.columns, primaryKey: t.primaryKey })) actual.add(row, types);
      const want = expected.get(t.name);
      if (actual.rows !== t.rows) problems.push(`${t.name}: ${actual.rows} rows instead of ${t.rows}`);
      else if (!want || want.value() !== actual.value()) problems.push(`${t.name}: the rows differ from the copy`);
    }
    const migrationsHere = (await sql.query<{ m: string }>(`SELECT migration_name AS m FROM \`${MIGRATIONS_TABLE}\` WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`)).map((r) => r.m);
    if (migrationsHere.join('|') !== manifest.migrations.join('|')) problems.push('the list of database changes differs from the copy');
    if (filesInto) {
      for (const f of check.index) {
        if (writtenFiles.get(f.path) !== f.sha256) problems.push(`file ${f.path} does not match the copy`);
        if (f.changed) warnings.push(`${f.path} was being changed while the copy was made; it is restored as far as it went.`);
      }
    }
    if (problems.length) throw new RestoreError(`The restored data does not match the copy:\n- ${problems.slice(0, 10).join('\n- ')}`);
    // The copy's own row in the backup list says "being made" (it was, when the copy was taken). Left in,
    // the restored app would report it as a backup that stopped part-way.
    if (made.has('backup_runs') && (await sql.execute("DELETE FROM `backup_runs` WHERE `status` = 'RUNNING'")) > 0) {
      warnings.push('The entry for this copy, which was being made when it was taken, is left out of the restored list of backups.');
    }
    if (!filesInto && check.files) warnings.push(`The ${check.files} uploaded files were not restored (no folder was given).`);
    if (manifest.files.skipped.length) warnings.push(`${manifest.files.skipped.length} file(s) with unusual names were not in the copy.`);

    return {
      database: name,
      createdAt: manifest.createdAt,
      appVersion: manifest.appVersion,
      latestMigration: manifest.latestMigration,
      tables: toLoad.length,
      rows: toLoad.reduce((n, t) => n + t.rows, 0),
      files: filesInto ? writtenFiles.size : 0,
      fileBytes: filesInto ? check.fileBytes : 0,
      warnings,
    };
  }
}

/**
 * A restore that stopped after it began changing the target: the reason, then plainly that the
 * database (and the files folder, when files were written) now hold only part of the copy.
 */
function partialRestore(err: unknown, database: string, filesFolder: string | null): RestoreError {
  const reason = (String((err as Error)?.message ?? err).split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? 'no reason was given').slice(0, 300);
  const why = err instanceof RestoreError ? err.message : `The restore stopped part-way (${reason}).`;
  const db = `The database "${database}" now holds only part of the copy, so don’t use it: empty it (or make a new, empty database) and run the restore again.`;
  const files = filesFolder ? ` The folder ${filesFolder} holds only some of the files: empty it as well (or use a new folder).` : '';
  return new RestoreError(`${why}\n\n${db}${files}`);
}
