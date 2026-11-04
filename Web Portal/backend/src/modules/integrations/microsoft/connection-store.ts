import type { PrismaClient } from '@prisma/client';

/** One person's connected Microsoft account (Settings → Microsoft Teams). The refresh token is sealed. */
export interface MicrosoftConnectionRow {
  userId: string;
  tenantId: string;
  microsoftUserId: string;
  email: string | null;
  displayName: string | null;
  /** The refresh token sealed with MS_TOKEN_KEY (token-crypto.ts); null once Microsoft refused it. */
  refreshTokenEnc: string | null;
  /** Why the connection stopped working ("connect again"), shown in Settings. */
  problem: string | null;
  connectedAt: Date;
}

export interface MicrosoftConnectionStore {
  get(userId: string): Promise<MicrosoftConnectionRow | null>;
  /** Insert or replace the person's connection (connecting again replaces the old one). */
  save(row: MicrosoftConnectionRow): Promise<void>;
  setToken(userId: string, refreshTokenEnc: string): Promise<void>;
  /** The connection stopped working: say why and drop the token. */
  setProblem(userId: string, problem: string): Promise<void>;
  /** true when there was one. */
  remove(userId: string): Promise<boolean>;
}

export function createMemoryConnectionStore(): MicrosoftConnectionStore {
  const rows = new Map<string, MicrosoftConnectionRow>();
  return {
    async get(userId) {
      const r = rows.get(userId);
      return r ? { ...r } : null;
    },
    async save(row) {
      rows.set(row.userId, { ...row });
    },
    async setToken(userId, refreshTokenEnc) {
      const r = rows.get(userId);
      if (r) rows.set(userId, { ...r, refreshTokenEnc, problem: null });
    },
    async setProblem(userId, problem) {
      const r = rows.get(userId);
      if (r) rows.set(userId, { ...r, refreshTokenEnc: null, problem });
    },
    async remove(userId) {
      return rows.delete(userId);
    },
  };
}

export function createPrismaConnectionStore(prisma: PrismaClient): MicrosoftConnectionStore {
  const select = { userId: true, tenantId: true, microsoftUserId: true, email: true, displayName: true, refreshTokenEnc: true, problem: true, connectedAt: true } as const;
  return {
    get: (userId) => prisma.microsoftConnection.findUnique({ where: { userId }, select }),
    async save(row) {
      const data = { tenantId: row.tenantId, microsoftUserId: row.microsoftUserId, email: row.email, displayName: row.displayName, refreshTokenEnc: row.refreshTokenEnc, problem: row.problem, connectedAt: row.connectedAt };
      await prisma.microsoftConnection.upsert({ where: { userId: row.userId }, create: { userId: row.userId, ...data }, update: data });
    },
    async setToken(userId, refreshTokenEnc) {
      await prisma.microsoftConnection.updateMany({ where: { userId }, data: { refreshTokenEnc, problem: null } });
    },
    async setProblem(userId, problem) {
      await prisma.microsoftConnection.updateMany({ where: { userId }, data: { refreshTokenEnc: null, problem: problem.slice(0, 300) } });
    },
    async remove(userId) {
      return (await prisma.microsoftConnection.deleteMany({ where: { userId } })).count > 0;
    },
  };
}
