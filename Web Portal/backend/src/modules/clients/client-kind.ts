import type { Prisma } from '@prisma/client';
import { ConflictError, ValidationError } from '../../lib/http-errors';

/**
 * Client accounts (1.23): a client is a user whose only role is CLIENT. They sign in like staff but see
 * only the Client portal. They never belong to a company or a project's team and are never an
 * administrator, so every company and team rule already leaves them out; the places that write
 * memberships refuse to break that (assertNotClient), and the people lists that don't go through a
 * company rule add STAFF_ONLY_WHERE.
 */
export const CLIENT_ROLE = 'CLIENT';

/** Any CLIENT role makes the caller a client (a mixed set never widens what they may do). */
export const isClientRoles = (roles: readonly string[] | undefined | null): boolean => !!roles && roles.includes(CLIENT_ROLE);

/** People who are not client accounts (staff pickers, emails and lists). */
export const STAFF_ONLY_WHERE: Prisma.UserWhereInput = { roles: { none: { role: { name: CLIENT_ROLE } } } };

/** Client accounts only. */
export const CLIENT_ONLY_WHERE: Prisma.UserWhereInput = { roles: { some: { role: { name: CLIENT_ROLE } } } };

export const CLIENT_WORDS = {
  notAllowed: 'This isn’t part of the Client portal.',
  clientsOnly: 'The Client portal is for client accounts. Staff use the rest of the site.',
  mixedRoles: 'A client account has the Client role only.',
  roleChange: 'An account can’t be changed between staff and client. Make a new account instead.',
  notStaff: (name: string) => `${name} is a client account: clients can’t be added to companies, teams, tasks or chats.`,
} as const;

/** A role set is either exactly CLIENT or has no CLIENT in it (400 otherwise). */
export function assertRoleSet(roles: readonly string[]): void {
  if (roles.includes(CLIENT_ROLE) && roles.some((r) => r !== CLIENT_ROLE)) throw new ValidationError(CLIENT_WORDS.mixedRoles, { field: 'roleNames' });
}

/** Staff ↔ client changes aren't offered (409 ROLE_CHANGE_NOT_OFFERED). */
export function assertSameKind(current: readonly string[], next: readonly string[]): void {
  if (isClientRoles(current) !== isClientRoles(next)) throw new ConflictError(CLIENT_WORDS.roleChange, 'ROLE_CHANGE_NOT_OFFERED');
}

/** 409 NOT_STAFF: a client account can't be put on a company, team, task or chat. */
export class NotStaffError extends ConflictError {
  constructor(name = 'This person') {
    super(CLIENT_WORDS.notStaff(name), 'NOT_STAFF');
  }
}

/** Which of these people are client accounts (any status), in one query. */
export async function clientIdsAmong(db: Pick<Prisma.TransactionClient, 'user'>, userIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return new Set();
  const rows = await db.user.findMany({ where: { id: { in: ids }, ...CLIENT_ONLY_WHERE }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Refuses (409 NOT_STAFF) when any of these people is a client account. */
export async function assertNotClient(db: Pick<Prisma.TransactionClient, 'user'>, userIds: readonly string[]): Promise<void> {
  const clients = await clientIdsAmong(db, userIds);
  if (clients.size === 0) return;
  const first = [...clients][0]!;
  const u = await db.user.findUnique({ where: { id: first }, select: { firstName: true, lastName: true, username: true } });
  throw new NotStaffError((u && (`${u.firstName} ${u.lastName}`.trim() || u.username)) || undefined);
}

/** Is this person a client account (any status)? One small query; for the places that hear of a user id. */
export function createIsClient(db: Pick<Prisma.TransactionClient, 'userRole'>): (userId: string) => Promise<boolean> {
  return async (userId) => (await db.userRole.count({ where: { userId, role: { name: CLIENT_ROLE } } })) > 0;
}

/** 1.23: the active client accounts with the Meetings module on this project (who may be invited to its meetings). */
export async function projectMeetingClientIds(db: Pick<Prisma.TransactionClient, 'clientProjectGrant'>, projectId: string): Promise<string[]> {
  const rows = await db.clientProjectGrant.findMany({
    where: { projectId, meetings: true, user: { deletedAt: null, status: 'ACTIVE', ...CLIENT_ONLY_WHERE } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
