import type { PrismaClient } from '@prisma/client';
import type { ResetUserRepo } from './password-reset-service';

export function createPrismaResetUserRepo(prisma: PrismaClient): ResetUserRepo {
  return {
    async findActiveByIdentifier(identifier) {
      // A locked account is still ACTIVE (lockout is via failed attempts), so it can reset.
      const u = await prisma.user.findFirst({
        where: { OR: [{ email: identifier }, { username: identifier }], status: 'ACTIVE', deletedAt: null },
        select: { id: true, email: true },
      });
      return u ? { id: u.id, email: u.email } : null;
    },
    async setPasswordAndUnlock(userId, passwordHash) {
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
    },
  };
}
