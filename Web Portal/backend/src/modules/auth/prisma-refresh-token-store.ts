import type { PrismaClient } from '@prisma/client';
import type { RefreshTokenStore } from './token-service';

/**
 * Review fix N2 (13 Nov 2026), no migration: Log out marks its session's tokens by writing this in their
 * `successorEnc` (the sealed successor a lost reply can fetch again). It never collides with a sealed value
 * (those carry the secret box's prefix), and nothing is lost: after a logout every token of that session is
 * revoked, so no successor could be handed back anyway. A late copy of a marked token is refused plainly.
 */
export const SIGNED_OUT_MARK = 'signed-out';

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
        if (row.successorEnc === SIGNED_OUT_MARK) return { status: 'reused', userId: row.userId, familyId: row.familyId, revokedAt: row.revokedAt, successorEnc: null, signedOut: true };
        return { status: 'reused', userId: row.userId, familyId: row.familyId, revokedAt: row.revokedAt, successorEnc: row.successorEnc };
      }
      return { status: 'invalid' };
    },
    async setSuccessor(tokenHash, successorEnc) {
      // Never over a logout's mark (a renewal finishing just after the logout must still see it).
      await prisma.refreshToken.updateMany({ where: { tokenHash, OR: [{ successorEnc: null }, { successorEnc: { not: SIGNED_OUT_MARK } }] }, data: { successorEnc } });
    },
    async endSession(tokenHash, at) {
      const row = await prisma.refreshToken.findUnique({ where: { tokenHash }, select: { familyId: true, purpose: true } });
      if (!row) return;
      // A fingerprint key presented here: that key alone (as before). Never a normal logout's business.
      if (row.purpose === 'biometric') {
        await prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: at } });
        return;
      }
      // The whole sign-in: every session token rotated from it (a renewal that raced the logout made one).
      const session = row.familyId ? { familyId: row.familyId, purpose: null } : { tokenHash };
      await prisma.$transaction([
        prisma.refreshToken.updateMany({ where: { ...session, revokedAt: null }, data: { revokedAt: at } }),
        prisma.refreshToken.updateMany({ where: session, data: { successorEnc: SIGNED_OUT_MARK } }),
      ]);
    },
    async signedOut(tokenHash) {
      return (await prisma.refreshToken.count({ where: { tokenHash, successorEnc: SIGNED_OUT_MARK } })) > 0;
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
