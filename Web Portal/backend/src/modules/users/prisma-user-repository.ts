import type { PrismaClient, Prisma } from '@prisma/client';
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
  };
}

export function createPrismaUserRepository(prisma: PrismaClient): UserRepository {
  return {
    async create(data: CreateUserData) {
      const roles = await prisma.role.findMany({ where: { name: { in: data.roleNames } } });
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
        const found = await prisma.role.findMany({ where: { name: { in: roleNames } } });
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
      await prisma.user.update({ where: { id }, data: { passwordHash } });
    },
    async getPasswordHash(id) {
      const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { passwordHash: true } });
      return u?.passwordHash ?? null;
    },
    async softDelete(id) {
      await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  };
}
