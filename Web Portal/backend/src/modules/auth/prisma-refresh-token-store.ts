import type { PrismaClient } from '@prisma/client';
import type { RefreshTokenStore } from './token-service';

/** Prisma-backed refresh-token store — persists only the token hash; revocation is a soft `revokedAt`. */
export function createPrismaRefreshTokenStore(prisma: PrismaClient): RefreshTokenStore {
  return {
    async save(userId, tokenHash, expiresAt, familyId, purpose) {
      await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt, familyId: familyId ?? null, purpose: purpose ?? null } });
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
        select: { userId: true, familyId: true, revokedAt: true, expiresAt: true, successorEnc: true },
      });
      if (!row) return { status: 'invalid' };
      if (count === 1) return { status: 'rotated', userId: row.userId, familyId: row.familyId };
      if (row.revokedAt && row.expiresAt > now) {
        return { status: 'reused', userId: row.userId, familyId: row.familyId, revokedAt: row.revokedAt, successorEnc: row.successorEnc };
      }
      return { status: 'invalid' };
    },
    async setSuccessor(tokenHash, successorEnc) {
      await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { successorEnc } });
    },
    async revokeFamily(familyId) {
      await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    },
    async revokeBiometricKeys(userId) {
      await prisma.refreshToken.updateMany({ where: { userId, purpose: 'biometric', revokedAt: null }, data: { revokedAt: new Date() } });
    },
    async extendBiometricKeys(userId, expiresAt, now) {
      // Only live keys that end sooner: never moved back, never brought back once ended.
      await prisma.refreshToken.updateMany({
        where: { userId, purpose: 'biometric', revokedAt: null, expiresAt: { gt: now, lt: expiresAt } },
        data: { expiresAt },
      });
    },
  };
}
