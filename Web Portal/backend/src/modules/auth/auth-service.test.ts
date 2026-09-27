import { describe, it, expect, beforeEach } from 'vitest';
import { hashPassword } from '../../lib/password';
import { createAuthService } from './auth-service';
import type { AuthUser, AuthUserRepository } from './user-repository';
import { AccountInactiveError, AccountLockedError, InvalidCredentialsError } from './errors';

// In-memory fake repository (real behaviour, no mocking framework).
function makeRepo(users: AuthUser[]): AuthUserRepository & { get(id: string): AuthUser } {
  const byId = new Map(users.map((u) => [u.id, { ...u }]));
  return {
    get: (id) => byId.get(id)!,
    async findByIdentifier(identifier) {
      for (const u of byId.values()) {
        if (u.email === identifier || u.username === identifier) return { ...u };
      }
      return null;
    },
    async findById(id) {
      const u = byId.get(id);
      return u ? { ...u } : null;
    },
    async applyFailedAttempt(userId, attempts, lockedUntil, expected) {
      const u = byId.get(userId)!;
      if (expected !== undefined && u.failedLoginAttempts !== expected) return false;
      u.failedLoginAttempts = attempts;
      if (lockedUntil) u.lockedUntil = lockedUntil;
      return true;
    },
    async resetFailedAttempts(userId) {
      const u = byId.get(userId)!;
      u.failedLoginAttempts = 0;
      u.lockedUntil = null;
    },
  };
}

let passwordHash: string;
beforeEach(async () => {
  passwordHash = await hashPassword('CorrectHorse1');
});

function baseUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'ada@mico360.test',
    username: 'ada',
    passwordHash,
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);

describe('AuthService.login', () => {
  it('authenticates with email + correct password', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser()]), maxAttempts: 5 });
    const result = await svc.login('ada@mico360.test', 'CorrectHorse1');
    expect(result.id).toBe('u1');
  });

  it('authenticates with username + correct password and reports the token version', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser({ tokenVersion: 3 })]), maxAttempts: 5 });
    const result = await svc.login('ada', 'CorrectHorse1');
    expect(result.username).toBe('ada');
    expect(result.tokenVersion).toBe(3);
  });

  it('rejects an unknown identifier with InvalidCredentials', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser()]), maxAttempts: 5 });
    await expect(svc.login('nobody', 'whatever')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a wrong password and increments the failed-attempt count', async () => {
    const repo = makeRepo([baseUser()]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await expect(svc.login('ada', 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(repo.get('u1').failedLoginAttempts).toBe(1);
  });

  it('locks the account for lockMinutes on the 5th consecutive failure', async () => {
    const repo = makeRepo([baseUser({ failedLoginAttempts: 4 })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5, lockMinutes: 15 });
    const err = await svc.login('ada', 'wrong').catch((e) => e);
    expect(err).toBeInstanceOf(AccountLockedError);
    expect(err.details.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect(repo.get('u1').failedLoginAttempts).toBe(5);
    const until = repo.get('u1').lockedUntil!.getTime();
    expect(until).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(until).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
  });

  it('refuses login while the lock is in force, even with the correct password', async () => {
    const repo = makeRepo([baseUser({ failedLoginAttempts: 5, lockedUntil: inMinutes(10) })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await expect(svc.login('ada', 'CorrectHorse1')).rejects.toBeInstanceOf(AccountLockedError);
    expect(repo.get('u1').failedLoginAttempts).toBe(5); // guesses during a lock are not evaluated
  });

  it('lets the owner back in once the lock has expired (no permanent lock)', async () => {
    const repo = makeRepo([baseUser({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await expect(svc.login('ada', 'CorrectHorse1')).resolves.toMatchObject({ id: 'u1' });
    expect(repo.get('u1').failedLoginAttempts).toBe(0);
    expect(repo.get('u1').lockedUntil).toBeNull();
  });

  it('backs off: a failure after an expired lock locks again for twice as long', async () => {
    const repo = makeRepo([baseUser({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5, lockMinutes: 15 });
    await expect(svc.login('ada', 'wrong')).rejects.toBeInstanceOf(AccountLockedError);
    expect(repo.get('u1').lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
  });

  it('only evaluates one of several parallel guesses per counter value', async () => {
    const repo = makeRepo([baseUser({ failedLoginAttempts: 4 })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => svc.login('ada', 'wrong')));
    // Exactly one guess reached the 5th slot and locked the account; the rest were refused unevaluated.
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof AccountLockedError)).toHaveLength(1);
    expect(repo.get('u1').failedLoginAttempts).toBe(5);
  });

  it('reveals an inactive account only after the correct password', async () => {
    const repo = makeRepo([baseUser({ status: 'INACTIVE' })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await expect(svc.login('ada', 'wrong')).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(svc.login('ada', 'CorrectHorse1')).rejects.toBeInstanceOf(AccountInactiveError);
  });

  it('resets the failed-attempt count after a successful login', async () => {
    const repo = makeRepo([baseUser({ failedLoginAttempts: 3 })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await svc.login('ada', 'CorrectHorse1');
    expect(repo.get('u1').failedLoginAttempts).toBe(0);
  });

  it('takes about as long for an unknown account as for a wrong password (no timing oracle)', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser()]), maxAttempts: 50 });
    await svc.login('nobody', 'x').catch(() => {}); // warm the dummy hash
    const time = async (id: string) => {
      const t = performance.now();
      await svc.login(id, 'wrong').catch(() => {});
      return performance.now() - t;
    };
    const unknown = await time('nobody');
    const known = await time('ada');
    expect(unknown).toBeGreaterThan(known / 4); // both pay for a bcrypt comparison
  });
});

describe('AuthService.getUserForSession (token refresh)', () => {
  it('returns the active user for a valid id', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser({ roles: ['ADMIN'], tokenVersion: 2 })]), maxAttempts: 5 });
    const user = await svc.getUserForSession('u1');
    expect(user).toEqual({ id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['ADMIN'], avatarUrl: null, tokenVersion: 2 });
  });

  it('rejects an unknown user id', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser()]), maxAttempts: 5 });
    await expect(svc.getUserForSession('ghost')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('refuses to refresh a deactivated account', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser({ status: 'INACTIVE' })]), maxAttempts: 5 });
    await expect(svc.getUserForSession('u1')).rejects.toBeInstanceOf(AccountInactiveError);
  });

  it('keeps an existing session alive while someone else’s guesses have locked the password', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser({ failedLoginAttempts: 5, lockedUntil: inMinutes(10) })]), maxAttempts: 5 });
    await expect(svc.getUserForSession('u1')).resolves.toMatchObject({ id: 'u1' });
  });
});
