import type { PrismaClient } from '@prisma/client';
import type { PasswordResetStore } from './password-reset-service';

/**
 * Password-reset tokens are stored in login_otps with purpose PASSWORD_RESET (codeHash = SHA-256 of the
 * token). A welcome email's set-password link (purpose WELCOME) is used on the same page, so it is
 * found here too, and using either kind ends every unused link of both kinds.
 */
const SET_PASSWORD_PURPOSES = { in: ['PASSWORD_RESET', 'WELCOME'] as ('PASSWORD_RESET' | 'WELCOME')[] };

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
        where: { codeHash: tokenHash, purpose: SET_PASSWORD_PURPOSES, consumedAt: null },
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
      await prisma.loginOtp.updateMany({ where: { userId, purpose: SET_PASSWORD_PURPOSES, consumedAt: null }, data: { consumedAt: new Date() } });
    },
  };
}
