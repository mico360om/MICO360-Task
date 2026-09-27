import type { PrismaClient, Prisma } from '@prisma/client';
import { ValidationError } from '../../lib/http-errors';
import { isLocked } from '../../lib/lockout';
import type { CreateUserData, UserRepository, UserSummary } from './user-repository';

type UserWithRoles = Prisma.UserGetPayload<{ include: { roles: { include: { role: true } } } }>;
const withRoles = { roles: { include: { role: true } } } as const;

function toSummary(u: UserWithRoles): UserSummary {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    avatarUrl: u.avatarUrl,
    status: u.status,
    departmentId: u.departmentId,
    lastActiveAt: u.lastActiveAt,
    roles: u.roles.map((r) => r.role.name),
    locked: isLocked(u.lockedUntil),
    lockedUntil: isLocked(u.lockedUntil) ? u.lockedUntil : null,
  };
}

const MAX_IDENTITY_LENGTH = 191; // VARCHAR(191) on MySQL

/** A unique, recognisable replacement for a deleted account's email / username. */
export function tombstone(value: string, id: string): string {
  const tag = `~deleted-${id.slice(-8)}-${Date.now().toString(36)}`;
  return `${value.slice(0, MAX_IDENTITY_LENGTH - tag.length)}${tag}`;
}

export function createPrismaUserRepository(prisma: PrismaClient): UserRepository {
  /** Resolve role names to ids, refusing unknown names (they'd silently leave the user roleless). */
  async function resolveRoles(names: string[]) {
    const unique = [...new Set(names)];
    const found = await prisma.role.findMany({ where: { name: { in: unique } } });
    const missing = unique.filter((n) => !found.some((r) => r.name === n));
    if (missing.length) throw new ValidationError(`Unknown role: ${missing.join(', ')}`);
    return found;
  }

  return {
    async create(data: CreateUserData) {
      const roles = await resolveRoles(data.roleNames);
      const u = await prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          passwordHash: data.passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          departmentId: data.departmentId ?? undefined,
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
        include: withRoles,
      });
      return toSummary(u);
    },
    async findById(id) {
      const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: withRoles });
      return u ? toSummary(u) : null;
    },
    async findByEmailOrUsername(email, username) {
      const u = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }], deletedAt: null },
        include: withRoles,
      });
      return u ? toSummary(u) : null;
    },
    async list() {
      const us = await prisma.user.findMany({ where: { deletedAt: null }, include: withRoles, orderBy: { createdAt: 'desc' } });
      return us.map(toSummary);
    },
    async update(id, patch) {
      const { roleNames, ...scalar } = patch;
      // When roleNames is supplied, replace the join rows with exactly those roles.
      let roles: Prisma.UserUpdateInput['roles'] | undefined;
      if (roleNames) {
        const found = await resolveRoles(roleNames);
        roles = { deleteMany: {}, create: found.map((r) => ({ roleId: r.id })) };
      }
      const u = await prisma.user.update({
        where: { id },
        data: { ...scalar, ...(roles ? { roles } : {}) },
        include: withRoles,
      });
      return toSummary(u);
    },
    async setStatus(id, status) {
      const u = await prisma.user.update({ where: { id }, data: { status }, include: withRoles });
      return toSummary(u);
    },
    async setAvatar(id, avatarUrl) {
      const u = await prisma.user.update({ where: { id }, data: { avatarUrl }, include: withRoles });
      return toSummary(u);
    },
    async setPassword(id, passwordHash) {
      const now = new Date();
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } }),
        // Earlier reset links must not be able to change the password again.
        prisma.loginOtp.updateMany({ where: { userId: id, purpose: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: now } }),
      ]);
    },
    async getPasswordHash(id) {
      const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { passwordHash: true } });
      return u?.passwordHash ?? null;
    },
    async softDelete(id) {
      const u = await prisma.user.findUnique({ where: { id }, select: { email: true, username: true } });
      if (!u) return;
      // Email and username are unique columns: rename them so the address can be reused later.
      await prisma.user.update({
        where: { id },
        data: { deletedAt: new Date(), email: tombstone(u.email, id), username: tombstone(u.username, id) },
      });
    },
    async bumpTokenVersion(id) {
      const u = await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } }, select: { tokenVersion: true } });
      return u.tokenVersion;
    },
    async unlock(id) {
      const u = await prisma.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null }, include: withRoles });
      return toSummary(u);
    },
    async countActiveAdmins(excludeId) {
      return prisma.user.count({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          roles: { some: { role: { name: 'ADMIN' } } },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      });
    },
    async releaseDeletedIdentity(email, username) {
      const stale = await prisma.user.findMany({
        where: { deletedAt: { not: null }, OR: [{ email }, { username }] },
        select: { id: true, email: true, username: true },
      });
      for (const u of stale) {
        await prisma.user.update({ where: { id: u.id }, data: { email: tombstone(u.email, u.id), username: tombstone(u.username, u.id) } });
      }
    },
  };
}
