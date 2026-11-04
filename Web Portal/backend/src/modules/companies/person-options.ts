import type { PrismaClient } from '@prisma/client';
import type { CompanyAccess, Viewer } from './company-access';
import { CLIENT_ROLE } from '../clients/client-kind';

/**
 * Companies: a person as the people pickers show them (team candidates, meeting invitations) — a
 * name and a picture, nothing else.
 */
export interface PersonOption {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  avatarUrl: string | null;
  /** 1.23: a client account (offered only as a project meeting's invitee), with their organisation. */
  client?: boolean;
  organisation?: string | null;
}

/** The active people among these ids, by name. */
export type PersonOptions = (userIds: readonly string[]) => Promise<PersonOption[]>;

export function createPrismaPersonOptions(prisma: PrismaClient): PersonOptions {
  return async (userIds) => {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    const rows = await prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, username: true, avatarUrl: true, organisation: true, roles: { select: { role: { select: { name: true } } } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { username: 'asc' }],
    });
    return rows.map(({ roles, organisation, ...p }) => (roles.some((r) => r.role.name === CLIENT_ROLE) ? { ...p, client: true, organisation: organisation ?? null } : p));
  };
}

/** Of these people, the ones the viewer knows (colleagues, teammates, chat partners) and the viewer; admins: all. */
export async function keepKnownPeople<T extends { id: string }>(access: Pick<CompanyAccess, 'knownPeople'>, viewer: Viewer, people: readonly T[]): Promise<T[]> {
  const known = await access.knownPeople(viewer);
  if (known === 'everyone') return [...people];
  return people.filter((p) => p.id === viewer.id || known.has(p.id));
}
