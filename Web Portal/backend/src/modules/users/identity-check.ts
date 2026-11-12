import type { PrismaClient, Prisma } from '@prisma/client';
import { CLIENT_ONLY_WHERE, STAFF_ONLY_WHERE, isClientRoles } from '../clients/client-kind';

/**
 * Onboarding: the duplicate check the New and Manage account forms run while an administrator types —
 * "This email is already used by Ahmed Al Harthy (client) — Open account", "Username taken", and a
 * gentle "A client named Saif at Acme already exists". Emails and usernames compare trimmed and
 * case-insensitive (the columns' collation); deleted accounts never count (their identity is freed).
 * The server still refuses a real duplicate on save (409); this only says so sooner.
 */
export interface IdentityMatch {
  id: string;
  name: string;
  username: string;
  kind: 'client' | 'staff';
  organisation: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export interface IdentityLookup {
  byEmail(email: string): Promise<IdentityMatch | null>;
  byUsername(username: string): Promise<IdentityMatch | null>;
  /** People with this first and last name: clients at this organisation, or staff. */
  sameName(firstName: string, lastName: string, opts: { client: boolean; organisation: string | null }): Promise<IdentityMatch[]>;
}

export interface IdentityQuery {
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  organisation?: string | null;
  client?: boolean;
  /** The account being edited (never a clash with itself). */
  excludeId?: string;
}

export interface IdentityAnswer {
  email: IdentityMatch | null;
  username: IdentityMatch | null;
  sameName: IdentityMatch[];
}

export async function checkIdentity(lookup: IdentityLookup, q: IdentityQuery): Promise<IdentityAnswer> {
  const other = (m: IdentityMatch | null) => (m && m.id !== q.excludeId ? m : null);
  const email = q.email?.trim();
  const username = q.username?.trim();
  const first = q.firstName?.trim();
  const last = q.lastName?.trim();
  const organisation = q.organisation?.trim() || null;
  // A client's same-name warning needs the organisation (it is "at Acme"); staff compare by name alone.
  const askName = !!first && !!last && (!q.client || !!organisation);
  const [byEmail, byUsername, sameName] = await Promise.all([
    email ? lookup.byEmail(email) : Promise.resolve(null),
    username ? lookup.byUsername(username) : Promise.resolve(null),
    askName ? lookup.sameName(first!, last!, { client: !!q.client, organisation }) : Promise.resolve([]),
  ]);
  return { email: other(byEmail), username: other(byUsername), sameName: sameName.filter((m) => m.id !== q.excludeId).slice(0, 3) };
}

const matchSelect = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  organisation: true,
  status: true,
  roles: { select: { role: { select: { name: true } } } },
} as const satisfies Prisma.UserSelect;

function toMatch(u: Prisma.UserGetPayload<{ select: typeof matchSelect }>): IdentityMatch {
  return {
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim() || u.username,
    username: u.username,
    kind: isClientRoles(u.roles.map((r) => r.role.name)) ? 'client' : 'staff',
    organisation: u.organisation ?? null,
    status: u.status,
  };
}

/** The Prisma side: plain equality (the columns compare case-insensitively, trailing spaces ignored). */
export function createPrismaIdentityLookup(prisma: PrismaClient): IdentityLookup {
  return {
    async byEmail(email) {
      const u = await prisma.user.findFirst({ where: { email, deletedAt: null }, select: matchSelect });
      return u ? toMatch(u) : null;
    },
    async byUsername(username) {
      const u = await prisma.user.findFirst({ where: { username, deletedAt: null }, select: matchSelect });
      return u ? toMatch(u) : null;
    },
    async sameName(firstName, lastName, { client, organisation }) {
      const rows = await prisma.user.findMany({
        where: { firstName, lastName, deletedAt: null, ...(client ? { ...CLIENT_ONLY_WHERE, organisation } : STAFF_ONLY_WHERE) },
        select: matchSelect,
        orderBy: { createdAt: 'asc' },
        take: 3,
      });
      return rows.map(toMatch);
    },
  };
}
