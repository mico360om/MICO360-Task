// Make one backup copy now, from the command line — the same as "Back up now" in System Settings (it
// is listed there, kept by the same 7 + 4 rule and sent to Google Drive when connected).
//
//   npm run backup:create [-- --env-file <settings file>]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../config/env';
import { createBackupsFromPrisma } from '../modules/backups/backup-wiring';
import { formatBytes } from '../modules/backups/backup-service';
import { UsageError, backendRoot, loadSettings } from './backup-cli';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--env-file');
  if (argv.some((a, i) => a.startsWith('--') && a !== '--env-file' && i !== at + 1)) throw new UsageError('Usage: backup:create [--env-file <settings file>]');
  const root = backendRoot();
  loadSettings(root, at >= 0 ? (argv[at + 1] ?? null) : null);
  process.chdir(root); // relative UPLOAD_DIR / BACKUP_DIR are read from the backend folder, as the server does
  const env = loadEnv(process.env);
  const pkg = join(root, 'package.json');
  const version = existsSync(pkg) ? (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version : 'unknown';
  const prisma = new PrismaClient();
  try {
    const { service, backupDir } = createBackupsFromPrisma(prisma, {
      env,
      cwd: root,
      appVersion: version,
      timeZone: env.COMPANY_TIMEZONE,
      weekStart: async () => {
        const row = await prisma.systemSetting.findUnique({ where: { key: 'company.weekStart' } });
        return row?.value === 1 || row?.value === 6 ? row.value : 0;
      },
    });
    console.log(`Making a backup copy in ${backupDir} …`);
    const started = Date.now();
    const run = await service.run('MANUAL');
    if (run.status !== 'OK') {
      console.error(`✖ The backup failed: ${run.error}`);
      return 1;
    }
    console.log(`✔ ${run.fileName} — ${formatBytes(run.sizeBytes ?? 0)}, ${run.tableCount} tables, ${run.rowCount} rows, ${run.fileCount} files, in ${Math.round((Date.now() - started) / 1000)} s.`);
    if (run.driveStatus === 'UPLOADED') console.log('  Also sent to Google Drive.');
    if (run.driveStatus === 'FAILED') console.log(`  Not sent to Google Drive: ${run.driveError}`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`✖ ${(err as Error)?.message ?? String(err)}`);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
