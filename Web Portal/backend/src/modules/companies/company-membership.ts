import type { PrismaClient } from '@prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import type { AuditService } from '../audit/audit-service';
import type { UserStatus } from '../users/user-repository';
import { isAdminRoles, type Viewer } from './company-access';
import { COMPANY_WORDS } from './company-rules';
import type { OnCompanyAccessChanged, PeopleChange, Refusal } from './company-service';

/**
 * People's companies (User Management and the Companies page): which companies each person
 * belongs to, and their primary company (their emails' branding).
 *   - An active employee keeps at least one company; administrators (and people who aren't active)
 *     may have none.
 *   - The primary company is one of the person's companies: the first one they were given, and when
 *     it is taken away, the oldest one they still have.
 *   - A change takes effect at once: access is read on every request, and the realtime server is
 *     told whose access changed.
 */

export const MEMBERSHIP_WORDS = {
  primaryNotTheirs: 'The primary company must be one of this person’s companies.',
  unknownCompany: 'Company not found.',
  unknownPerson: 'User not found.',
} as const;

/** "Ana Alpha must keep at least one company. Add another company first." */
export function lastCompanyMessage(name: string): string {
  return `${name} must keep at least one company. Add another company first.`;
}

/** A person as the membership rules need them. */
export interface MembershipPerson {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  status: UserStatus;
  isAdmin: boolean;
  primaryCompanyId: string | null;
  /** Their companies, oldest membership first. */
  memberships: string[];
}

/** One person's change: companies to add (in order) and to take away, and their primary company after it. */
export interface MembershipChange {
  userId: string;
  add: string[];
  remove: string[];
  primaryCompanyId: string | null;
}

export interface MembershipStore {
  /** These people (not deleted). */
  people(userIds: string[]): Promise<MembershipPerson[]>;
  /** Which of these companies exist. */
  existingCompanyIds(ids: string[]): Promise<string[]>;
  /** The site's active companies, oldest first. */
  activeCompanyIds(): Promise<string[]>;
  /** Writes every change in one transaction. */
  write(changes: MembershipChange[], actorId: string | null): Promise<void>;
}

export interface CompanyMembership {
  /**
   * Gives a person exactly these companies (undefined: keep them) and this primary company
   * (undefined or null: keep it while it is still theirs, else the oldest one they keep, else the first
   * new one). Refused: 409 LAST_COMPANY, or 400 when the primary isn't one of theirs. Audited.
   */
  set(userId: string, companyIds: string[] | undefined, primaryId: string | null | undefined, actor: Viewer, ip?: string | null): Promise<void>;
  /** Would `set` be refused? Throws as it would, writes nothing (`facts`: their roles or status after the same edit). */
  check(userId: string, companyIds: string[] | undefined, primaryId: string | null | undefined, facts?: { roles?: string[]; status?: UserStatus }): Promise<void>;
  add(userIds: string[], companyIds: string[], actor: Viewer): Promise<PeopleChange>;
  remove(userIds: string[], companyIds: string[], actor: Viewer): Promise<PeopleChange>;
  /** Several people at once: add some companies and take others away (each person is refused or changed on their own). */
  change(userIds: string[], change: { add: string[]; remove: string[] }, actor: Viewer): Promise<PeopleChange>;
  /** A new person's companies: the ones named, else the picked company, else the site's only active one (Ruling 13). */
  defaultsFor(input: { companyIds?: string[]; isAdmin: boolean }, pick: string | null): Promise<string[]>;
  /** A new person's primary company: the one named (one of theirs), else the first. */
  primaryFor(companyIds: readonly string[], primaryId: string | null | undefined): string | null;
}

export interface CompanyMembershipDeps {
  store: MembershipStore;
  onAccessChanged?: OnCompanyAccessChanged;
  audit?: Pick<AuditService, 'record'>;
}

const unique = (ids: readonly string[]) => [...new Set(ids)];
const nameOf = (p: Pick<MembershipPerson, 'firstName' | 'lastName' | 'username'>) => `${p.firstName} ${p.lastName}`.trim() || p.username;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Their primary company after a change: kept while still theirs, else the oldest one they keep, else the first new one. */
function primaryAfter(p: MembershipPerson, next: readonly string[]): string | null {
  if (p.primaryCompanyId && next.includes(p.primaryCompanyId)) return p.primaryCompanyId;
  return p.memberships.find((id) => next.includes(id)) ?? next[0] ?? null;
}

export function createCompanyMembership(deps: CompanyMembershipDeps): CompanyMembership {
  const { store } = deps;

  const told = (userIds: string[]) => {
    if (userIds.length === 0) return;
    try {
      deps.onAccessChanged?.(userIds);
    } catch {
      // Live updates are best effort: every request checks access again anyway.
    }
  };

  async function ensureExist(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const found = new Set(await store.existingCompanyIds([...ids]));
    if (ids.some((id) => !found.has(id))) throw new ValidationError(MEMBERSHIP_WORDS.unknownCompany);
  }

  /** May this person be left with no company? Only an active employee may not. */
  const mustKeepOne = (p: MembershipPerson, facts?: { roles?: string[]; status?: UserStatus }) =>
    (facts?.status ?? p.status) === 'ACTIVE' && !(facts?.roles ? isAdminRoles(facts.roles) : p.isAdmin);

  async function plan(userId: string, companyIds: string[] | undefined, primaryId: string | null | undefined, facts?: { roles?: string[]; status?: UserStatus }) {
    const p = (await store.people([userId]))[0];
    if (!p) throw new NotFoundError(MEMBERSHIP_WORDS.unknownPerson);
    const next = companyIds === undefined ? p.memberships : unique(companyIds);
    if (companyIds !== undefined) await ensureExist(next);
    if (next.length === 0 && mustKeepOne(p, facts)) throw new ConflictError(lastCompanyMessage(nameOf(p)), 'LAST_COMPANY');
    let primary: string | null;
    if (typeof primaryId === 'string') {
      if (!next.includes(primaryId)) throw new ValidationError(MEMBERSHIP_WORDS.primaryNotTheirs);
      primary = primaryId;
    } else primary = primaryAfter(p, next);
    return { p, next, primary, add: next.filter((id) => !p.memberships.includes(id)), remove: p.memberships.filter((id) => !next.includes(id)) };
  }

  async function set(userId: string, companyIds: string[] | undefined, primaryId: string | null | undefined, actor: Viewer, ip?: string | null): Promise<void> {
    const { p, next, primary, add, remove } = await plan(userId, companyIds, primaryId);
    if (add.length === 0 && remove.length === 0 && primary === p.primaryCompanyId) return;
    await store.write([{ userId, add, remove, primaryCompanyId: primary }], actor.id);
    await deps.audit?.record({
      userId: actor.id,
      ip: ip ?? null,
      module: 'users',
      action: 'user.companies',
      entityId: userId,
      oldValue: { companyIds: [...p.memberships].sort(), primaryCompanyId: p.primaryCompanyId },
      newValue: { companyIds: [...next].sort(), primaryCompanyId: primary },
    });
    told([userId]);
  }

  async function check(userId: string, companyIds: string[] | undefined, primaryId: string | null | undefined, facts?: { roles?: string[]; status?: UserStatus }): Promise<void> {
    await plan(userId, companyIds, primaryId, facts);
  }

  async function change(userIds: string[], { add, remove }: { add: string[]; remove: string[] }, actor: Viewer): Promise<PeopleChange> {
    const adding = unique(add);
    const removing = unique(remove);
    await ensureExist(adding);
    const ids = unique(userIds);
    const people = new Map((await store.people(ids)).map((p) => [p.id, p]));
    const refused: Refusal[] = [];
    const changes: MembershipChange[] = [];
    for (const userId of ids) {
      const p = people.get(userId);
      if (!p) {
        refused.push({ userId, name: '', reason: MEMBERSHIP_WORDS.unknownPerson });
        continue;
      }
      const next = [...p.memberships, ...adding.filter((id) => !p.memberships.includes(id))].filter((id) => !removing.includes(id));
      if (sameSet(p.memberships, next)) continue;
      if (next.length === 0 && mustKeepOne(p)) {
        refused.push({ userId, name: nameOf(p), reason: lastCompanyMessage(nameOf(p)) });
        continue;
      }
      changes.push({ userId, add: next.filter((id) => !p.memberships.includes(id)), remove: p.memberships.filter((id) => !next.includes(id)), primaryCompanyId: primaryAfter(p, next) });
    }
    if (changes.length) await store.write(changes, actor.id);
    told(changes.map((c) => c.userId));
    return { changed: changes.length, refused };
  }

  async function defaultsFor(input: { companyIds?: string[]; isAdmin: boolean }, pick: string | null): Promise<string[]> {
    if (input.companyIds !== undefined) {
      const ids = unique(input.companyIds);
      if (ids.length === 0 && !input.isAdmin) throw new ValidationError(COMPANY_WORDS.chooseUserCompany);
      await ensureExist(ids);
      return ids;
    }
    if (pick) return [pick];
    const active = await store.activeCompanyIds();
    if (active.length === 1) return active;
    if (input.isAdmin) return [];
    throw new ValidationError(COMPANY_WORDS.chooseUserCompany);
  }

  function primaryFor(companyIds: readonly string[], primaryId: string | null | undefined): string | null {
    if (typeof primaryId === 'string') {
      if (!companyIds.includes(primaryId)) throw new ValidationError(MEMBERSHIP_WORDS.primaryNotTheirs);
      return primaryId;
    }
    return companyIds[0] ?? null;
  }

  return {
    set,
    check,
    add: (userIds, companyIds, actor) => change(userIds, { add: companyIds, remove: [] }, actor),
    remove: (userIds, companyIds, actor) => change(userIds, { add: [], remove: companyIds }, actor),
    change,
    defaultsFor,
    primaryFor,
  };
}

/** The membership store on the database: each change in one transaction. */
export function createPrismaMembershipStore(prisma: PrismaClient): MembershipStore {
  return {
    async people(userIds) {
      if (userIds.length === 0) return [];
      const rows = await prisma.user.findMany({
        where: { id: { in: userIds }, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          status: true,
          primaryCompanyId: true,
          roles: { select: { role: { select: { name: true } } } },
          companies: { select: { companyId: true }, orderBy: [{ addedAt: 'asc' }, { companyId: 'asc' }] },
        },
      });
      return rows.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        status: u.status,
        isAdmin: u.roles.some((r) => r.role.name === 'ADMIN'),
        primaryCompanyId: u.primaryCompanyId,
        memberships: u.companies.map((c) => c.companyId),
      }));
    },
    async existingCompanyIds(ids) {
      return (await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((c) => c.id);
    },
    async activeCompanyIds() {
      return (await prisma.company.findMany({ where: { status: 'ACTIVE' }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((c) => c.id);
    },
    async write(changes, actorId) {
      if (changes.length === 0) return;
      await prisma.$transaction(
        changes.flatMap((c) => [
          ...(c.remove.length ? [prisma.companyMember.deleteMany({ where: { userId: c.userId, companyId: { in: c.remove } } })] : []),
          ...(c.add.length ? [prisma.companyMember.createMany({ data: c.add.map((companyId) => ({ companyId, userId: c.userId, addedById: actorId })), skipDuplicates: true })] : []),
          prisma.user.update({ where: { id: c.userId }, data: { primaryCompanyId: c.primaryCompanyId } }),
        ]),
      );
    },
  };
}
