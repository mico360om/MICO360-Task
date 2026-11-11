import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env';
import { secretBoxFromEnv } from '../settings/secret-box';
import { writeBackupArchive } from './backup-archive';
import { backupDirProblem, isInside, resolveBackupDir } from './backup-config';
import type { BackupRouteDeps } from './backup-routes';
import { createBackupService, noticesIn, type BackupServiceDeps } from './backup-service';
import { diskFree, estimateBackupBytes } from './backup-space';
import { createBackupDrive, createDriveConnectionStore, prismaSettingKeyValue } from './drive-connection';
import { createGoogleDrive, googleUrls } from './google-drive';
import { createOneTimeTokens } from './one-time-tokens';
import { createPrismaBackupLock, createPrismaBackupRepository } from './prisma-backup-repository';
import { prismaSqlRunner } from './sql-runner';
import { trainingFilesDirFor } from '../training/training-files';

type BackupEnv = Pick<
  Env,
  | 'NODE_ENV'
  | 'BACKUP_DIR'
  | 'UPLOAD_DIR'
  | 'TRAINING_FILES_DIR'
  | 'WEB_ROOT'
  | 'BACKUP_ENCRYPTION_KEY'
  | 'BACKUP_NIGHTLY'
  | 'BACKUP_WARN_GB'
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'GOOGLE_REDIRECT_URI'
  | 'BACKUP_GOOGLE_TEST_BASE_URL'
  | 'API_BASE_URL'
  | 'APP_URL'
  | 'JWT_ACCESS_SECRET'
  | 'SECRETS_ENCRYPTION_KEY'
>;

export interface BackupWiringOptions {
  env: BackupEnv;
  /** The backend folder the server runs in (relative settings are read from it). */
  cwd: string;
  appVersion: string;
  timeZone: string;
  weekStart: () => Promise<0 | 1 | 6>;
  alertAdmins?: BackupServiceDeps['alertAdmins'];
  isActiveAdmin?: (userId: string) => Promise<boolean>;
  logger?: BackupServiceDeps['logger'];
}

/** The folder a deploy replaces: the repository root when started by server.mjs, else the backend. */
function appFolder(cwd: string): string {
  const root = resolve(cwd, '..', '..');
  return existsSync(join(root, 'server.mjs')) ? root : cwd;
}

/** Everything the backups need on this server: the service, Google Drive and the routes' parts. */
export function createBackupsFromPrisma(prisma: PrismaClient, opts: BackupWiringOptions) {
  const { env, cwd } = opts;
  const backupDir = resolveBackupDir(env, cwd);
  const uploadDir = resolve(cwd, env.UPLOAD_DIR);
  // Training Center: its private files (beside the uploads, never served) are in every copy too.
  const extraDirs = [{ dir: trainingFilesDirFor(env, cwd), name: 'training-files' }];
  const webRoot = env.WEB_ROOT ? resolve(cwd, env.WEB_ROOT) : null;
  const appDir = appFolder(cwd);
  const sql = prismaSqlRunner(prisma);

  const google =
    env.GOOGLE_CLIENT_ID.trim() && env.GOOGLE_CLIENT_SECRET.trim()
      ? createGoogleDrive({
          clientId: env.GOOGLE_CLIENT_ID.trim(),
          clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
          redirectUri: env.GOOGLE_REDIRECT_URI.trim() || `${env.API_BASE_URL.replace(/\/+$/, '')}/api/v1/backups/google/callback`,
          urls: googleUrls(env.BACKUP_GOOGLE_TEST_BASE_URL || undefined),
        })
      : null;
  const drive = createBackupDrive({
    google,
    store: createDriveConnectionStore(prismaSettingKeyValue(prisma), secretBoxFromEnv(env)),
    tokens: createOneTimeTokens({ secret: env.JWT_ACCESS_SECRET, purpose: 'drive-connect' }),
    logger: opts.logger,
  });

  const service = createBackupService({
    repo: createPrismaBackupRepository(prisma),
    lock: createPrismaBackupLock(prisma),
    writeArchive: (o) =>
      writeBackupArchive({ ...o, sql, uploadDir, appVersion: opts.appVersion, encryptionKey: env.BACKUP_ENCRYPTION_KEY || undefined, pauseMs: 5, excludeDirs: [backupDir], extraDirs }),
    backupDir,
    // In production a folder inside the app is refused (a deployment replaces it); elsewhere it is warned about.
    dirProblem: backupDirProblem(backupDir, { uploadDir, webRoot, assetsDir: resolve(cwd, 'assets'), appDir, production: env.NODE_ENV === 'production' }),
    dirInsideApp: isInside(backupDir, appDir),
    encryptionKey: env.BACKUP_ENCRYPTION_KEY,
    nightlyEnabled: env.BACKUP_NIGHTLY,
    timeZone: opts.timeZone,
    weekStart: opts.weekStart,
    freeSpace: diskFree,
    neededSpace: () => estimateBackupBytes(sql, uploadDir, extraDirs.map((x) => x.dir)),
    alertAdmins: opts.alertAdmins,
    notices: noticesIn(prismaSettingKeyValue(prisma, 'backups.notices')),
    production: env.NODE_ENV === 'production',
    warnBytes: env.BACKUP_WARN_GB * 1024 * 1024 * 1024,
    drive,
    logger: opts.logger,
  });

  const routes: Omit<BackupRouteDeps, 'guard' | 'audit'> = {
    service,
    drive,
    downloads: createOneTimeTokens({ secret: env.JWT_ACCESS_SECRET, purpose: 'backup-download' }),
    isActiveAdmin: opts.isActiveAdmin ?? (async () => false),
    appUrl: env.APP_URL,
  };
  return { service, drive, routes, backupDir };
}
