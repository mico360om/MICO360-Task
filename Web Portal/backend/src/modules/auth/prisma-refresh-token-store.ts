import type { PrismaClient } from '@prisma/client';
import type { RefreshTokenStore } from './token-service';

/** Prisma-backed refresh-token store — persists only the token hash; revocation is a soft `revokedAt`. */
export function createPrismaRefreshTokenStore(prisma: PrismaClient): RefreshTokenStore {
  return {
    async save(userId, tokenHash, expiresAt) {
      await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
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
  };
}
