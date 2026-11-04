import type { CreateUserData, UserRepository, UserSummary } from './user-repository';
import type { MembershipStore } from '../companies/company-membership';

interface Row {
  user: UserSummary;
  passwordHash: string;
  tokenVersion: number;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  deleted: boolean;
  /** companies: their companies, oldest membership first. */
  memberships: string[];
}

interface MemoryCompany {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: number;
}

/** In-memory user repository with the same rules as the Prisma one (tests / dev). */
export function createMemoryUserRepository() {
  const rows = new Map<string, Row>();
  let seq = 0;
  const linksEnded = new Map<string, number>();
  // companies: the site's companies (tests add them) and who belongs to which.
  const companies = new Map<string, MemoryCompany>();
  let companySeq = 0;
  const companiesOf = (r: Row) =>
    r.memberships
      .flatMap((id) => {
        const c = companies.get(id);
        return c ? [{ id: c.id, name: c.name, code: c.code }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  const summary = (r: Row): UserSummary => {
    const locked = r.lockedUntil !== null && r.lockedUntil.getTime() > Date.now();
    return { ...r.user, locked, lockedUntil: locked ? r.lockedUntil : null, companies: companiesOf(r), primaryCompanyId: r.user.primaryCompanyId ?? null };
  };
  const live = () => [...rows.values()].filter((r) => !r.deleted);
  const row = (id: string) => {
    const r = rows.get(id);
    if (!r || r.deleted) throw new Error(`no user ${id}`);
    return r;
  };

  const repo: UserRepository = {
    async create(data: CreateUserData) {
      const id = `u${seq++}`;
      const user: UserSummary = {
        id,
        email: data.email,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        avatarUrl: null,
        status: 'ACTIVE',
        departmentId: data.departmentId ?? null,
        lastLoginAt: null,
        welcomeSentAt: null,
        roles: data.roleNames,
        myProjectsOnly: false,
      };
      if ([...rows.values()].some((r) => r.user.email === data.email || r.user.username === data.username)) {
        throw new Error('unique constraint'); // like the database, deleted rows still hold their identity
      }
      user.primaryCompanyId = data.primaryCompanyId ?? null;
      rows.set(id, { user, passwordHash: data.passwordHash, tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null, deleted: false, memberships: [...new Set(data.companyIds ?? [])] });
      return summary(rows.get(id)!);
    },
    async findById(id) {
      const r = rows.get(id);
      return r && !r.deleted ? summary(r) : null;
    },
    async findByEmailOrUsername(email, username) {
      const r = live().find((x) => x.user.email === email || x.user.username === username);
      return r ? summary(r) : null;
    },
    async list(filter) {
      const id = filter?.companyId;
      return live()
        .filter((r) => (!id ? true : id === 'none' ? r.memberships.length === 0 : r.memberships.includes(id)))
        .map(summary);
    },
    async update(id, patch) {
      const r = row(id);
      const { roleNames, ...rest } = patch;
      r.user = { ...r.user, ...rest, ...(roleNames ? { roles: roleNames } : {}) };
      return summary(r);
    },
    async setStatus(id, status) {
      const r = row(id);
      r.user = { ...r.user, status };
      return summary(r);
    },
    async setAvatar(id, avatarUrl) {
      const r = row(id);
      r.user = { ...r.user, avatarUrl };
      return summary(r);
    },
    async setPassword(id, passwordHash) {
      const r = row(id);
      Object.assign(r, { passwordHash, failedLoginAttempts: 0, lockedUntil: null });
    },
    async endPasswordLinks(id) {
      linksEnded.set(id, (linksEnded.get(id) ?? 0) + 1);
    },
    async markWelcomeSent(id, at) {
      const r = row(id);
      r.user = { ...r.user, welcomeSentAt: at };
    },
    async getPasswordHash(id) {
      const r = rows.get(id);
      return r && !r.deleted ? r.passwordHash : null;
    },
    async softDelete(id) {
      const r = row(id);
      r.deleted = true;
      r.user = { ...r.user, email: `${r.user.email}~deleted-${id}`, username: `${r.user.username}~deleted-${id}` };
    },
    async bumpTokenVersion(id) {
      const r = rows.get(id)!;
      r.tokenVersion += 1;
      return r.tokenVersion;
    },
    async unlock(id) {
      const r = row(id);
      Object.assign(r, { failedLoginAttempts: 0, lockedUntil: null });
      return summary(r);
    },
    async countActiveAdmins(excludeId) {
      return live().filter((r) => r.user.id !== excludeId && r.user.status === 'ACTIVE' && r.user.roles.includes('ADMIN')).length;
    },
    async releaseDeletedIdentity(email, username) {
      for (const r of rows.values()) {
        if (r.deleted && (r.user.email === email || r.user.username === username)) {
          r.user = { ...r.user, email: `${r.user.email}~released`, username: `${r.user.username}~released` };
        }
      }
    },
  };

  // companies: the membership rules' store over these people (see company-membership.ts).
  const membershipStore: MembershipStore = {
    async people(userIds) {
      return userIds.flatMap((id) => {
        const r = rows.get(id);
        if (!r || r.deleted) return [];
        const u = r.user;
        return [{ id, firstName: u.firstName, lastName: u.lastName, username: u.username, status: u.status, isAdmin: u.roles.includes('ADMIN'), primaryCompanyId: u.primaryCompanyId ?? null, memberships: [...r.memberships] }];
      });
    },
    async existingCompanyIds(ids) {
      return ids.filter((id) => companies.has(id));
    },
    async activeCompanyIds() {
      return [...companies.values()].filter((c) => c.status === 'ACTIVE').sort((a, b) => a.createdAt - b.createdAt).map((c) => c.id);
    },
    async write(changes) {
      for (const c of changes) {
        const r = row(c.userId);
        r.memberships = [...r.memberships.filter((id) => !c.remove.includes(id)), ...c.add.filter((id) => !r.memberships.includes(id))];
        r.user = { ...r.user, primaryCompanyId: c.primaryCompanyId };
      }
    },
  };

  return {
    repo,
    membershipStore,
    /** companies: a company on the site (again with the same id: its new name or status). */
    addCompany: (c: { id: string; name: string; code: string; status?: 'ACTIVE' | 'ARCHIVED' }) =>
      void companies.set(c.id, { ...c, status: c.status ?? 'ACTIVE', createdAt: companies.get(c.id)?.createdAt ?? ++companySeq }),
    hashOf: (id: string) => rows.get(id)?.passwordHash,
    tokenVersion: (id: string) => rows.get(id)?.tokenVersion ?? 0,
    /** How many times the person's unused set-password links (welcome, reset) were ended. */
    linksEnded: (id: string) => linksEnded.get(id) ?? 0,
    /** Simulate a sign-in at `at` (what the auth repository records). */
    signedIn: (id: string, at: Date) => void (rows.get(id)!.user = { ...rows.get(id)!.user, lastLoginAt: at }),
    /** Simulate failed sign-ins that locked the account. */
    lock: (id: string, until: Date) => Object.assign(rows.get(id)!, { failedLoginAttempts: 5, lockedUntil: until }),
    /** Simulate a row soft-deleted before deletes renamed the email/username. */
    legacyDelete: (id: string) => void (rows.get(id)!.deleted = true),
  };
}
