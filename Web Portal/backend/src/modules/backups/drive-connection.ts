import type { Prisma, PrismaClient } from '@prisma/client';
import { ConflictError } from '../../lib/http-errors';
import type { SecretBox } from '../settings/secret-box';
import type { BackupDrive, DriveState } from './backup-service';
import { DriveError, plainDriveError, type GoogleDrive } from './google-drive';
import type { OneTimeTokens } from './one-time-tokens';
import { planBackupRetention } from './retention';

/** The Google Drive connection, kept in system_settings (never shown by the settings API). */
export const DRIVE_SETTING_KEY = 'backups.googleDrive';

export interface DriveConnection {
  refreshToken: string;
  email: string | null;
  name: string | null;
  folderId: string | null;
  connectedAt: string;
  connectedById: string | null;
  /** Set when the connection stopped working; shown in System Settings. */
  problem: string | null;
}

export interface KeyValue {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
  erase(): Promise<void>;
}

export function prismaSettingKeyValue(prisma: PrismaClient, key = DRIVE_SETTING_KEY): KeyValue {
  return {
    read: async () => (await prisma.systemSetting.findUnique({ where: { key } }))?.value ?? undefined,
    write: async (value) => {
      const v = value as Prisma.InputJsonValue;
      await prisma.systemSetting.upsert({ where: { key }, update: { value: v }, create: { key, value: v } });
    },
    erase: async () => {
      await prisma.systemSetting.deleteMany({ where: { key } });
    },
  };
}

const UNREADABLE = 'The Google Drive connection can’t be read on this server (its secret key changed). Connect it again.';

/** Keeps the connection with its refresh token sealed (AES-256-GCM, the app's secret box). */
export function createDriveConnectionStore(kv: KeyValue, box: SecretBox) {
  return {
    async get(): Promise<DriveConnection | null> {
      const raw = (await kv.read()) as (Omit<DriveConnection, 'refreshToken'> & { refreshToken?: string }) | undefined | null;
      if (!raw || typeof raw !== 'object' || !raw.refreshToken) return null;
      try {
        return { ...raw, refreshToken: box.decrypt(raw.refreshToken) };
      } catch {
        return { ...raw, refreshToken: '', problem: UNREADABLE };
      }
    },
    async save(c: DriveConnection): Promise<void> {
      await kv.write({ ...c, refreshToken: box.encrypt(c.refreshToken) });
    },
    async clear(): Promise<void> {
      await kv.erase();
    },
  };
}

export type DriveConnectionStore = ReturnType<typeof createDriveConnectionStore>;

const NOT_SET_UP = 'Google Drive isn’t set up on this server yet.';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface BackupDriveDeps {
  /** Null when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. */
  google: GoogleDrive | null;
  store: DriveConnectionStore;
  /** Signs the Google sign-in `state` (which administrator started it). */
  tokens: OneTimeTokens;
  now?: () => Date;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
}

/** Google Drive for the backups: connecting, sending copies, and keeping 7 + 4 there too. */
export function createBackupDrive(deps: BackupDriveDeps): BackupDrive & {
  connectUrl(userId: string): string;
  complete(answer: { code?: string; state?: string; error?: string }): Promise<{ result: 'connected' | 'denied' | 'failed'; userId: string | null; email: string | null }>;
  disconnect(): Promise<{ email: string | null } | null>;
} {
  const now = deps.now ?? (() => new Date());

  async function connection(): Promise<DriveConnection> {
    const conn = await deps.store.get();
    if (!deps.google || !conn) throw new Error('Google Drive is not connected.');
    if (!conn.refreshToken) throw new DriveError('auth', conn.problem ?? UNREADABLE);
    return conn;
  }

  /** Runs `fn` with an access token; one 401 gets a fresh token and one more try. */
  async function withAccess<T>(conn: DriveConnection, fn: (access: string) => Promise<T>): Promise<T> {
    const google = deps.google!;
    try {
      try {
        return await fn(await google.accessToken(conn.refreshToken));
      } catch (err) {
        if (!(err instanceof DriveError && err.kind === 'auth')) throw err;
        google.forget(conn.refreshToken);
        return await fn(await google.accessToken(conn.refreshToken));
      }
    } catch (err) {
      if (err instanceof DriveError && err.kind === 'auth') await deps.store.save({ ...conn, problem: plainDriveError(err) });
      throw err;
    }
  }

  async function folderOf(conn: DriveConnection, access: string): Promise<string> {
    const folderId = await deps.google!.ensureFolder(access, conn.folderId);
    if (folderId !== conn.folderId) {
      conn.folderId = folderId;
      await deps.store.save(conn);
    }
    return folderId;
  }

  return {
    async state(): Promise<DriveState> {
      const conn = await deps.store.get();
      return {
        configured: Boolean(deps.google),
        // A connection kept from before is of no use on a server without the Google settings: nothing
        // is sent (no failing upload and email every night); it can still be disconnected.
        connected: Boolean(conn && deps.google),
        stored: Boolean(conn),
        email: conn?.email ?? null,
        connectedAt: conn?.connectedAt ?? null,
        problem: conn?.problem ?? null,
      };
    },

    connectUrl(userId: string): string {
      if (!deps.google) throw new ConflictError(NOT_SET_UP, 'DRIVE_NOT_SET_UP');
      return deps.google.authUrl(deps.tokens.issue({ userId }, STATE_TTL_MS));
    },

    async complete(answer) {
      const signed = answer.state ? deps.tokens.verify(answer.state) : null;
      const userId = signed?.userId ?? null;
      if (!signed) return { result: 'failed', userId: null, email: null };
      if (answer.error) return { result: answer.error === 'access_denied' ? 'denied' : 'failed', userId, email: null };
      if (!deps.google || !answer.code) return { result: 'failed', userId, email: null };
      try {
        const { refreshToken, accessToken } = await deps.google.exchangeCode(answer.code);
        const who = await deps.google.about(accessToken);
        const folderId = await deps.google.ensureFolder(accessToken, null);
        await deps.store.save({ refreshToken, email: who.email, name: who.name, folderId, connectedAt: now().toISOString(), connectedById: userId, problem: null });
        return { result: 'connected', userId, email: who.email };
      } catch (err) {
        deps.logger?.warn('Google Drive could not be connected', { reason: plainDriveError(err) });
        return { result: 'failed', userId, email: null };
      }
    },

    async disconnect() {
      const conn = await deps.store.get();
      if (!conn) return null;
      if (deps.google && conn.refreshToken) {
        await deps.google.revoke(conn.refreshToken).catch((err) => deps.logger?.warn('the Google Drive access could not be taken back at Google', { reason: plainDriveError(err) }));
      }
      await deps.store.clear();
      return { email: conn.email };
    },

    async upload(file) {
      const conn = await connection();
      const id = await withAccess(conn, async (access) => {
        const folderId = await folderOf(conn, access);
        return (
          await deps.google!.upload(access, {
            path: file.path,
            name: file.name,
            folderId,
            sizeBytes: file.sizeBytes,
            md5: file.md5,
            appProperties: { mico360Backup: '1', createdAt: file.createdAt.toISOString(), sha256: file.sha256, trigger: file.manual ? 'manual' : 'nightly' },
          })
        ).id;
      });
      if (conn.problem) await deps.store.save({ ...conn, problem: null });
      return { fileId: id };
    },

    async applyRetention({ timeZone, weekStart }) {
      const conn = await connection();
      await withAccess(conn, async (access) => {
        const folderId = await folderOf(conn, access);
        const ours = (await deps.google!.list(access, folderId)).filter((f) => f.appProperties.mico360Backup === '1');
        const plan = planBackupRetention(
          ours
            .map((f) => ({ id: f.id, createdAt: new Date(f.appProperties.createdAt ?? f.createdTime), manual: f.appProperties.trigger === 'manual' }))
            .filter((c) => !Number.isNaN(c.createdAt.getTime())),
          { timeZone, weekStart },
        );
        for (const id of plan.remove) await deps.google!.remove(access, id);
      });
    },

    plainError: plainDriveError,
  };
}
