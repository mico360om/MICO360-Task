// Restore a MICO360 Tasks backup copy into a database (and its files into a folder). See docs/BACKUPS.md.
//
//   npm run backup:restore -- <backup file> --into <new database> --files-into <new folder>
//   npm run backup:restore -- <backup file> --check            (only check the file, no database)
//
// Options: --no-files (leave the uploaded files out) · --force (wipe a database / write into a folder
// that already holds something) · --key-file <file> (the BACKUP_ENCRYPTION_KEY of an encrypted copy;
// BACKUP_ENCRYPTION_KEY in the settings works too) · --env-file <file> (another settings file, e.g.
// the Windows server's config\server.env) · --url mysql://user:password@host:3306/<database>.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { RestoreError, databaseName, restoreBackup } from '../modules/backups/restore';
import { findCopyKey, verifyArchive } from '../modules/backups/backup-archive';
import { formatBytes } from '../modules/backups/backup-service';
import { UsageError, backendRoot, keyCandidates, loadSettings, parseRestoreArgs, restoreTargetUrl } from './backup-cli';

const say = (line = '') => console.log(line);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<number> {
  const args = parseRestoreArgs(process.argv.slice(2));
  const root = backendRoot();
  loadSettings(root, args.envFile);
  // The key as the server reads it (trimmed), else exactly as written (copies made before the server trimmed it).
  const key = await findCopyKey(args.file, keyCandidates(args.keyFile ? readFileSync(args.keyFile, 'utf8') : process.env.BACKUP_ENCRYPTION_KEY));
  const started = Date.now();

  if (args.check) {
    say(`Checking ${args.file} …`);
    const c = await verifyArchive(args.file, key);
    say(`✔ The copy is whole: made ${c.manifest.createdAt} by MICO360 Tasks ${c.manifest.appVersion}, ${c.tables} tables, ${c.rows} rows, ${c.files} files (${formatBytes(c.fileBytes)}).`);
    return 0;
  }

  const live = process.env.DATABASE_URL;
  const targetUrl = restoreTargetUrl(args, live);
  const target = databaseName(targetUrl);
  if (live && databaseName(live) === target && new URL(live).host === new URL(targetUrl).host) {
    if (!args.force) throw new RestoreError(`"${target}" is the database the app uses now. Restore into a new database instead (see docs/BACKUPS.md), or add --force to replace it.`);
    say(`!! This REPLACES the live database "${target}" with the copy. Stop the app first. Starting in 10 seconds — press Ctrl+C to stop.`);
    await sleep(10_000);
  }

  // A new database is made on the same server through the app's own connection, when it is allowed to.
  const createDatabase = live
    ? async (name: string) => {
        const admin = new PrismaClient({ datasources: { db: { url: live } } });
        try {
          await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        } finally {
          await admin.$disconnect();
        }
      }
    : undefined;

  const report = await restoreBackup({
    file: args.file,
    key,
    targetUrl,
    filesInto: args.noFiles ? null : args.filesInto,
    force: args.force,
    migrationsDir: join(root, 'prisma', 'migrations'),
    schemaFile: join(root, 'prisma', 'schema.prisma'),
    prismaCli: createRequire(join(root, 'package.json')).resolve('prisma/build/index.js'),
    createDatabase,
    log: say,
  });
  say();
  say(`✔ Restored into the database "${report.database}" in ${Math.round((Date.now() - started) / 1000)} s:`);
  say(`  the copy of ${report.createdAt} (MICO360 Tasks ${report.appVersion}) — ${report.tables} tables, ${report.rows} rows${args.noFiles ? '' : `, ${report.files} files (${formatBytes(report.fileBytes)}) into ${args.filesInto}`}.`);
  say('  Every table and file was read back and matches the copy.');
  for (const w of report.warnings) say(`  Note: ${w}`);
  say();
  say('Next: point DATABASE_URL (and UPLOAD_DIR) at the restored database and folder, then restart the app. docs/BACKUPS.md has the steps.');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof UsageError) {
      console.error(`✖ ${err.message}`);
      process.exit(2);
    }
    console.error(`✖ ${err instanceof RestoreError ? err.message : `The restore stopped: ${(err as Error)?.message ?? String(err)}`}`);
    process.exit(1);
  });
