import type { PrismaClient } from '@prisma/client';
import type { PasswordResetStore } from './password-reset-service';

/** Password-reset tokens are stored in login_otps with purpose PASSWORD_RESET (codeHash = SHA-256 of the token). */
export function createPrismaPasswordResetStore(prisma: PrismaClient): PasswordResetStore {
  return {
    async create(data) {
      // Only the newest link works: issuing one invalidates the earlier unused ones.
      await prisma.$transaction([
        prisma.loginOtp.updateMany({ where: { userId: data.userId, purpose: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: new Date() } }),
        prisma.loginOtp.create({
          data: { userId: data.userId, codeHash: data.tokenHash, expiresAt: data.expiresAt, attempts: 0, purpose: 'PASSWORD_RESET' },
        }),
      ]);
    },
    async findActiveByHash(tokenHash) {
      const r = await prisma.loginOtp.findFirst({
        where: { codeHash: tokenHash, purpose: 'PASSWORD_RESET', consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return r ? { id: r.id, userId: r.userId, tokenHash: r.codeHash, expiresAt: r.expiresAt, consumedAt: r.consumedAt } : null;
    },
    async countIssuedSince(userId, since) {
      return prisma.loginOtp.count({ where: { userId, purpose: 'PASSWORD_RESET', createdAt: { gte: since } } });
    },
    async consume(id) {
      const { count } = await prisma.loginOtp.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
      return count === 1;
    },
    async consumeAllForUser(userId) {
      await prisma.loginOtp.updateMany({ where: { userId, purpose: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: new Date() } });
    },
  };
}
