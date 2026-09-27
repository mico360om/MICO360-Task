import type { PrismaClient } from '@prisma/client';
import type { OtpStore } from './otp-service';

export function createPrismaOtpStore(prisma: PrismaClient): OtpStore {
  return {
    async create(data) {
      const now = new Date();
      // Reissuing invalidates the previous code, so only the latest one can be guessed at.
      await prisma.$transaction([
        prisma.loginOtp.updateMany({ where: { userId: data.userId, purpose: 'LOGIN', consumedAt: null }, data: { consumedAt: now } }),
        prisma.loginOtp.create({
          data: { userId: data.userId, codeHash: data.codeHash, expiresAt: data.expiresAt, attempts: data.attempts, purpose: 'LOGIN' },
        }),
      ]);
    },
    async findActiveForUser(userId) {
      const o = await prisma.loginOtp.findFirst({ where: { userId, purpose: 'LOGIN', consumedAt: null }, orderBy: { createdAt: 'desc' } });
      return o ? { id: o.id, userId: o.userId, codeHash: o.codeHash, expiresAt: o.expiresAt, attempts: o.attempts, consumedAt: o.consumedAt } : null;
    },
    async countIssuedSince(userId, since) {
      return prisma.loginOtp.count({ where: { userId, purpose: 'LOGIN', createdAt: { gte: since } } });
    },
    async countFailuresSince(userId, since) {
      const agg = await prisma.loginOtp.aggregate({ where: { userId, purpose: 'LOGIN', createdAt: { gte: since } }, _sum: { attempts: true } });
      return agg._sum.attempts ?? 0;
    },
    async claimAttempt(id, max) {
      const { count } = await prisma.loginOtp.updateMany({
        where: { id, consumedAt: null, attempts: { lt: max } },
        data: { attempts: { increment: 1 } },
      });
      return count === 1;
    },
    async consume(id) {
      // attempts - 1: the successful guess isn't a failure for the per-account cap.
      const { count } = await prisma.loginOtp.updateMany({
        where: { id, consumedAt: null },
        data: { consumedAt: new Date(), attempts: { decrement: 1 } },
      });
      return count === 1;
    },
  };
}
