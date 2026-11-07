import type { PrismaClient, Prisma } from '@prisma/client';
import { ValidationError } from '../../lib/http-errors';
import { isLocked } from '../../lib/lockout';
import type { CreateUserData, UserListFilter, UserRepository, UserSummary } from './user-repository';
import { liveInvitation, onboardingStatus } from './onboarding-status';

// companies: each person comes with their companies (the admin views show them).
// Onboarding: and their newest invitation link that still works (its expiry only).
const withRoles = {
  roles: { include: { role: true } },
  companies: { select: { company: { select: { id: true, name: true, code: true } } } },
  loginOtps: liveInvitation(new Date(0)),
} as const;
/** The include, with "still works" judged now. */
const include = () => ({ ...withRoles, loginOtps: liveInvitation(new Date()) });
type UserWithRoles = Prisma.UserGetPayload<{ include: typeof withRoles }>;

/** companies: `GET /users?companyId=<id>|none`. */
function companyFilter(filter: UserListFilter | undefined): Prisma.UserWhereInput {
  if (!filter?.companyId) return {};
  return filter.companyId === 'none' ? { companies: { none: {} } } : { companies: { some: { companyId: filter.companyId } } };
}

function toSummary(u: UserWithRoles): UserSummary {
  const locked = isLocked(u.lockedUntil);
  const inviteExpiresAt = u.loginOtps[0]?.expiresAt ?? null;
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
    lastLoginAt: u.lastLoginAt,
    welcomeSentAt: u.welcomeSentAt,
    invitedAt: u.invitedAt,
    activatedAt: u.activatedAt,
    emailVerifiedAt: u.emailVerifiedAt,
    inviteExpiresAt,
    onboarding: onboardingStatus({ status: u.status, locked, activatedAt: u.activatedAt, lastLoginAt: u.lastLoginAt, invitedAt: u.invitedAt, welcomeSentAt: u.welcomeSentAt, inviteExpiresAt }),
    roles: u.roles.map((r) => r.role.name),
    locked,
    lockedUntil: locked ? u.lockedUntil : null,
    companies: u.companies.map((m) => m.company).sort((a, b) => a.name.localeCompare(b.name)),
    primaryCompanyId: u.primaryCompanyId,
    myProjectsOnly: u.myProjectsOnly,
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
          // companies: their companies and primary company, as User Management's rules chose them.
          ...(data.companyIds?.length ? { companies: { create: [...new Set(data.companyIds)].map((companyId) => ({ companyId })) } } : {}),
          primaryCompanyId: data.primaryCompanyId ?? null,
        },
        include: include(),
      });
      return toSummary(u);
    },
    async findById(id) {
      const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: include() });
      return u ? toSummary(u) : null;
    },
    async findByEmailOrUsername(email, username) {
      const u = await prisma.user.findFirst({
        where: { OR: [{ email }, { username }], deletedAt: null },
        include: include(),
      });
      return u ? toSummary(u) : null;
    },
    async list(filter) {
      const us = await prisma.user.findMany({ where: { deletedAt: null, ...companyFilter(filter) }, include: include(), orderBy: { createdAt: 'desc' } });
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
        include: include(),
      });
      return toSummary(u);
    },
    async setStatus(id, status) {
      const u = await prisma.user.update({ where: { id }, data: { status }, include: include() });
      return toSummary(u);
    },
    async setAvatar(id, avatarUrl) {
      const u = await prisma.user.update({ where: { id }, data: { avatarUrl }, include: include() });
      return toSummary(u);
    },
    async setPassword(id, passwordHash) {
      const now = new Date();
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } }),
        // Earlier reset and welcome links must not be able to change the password again.
        prisma.loginOtp.updateMany({ where: { userId: id, purpose: { in: ['PASSWORD_RESET', 'WELCOME'] }, consumedAt: null }, data: { consumedAt: now } }),
      ]);
    },
    async endPasswordLinks(id) {
      await prisma.loginOtp.updateMany({ where: { userId: id, purpose: { in: ['PASSWORD_RESET', 'WELCOME'] }, consumedAt: null }, data: { consumedAt: new Date() } });
    },
    async markWelcomeSent(id, at) {
      await prisma.user.updateMany({ where: { id }, data: { welcomeSentAt: at } });
      // Onboarding: the first invitation's time stays ("Invited 5 Nov · resent 7 Nov").
      await prisma.user.updateMany({ where: { id, invitedAt: null }, data: { invitedAt: at } });
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
      const u = await prisma.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null }, include: include() });
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
