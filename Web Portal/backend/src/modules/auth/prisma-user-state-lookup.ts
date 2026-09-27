import type { PrismaClient } from '@prisma/client';
import type { UserStateLookup } from './auth-guard';

/** Live account state for the auth guard: token version, ACTIVE-and-not-deleted, current roles. */
export function createPrismaUserStateLookup(prisma: PrismaClient): UserStateLookup {
  return async (userId) => {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true, status: true, deletedAt: true, roles: { select: { role: { select: { name: true } } } } },
    });
    if (!u) return null;
    return {
      tokenVersion: u.tokenVersion,
      active: u.status === 'ACTIVE' && u.deletedAt === null,
      roles: u.roles.map((r) => r.role.name),
    };
  };
}
