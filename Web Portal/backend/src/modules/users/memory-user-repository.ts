import type { CreateUserData, UserRepository, UserSummary } from './user-repository';

interface Row {
  user: UserSummary;
  passwordHash: string;
  tokenVersion: number;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  deleted: boolean;
}

/** In-memory user repository with the same rules as the Prisma one (tests / dev). */
export function createMemoryUserRepository() {
  const rows = new Map<string, Row>();
  let seq = 0;
  const summary = (r: Row): UserSummary => {
    const locked = r.lockedUntil !== null && r.lockedUntil.getTime() > Date.now();
    return { ...r.user, locked, lockedUntil: locked ? r.lockedUntil : null };
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
        roles: data.roleNames,
      };
      if ([...rows.values()].some((r) => r.user.email === data.email || r.user.username === data.username)) {
        throw new Error('unique constraint'); // like the database, deleted rows still hold their identity
      }
      rows.set(id, { user, passwordHash: data.passwordHash, tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null, deleted: false });
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
    async list() {
      return live().map(summary);
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

  return {
    repo,
    hashOf: (id: string) => rows.get(id)?.passwordHash,
    tokenVersion: (id: string) => rows.get(id)?.tokenVersion ?? 0,
    /** Simulate failed sign-ins that locked the account. */
    lock: (id: string, until: Date) => Object.assign(rows.get(id)!, { failedLoginAttempts: 5, lockedUntil: until }),
    /** Simulate a row soft-deleted before deletes renamed the email/username. */
    legacyDelete: (id: string) => void (rows.get(id)!.deleted = true),
  };
}
