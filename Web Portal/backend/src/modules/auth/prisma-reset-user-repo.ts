import type { PrismaClient } from '@prisma/client';
import type { ResetUserRepo } from './password-reset-service';

export function createPrismaResetUserRepo(prisma: PrismaClient): ResetUserRepo {
  return {
    async findActiveByIdentifier(identifier) {
      // A locked account is still ACTIVE (lockout is via failed attempts), so it can reset. 1.23.6: a
      // cancelled invitation can't (the same answer as an unknown account).
      const u = await prisma.user.findFirst({
        where: { OR: [{ email: identifier }, { username: identifier }], status: 'ACTIVE', deletedAt: null, invitationCancelledAt: null },
        select: { id: true, email: true },
      });
      return u ? { id: u.id, email: u.email } : null;
    },
    async findById(userId) {
      const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, email: true, status: true } });
      return u ? { id: u.id, email: u.email, status: u.status } : null;
    },
    async isActivated(userId) {
      return (await prisma.user.count({ where: { id: userId, deletedAt: null, OR: [{ activatedAt: { not: null } }, { lastLoginAt: { not: null } }] } })) === 1;
    },
    async isActive(userId) {
      // 1.23.6: a cancelled invitation ends every link (a link sent before reads as expired).
      return (await prisma.user.count({ where: { id: userId, status: 'ACTIVE', deletedAt: null, invitationCancelledAt: null } })) === 1;
    },
    async setPasswordAndUnlock(userId, passwordHash) {
      await prisma.user.update({
        where: { id: userId },
        // 1.23.6: their own password now — an unused temporary one (and its forced change) is over.
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          tokenVersion: { increment: 1 },
          mustChangePassword: false,
          temporaryPasswordSetAt: null,
          temporaryPasswordSetById: null,
          temporaryPasswordExpiresAt: null,
        },
      });
    },
  };
}
