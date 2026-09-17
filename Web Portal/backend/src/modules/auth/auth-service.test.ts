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
    async applyFailedAttempt(userId, attempts, lock) {
      const u = byId.get(userId)!;
      u.failedLoginAttempts = attempts;
      u.lockedUntil = lock ? new Date() : u.lockedUntil;
    },
    async resetFailedAttempts(userId) {
      const u = byId.get(userId)!;
      u.failedLoginAttempts = 0;
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

describe('AuthService.login', () => {
  it('authenticates with email + correct password', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser()]), maxAttempts: 5 });
    const result = await svc.login('ada@mico360.test', 'CorrectHorse1');
    expect(result.id).toBe('u1');
  });

  it('authenticates with username + correct password', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser()]), maxAttempts: 5 });
    const result = await svc.login('ada', 'CorrectHorse1');
    expect(result.username).toBe('ada');
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

  it('locks the account on the 5th consecutive failure', async () => {
    const repo = makeRepo([baseUser({ failedLoginAttempts: 4 })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await expect(svc.login('ada', 'wrong')).rejects.toBeInstanceOf(AccountLockedError);
    expect(repo.get('u1').failedLoginAttempts).toBe(5);
    expect(repo.get('u1').lockedUntil).not.toBeNull();
  });

  it('refuses login for a locked account even with the correct password', async () => {
    const repo = makeRepo([baseUser({ lockedUntil: new Date() })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await expect(svc.login('ada', 'CorrectHorse1')).rejects.toBeInstanceOf(AccountLockedError);
  });

  it('refuses login for an inactive account', async () => {
    const repo = makeRepo([baseUser({ status: 'INACTIVE' })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await expect(svc.login('ada', 'CorrectHorse1')).rejects.toBeInstanceOf(AccountInactiveError);
  });

  it('resets the failed-attempt count after a successful login', async () => {
    const repo = makeRepo([baseUser({ failedLoginAttempts: 3 })]);
    const svc = createAuthService({ users: repo, maxAttempts: 5 });
    await svc.login('ada', 'CorrectHorse1');
    expect(repo.get('u1').failedLoginAttempts).toBe(0);
  });
});

describe('AuthService.getUserForSession (token refresh)', () => {
  it('returns the active user for a valid id', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser({ roles: ['ADMIN'] })]), maxAttempts: 5 });
    const user = await svc.getUserForSession('u1');
    expect(user).toEqual({ id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['ADMIN'], avatarUrl: null });
  });

  it('rejects an unknown user id', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser()]), maxAttempts: 5 });
    await expect(svc.getUserForSession('ghost')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('refuses to refresh a deactivated account', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser({ status: 'INACTIVE' })]), maxAttempts: 5 });
    await expect(svc.getUserForSession('u1')).rejects.toBeInstanceOf(AccountInactiveError);
  });

  it('refuses to refresh a locked account', async () => {
    const svc = createAuthService({ users: makeRepo([baseUser({ lockedUntil: new Date() })]), maxAttempts: 5 });
    await expect(svc.getUserForSession('u1')).rejects.toBeInstanceOf(AccountLockedError);
  });
});
