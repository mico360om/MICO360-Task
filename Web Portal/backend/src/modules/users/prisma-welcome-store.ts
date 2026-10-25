import type { PrismaClient } from '@prisma/client';
import type { WelcomeTokenStore } from './welcome-service';

/**
 * Welcome links are kept with the password-reset links (login_otps, purpose WELCOME; codeHash is the
 * SHA-256 of the token), so the reset page accepts them and using either ends both.
 */
export function createPrismaWelcomeTokenStore(prisma: PrismaClient): WelcomeTokenStore {
  return {
    async create(data) {
      const row = await prisma.loginOtp.create({
        data: { userId: data.userId, codeHash: data.tokenHash, expiresAt: data.expiresAt, attempts: 0, purpose: 'WELCOME' },
        select: { id: true },
      });
      return row.id;
    },
    async replaceEarlier(userId, keepId) {
      await prisma.loginOtp.updateMany({
        where: { userId, purpose: 'WELCOME', consumedAt: null, id: { not: keepId } },
        data: { consumedAt: new Date() },
      });
    },
    async discard(id) {
      await prisma.loginOtp.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    },
  };
}
