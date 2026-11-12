import type { PrismaClient, Prisma } from '@prisma/client';
import { ValidationError } from '../../lib/http-errors';
import { isLocked } from '../../lib/lockout';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../../lib/password';
import { withSentinelLock } from '../../lib/sentinel-lock';
import type { AdminHeldUsers, CreateUserData, TemporaryPasswordMark, UserListFilter, UserRepository, UserSummary } from './user-repository';
import { liveInvitation, onboardingStatus } from './onboarding-status';

// companies: each person comes with their companies (the admin views show them).
// Onboarding: and their newest invitation link that still works (its expiry only).
const withRoles = {
  roles: { include: { role: true } },
  // Training Center: the department's name beside its id (User Management's Department field).
  department: { select: { name: true } },
  companies: { select: { company: { select: { id: true, name: true, code: true } } } },
  loginOtps: liveInvitation(new Date(0)),
  // 1.23.6: who set a temporary password (their name only).
  temporaryPasswordSetBy: { select: { id: true, firstName: true, lastName: true, username: true } },
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
    onboarding: onboardingStatus({
      status: u.status,
      locked,
      activatedAt: u.activatedAt,
      lastLoginAt: u.lastLoginAt,
      invitedAt: u.invitedAt,
      welcomeSentAt: u.welcomeSentAt,
      inviteExpiresAt,
      mustChangePassword: u.mustChangePassword,
      temporaryPasswordExpiresAt: u.temporaryPasswordExpiresAt,
      invitationCancelledAt: u.invitationCancelledAt,
    }),
    mustChangePassword: u.mustChangePassword,
    temporaryPasswordSetAt: u.temporaryPasswordSetAt,
    temporaryPasswordSetBy: u.temporaryPasswordSetBy
      ? { id: u.temporaryPasswordSetBy.id, name: `${u.temporaryPasswordSetBy.firstName} ${u.temporaryPasswordSetBy.lastName}`.trim() || u.temporaryPasswordSetBy.username }
      : null,
    temporaryPasswordExpiresAt: u.temporaryPasswordExpiresAt,
    invitationCancelledAt: u.invitationCancelledAt,
    roles: u.roles.map((r) => r.role.name),
    locked,
    lockedUntil: locked ? u.lockedUntil : null,
    companies: u.companies.map((m) => m.company).sort((a, b) => a.name.localeCompare(b.name)),
    primaryCompanyId: u.primaryCompanyId,
    myProjectsOnly: u.myProjectsOnly,
    reportsToId: u.reportsToId,
    trainingManager: u.trainingManager,
    departmentName: u.department?.name ?? null,
  };
}

/** 1.23.6: the temporary-password columns for a mark (none: all cleared). */
function temporaryFields(t: TemporaryPasswordMark | undefined) {
  return { mustChangePassword: !!t, temporaryPasswordSetAt: t?.at ?? null, temporaryPasswordSetById: t?.setById ?? null, temporaryPasswordExpiresAt: t?.expiresAt ?? null };
}

const MAX_IDENTITY_LENGTH = 191; // VARCHAR(191) on MySQL

/** A unique, recognisable replacement for a deleted account's email / username. */
export function tombstone(value: string, id: string): string {
  const tag = `~deleted-${id.slice(-8)}-${Date.now().toString(36)}`;
  return `${value.slice(0, MAX_IDENTITY_LENGTH - tag.length)}${tag}`;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Resolve role names to ids, refusing unknown names (they'd silently leave the user roleless). */
async function resolveRoles(db: Db, names: string[]) {
  const unique = [...new Set(names)];
  const found = await db.role.findMany({ where: { name: { in: unique } } });
  const missing = unique.filter((n) => !found.some((r) => r.name === n));
  if (missing.length) throw new ValidationError(`Unknown role: ${missing.join(', ')}`);
  return found;
}

/**
 * Review fix #8: the reads and writes a change that could remove an administrator makes — on the
 * client, or inside the transaction that holds the administrators (`withAdminsHeld`).
 */
function heldUsers(db: Db): AdminHeldUsers {
  return {
    async findById(id) {
      const u = await db.user.findFirst({ where: { id, deletedAt: null }, include: include() });
      return u ? toSummary(u) : null;
    },
    async update(id, patch) {
      const { roleNames, ...scalar } = patch;
      // When roleNames is supplied, replace the join rows with exactly those roles.
      let roles: Prisma.UserUpdateInput['roles'] | undefined;
      if (roleNames) {
        const found = await resolveRoles(db, roleNames);
        roles = { deleteMany: {}, create: found.map((r) => ({ roleId: r.id })) };
      }
      const u = await db.user.update({
        where: { id },
        data: { ...scalar, ...(roles ? { roles } : {}) },
        include: include(),
      });
      return toSummary(u);
    },
    async setStatus(id, status) {
      const u = await db.user.update({ where: { id }, data: { status }, include: include() });
      return toSummary(u);
    },
    async softDelete(id) {
      const u = await db.user.findUnique({ where: { id }, select: { email: true, username: true } });
      if (!u) return;
      // Email and username are unique columns: rename them so the address can be reused later.
      await db.user.update({
        where: { id },
        data: { deletedAt: new Date(), email: tombstone(u.email, id), username: tombstone(u.username, id) },
      });
    },
    async countActiveAdmins(excludeId) {
      return db.user.count({
        where: {
          status: 'ACTIVE',
          deletedAt: null,
          roles: { some: { role: { name: 'ADMIN' } } },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      });
    },
  };
}

/** The sentinel row (job_locks) every change that could remove an administrator locks first. */
export const ADMIN_GUARD_LOCK = 'admin-guard';

export function createPrismaUserRepository(prisma: PrismaClient): UserRepository {
  const held = heldUsers(prisma);
  return {
    ...held,
    async create(data: CreateUserData) {
      const roles = await resolveRoles(prisma, data.roleNames);
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
          ...temporaryFields(data.temporary),
        },
        include: include(),
      });
      return toSummary(u);
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
    async setAvatar(id, avatarUrl) {
      const u = await prisma.user.update({ where: { id }, data: { avatarUrl }, include: include() });
      return toSummary(u);
    },
    async setPassword(id, passwordHash, temporary) {
      const now = new Date();
      await prisma.$transaction([
        prisma.user.update({
          where: { id },
          // 1.23.6: a temporary password ends a cancelled invitation; the person's own clears the mark.
          data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null, ...temporaryFields(temporary), ...(temporary ? { invitationCancelledAt: null } : {}) },
        }),
        // Earlier reset and welcome links must not be able to change the password again.
        prisma.loginOtp.updateMany({ where: { userId: id, purpose: { in: ['PASSWORD_RESET', 'WELCOME'] }, consumedAt: null }, data: { consumedAt: now } }),
      ]);
    },
    async endPasswordLinks(id) {
      await prisma.loginOtp.updateMany({ where: { userId: id, purpose: { in: ['PASSWORD_RESET', 'WELCOME'] }, consumedAt: null }, data: { consumedAt: new Date() } });
    },
    async markWelcomeSent(id, at) {
      await prisma.user.updateMany({ where: { id }, data: { welcomeSentAt: at, invitationCancelledAt: null } });
      // Onboarding: the first invitation's time stays ("Invited 5 Nov · resent 7 Nov").
      await prisma.user.updateMany({ where: { id, invitedAt: null }, data: { invitedAt: at } });
      // 1.23.6: one way in or the other — an unused temporary password stops working with a new invitation.
      if ((await prisma.user.count({ where: { id, mustChangePassword: true } })) > 0) {
        const unusable = await hashPassword(randomBytes(32).toString('base64url'));
        await prisma.user.updateMany({ where: { id, mustChangePassword: true }, data: { passwordHash: unusable, ...temporaryFields(undefined) } });
      }
    },
    async endTemporaryPassword(id, unusableHash) {
      const { count } = await prisma.user.updateMany({ where: { id, mustChangePassword: true }, data: { passwordHash: unusableHash, ...temporaryFields(undefined) } });
      return count === 1;
    },
    async cancelInvitation(id, at, unusableHash) {
      // Only while the account has never become theirs (checked again in the write itself): every password
      // it has — a temporary one, or one typed before 1.23.6 — stops, and every link ends.
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.user.updateMany({
          where: { id, deletedAt: null, activatedAt: null, lastLoginAt: null },
          data: { invitationCancelledAt: at, passwordHash: unusableHash, ...temporaryFields(undefined) },
        });
        if (count !== 1) return false;
        await tx.loginOtp.updateMany({ where: { userId: id, purpose: { in: ['PASSWORD_RESET', 'WELCOME'] }, consumedAt: null }, data: { consumedAt: at } });
        return true;
      });
    },
    async getPasswordHash(id) {
      const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, select: { passwordHash: true } });
      return u?.passwordHash ?? null;
    },
    async bumpTokenVersion(id) {
      const u = await prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } }, select: { tokenVersion: true } });
      return u.tokenVersion;
    },
    async unlock(id) {
      const u = await prisma.user.update({ where: { id }, data: { failedLoginAttempts: 0, lockedUntil: null }, include: include() });
      return toSummary(u);
    },
    async withAdminsHeld(work) {
      return withSentinelLock(prisma, ADMIN_GUARD_LOCK, (tx) => work(heldUsers(tx)));
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
