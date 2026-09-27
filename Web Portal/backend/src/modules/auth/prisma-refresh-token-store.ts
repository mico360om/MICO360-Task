import type { PrismaClient } from '@prisma/client';
import type { RefreshTokenStore } from './token-service';

/** Prisma-backed refresh-token store — persists only the token hash; revocation is a soft `revokedAt`. */
export function createPrismaRefreshTokenStore(prisma: PrismaClient): RefreshTokenStore {
  return {
    async save(userId, tokenHash, expiresAt, familyId) {
      await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt, familyId: familyId ?? null } });
    },
    async findValid(tokenHash) {
      const row = await prisma.refreshToken.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { userId: true },
      });
      return row ? { userId: row.userId } : null;
    },
    async revoke(tokenHash) {
      await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    },
    async revokeAllForUser(userId) {
      await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    },
    async rotate(tokenHash, now) {
      // The conditional update is the atomic step: only one request can flip revokedAt from null.
      const { count } = await prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      const row = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: { userId: true, familyId: true, revokedAt: true, expiresAt: true },
      });
      if (!row) return { status: 'invalid' };
      if (count === 1) return { status: 'rotated', userId: row.userId, familyId: row.familyId };
      if (row.revokedAt && row.expiresAt > now) {
        return { status: 'reused', userId: row.userId, familyId: row.familyId, revokedAt: row.revokedAt };
      }
      return { status: 'invalid' };
    },
    async revokeFamily(familyId) {
      await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    },
  };
}
