import type { PrismaClient } from '@prisma/client';
import type { OtpStore } from './otp-service';

export function createPrismaOtpStore(prisma: PrismaClient): OtpStore {
  return {
    async create(data) {
      await prisma.loginOtp.create({
        data: { userId: data.userId, codeHash: data.codeHash, expiresAt: data.expiresAt, attempts: data.attempts, purpose: 'LOGIN' },
      });
    },
    async findActiveForUser(userId) {
      const o = await prisma.loginOtp.findFirst({ where: { userId, purpose: 'LOGIN', consumedAt: null }, orderBy: { createdAt: 'desc' } });
      return o ? { id: o.id, userId: o.userId, codeHash: o.codeHash, expiresAt: o.expiresAt, attempts: o.attempts, consumedAt: o.consumedAt } : null;
    },
    async incrementAttempts(id) {
      await prisma.loginOtp.update({ where: { id }, data: { attempts: { increment: 1 } } });
    },
    async consume(id) {
      await prisma.loginOtp.update({ where: { id }, data: { consumedAt: new Date() } });
    },
  };
}
