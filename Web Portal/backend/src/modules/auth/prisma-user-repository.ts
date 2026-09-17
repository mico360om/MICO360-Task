import type { PrismaClient } from '@prisma/client';
import type { AuthUserRepository } from './user-repository';

/** Prisma-backed implementation of the AuthService's user persistence port. */
export function createPrismaUserRepository(prisma: PrismaClient): AuthUserRepository {
  return {
    async findByIdentifier(identifier) {
      const user = await prisma.user.findFirst({
        where: { OR: [{ email: identifier }, { username: identifier }], deletedAt: null },
        include: { roles: { include: { role: true } } },
      });
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        passwordHash: user.passwordHash,
        status: user.status,
        failedLoginAttempts: user.failedLoginAttempts,
        lockedUntil: user.lockedUntil,
        roles: user.roles.map((r) => r.role.name),
        avatarUrl: user.avatarUrl,
      };
    },
    async findById(userId) {
      const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        include: { roles: { include: { role: true } } },
      });
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        passwordHash: user.passwordHash,
        status: user.status,
        failedLoginAttempts: user.failedLoginAttempts,
        lockedUntil: user.lockedUntil,
        roles: user.roles.map((r) => r.role.name),
        avatarUrl: user.avatarUrl,
      };
    },
    async applyFailedAttempt(userId, attempts, lock) {
      await prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: attempts, ...(lock ? { lockedUntil: new Date() } : {}) },
      });
    },
    async resetFailedAttempts(userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    },
  };
}
