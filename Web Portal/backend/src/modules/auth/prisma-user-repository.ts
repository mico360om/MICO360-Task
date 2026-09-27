import type { PrismaClient, Prisma } from '@prisma/client';
import type { AuthUser, AuthUserRepository } from './user-repository';

type UserWithRoles = Prisma.UserGetPayload<{ include: { roles: { include: { role: true } } } }>;

function toAuthUser(user: UserWithRoles): AuthUser {
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
    tokenVersion: user.tokenVersion,
  };
}

/** Prisma-backed implementation of the AuthService's user persistence port. */
export function createPrismaUserRepository(prisma: PrismaClient): AuthUserRepository {
  return {
    async findByIdentifier(identifier) {
      const user = await prisma.user.findFirst({
        where: { OR: [{ email: identifier }, { username: identifier }], deletedAt: null },
        include: { roles: { include: { role: true } } },
      });
      return user ? toAuthUser(user) : null;
    },
    async findById(userId) {
      const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        include: { roles: { include: { role: true } } },
      });
      return user ? toAuthUser(user) : null;
    },
    async applyFailedAttempt(userId, attempts, lockedUntil, expected) {
      // Compare-and-set on the counter: of several parallel attempts only one moves it on.
      const { count } = await prisma.user.updateMany({
        where: { id: userId, ...(expected !== undefined ? { failedLoginAttempts: expected } : {}) },
        data: { failedLoginAttempts: attempts, ...(lockedUntil ? { lockedUntil } : {}) },
      });
      return count === 1;
    },
    async resetFailedAttempts(userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    },
  };
}
