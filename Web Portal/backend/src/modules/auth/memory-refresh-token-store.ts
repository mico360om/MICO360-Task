import type { RefreshTokenStore } from './token-service';

export interface MemoryRefreshRow {
  userId: string;
  hash: string;
  expiresAt: Date;
  familyId: string | null;
  revokedAt: Date | null;
}

/** In-memory refresh-token store with the same rotation semantics as the Prisma one (tests / dev). */
export function createMemoryRefreshTokenStore(): RefreshTokenStore & { rows: MemoryRefreshRow[] } {
  const rows: MemoryRefreshRow[] = [];
  return {
    rows,
    async save(userId, hash, expiresAt, familyId) {
      rows.push({ userId, hash, expiresAt, familyId: familyId ?? null, revokedAt: null });
    },
    async findValid(hash) {
      const r = rows.find((x) => x.hash === hash && x.revokedAt === null && x.expiresAt.getTime() > Date.now());
      return r ? { userId: r.userId } : null;
    },
    async revoke(hash) {
      const r = rows.find((x) => x.hash === hash && x.revokedAt === null);
      if (r) r.revokedAt = new Date();
    },
    async revokeAllForUser(userId) {
      for (const r of rows) if (r.userId === userId && r.revokedAt === null) r.revokedAt = new Date();
    },
    async rotate(hash, now) {
      const r = rows.find((x) => x.hash === hash);
      if (!r || r.expiresAt.getTime() <= now.getTime()) return { status: 'invalid' };
      if (r.revokedAt === null) {
        r.revokedAt = now;
        return { status: 'rotated', userId: r.userId, familyId: r.familyId };
      }
      return { status: 'reused', userId: r.userId, familyId: r.familyId, revokedAt: r.revokedAt };
    },
    async revokeFamily(familyId) {
      for (const r of rows) if (r.familyId === familyId && r.revokedAt === null) r.revokedAt = new Date();
    },
  };
}
