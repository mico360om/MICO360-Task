import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createAuthService } from './auth-service';
import { createTokenService } from './token-service';
import { hashPassword } from '../../lib/password';
import type { AuthUser, AuthUserRepository } from './user-repository';

function inMemoryUsers(users: AuthUser[]): AuthUserRepository {
  const byId = new Map(users.map((u) => [u.id, { ...u }]));
  return {
    async findByIdentifier(id) {
      for (const u of byId.values()) if (u.email === id || u.username === id) return { ...u };
      return null;
    },
    async findById(uid) {
      const u = byId.get(uid);
      return u ? { ...u } : null;
    },
    async applyFailedAttempt(uid, attempts, lock) {
      const u = byId.get(uid)!;
      u.failedLoginAttempts = attempts;
      if (lock) u.lockedUntil = new Date();
    },
    async resetFailedAttempts(uid) {
      byId.get(uid)!.failedLoginAttempts = 0;
    },
  };
}

/** In-memory refresh-token store with real revoke/expiry semantics, shareable across app instances. */
function makeStore() {
  const rows: { userId: string; hash: string; expiresAt: Date; revokedAt: Date | null }[] = [];
  return {
    rows,
    async save(userId: string, hash: string, expiresAt: Date) {
      rows.push({ userId, hash, expiresAt, revokedAt: null });
    },
    async findValid(hash: string) {
      const r = rows.find((x) => x.hash === hash && x.revokedAt === null && x.expiresAt.getTime() > Date.now());
      return r ? { userId: r.userId } : null;
    },
    async revoke(hash: string) {
      const r = rows.find((x) => x.hash === hash && x.revokedAt === null);
      if (r) r.revokedAt = new Date();
    },
    async revokeAllForUser(userId: string) {
      for (const r of rows) if (r.userId === userId && r.revokedAt === null) r.revokedAt = new Date();
    },
  };
}

async function makeApp(users: AuthUser[], store: ReturnType<typeof makeStore> = makeStore()) {
  const authService = createAuthService({ users: inMemoryUsers(users), maxAttempts: 5 });
  const tokenService = createTokenService({
    accessSecret: 'access-secret-long-enough',
    refreshSecret: 'refresh-secret-long-enough',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: store,
  });
  return buildApp({ authService, tokenService });
}

let hash: string;
beforeEach(async () => {
  hash = await hashPassword('CorrectHorse1');
});

function user(o: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'ada@mico360.test',
    username: 'ada',
    passwordHash: hash,
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    roles: ['EMPLOYEE'],
    ...o,
  };
}

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with user + tokens for valid credentials', async () => {
    const app = await makeApp([user()]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.user.id).toBe('u1');
    expect(typeof body.data.accessToken).toBe('string');
    expect(typeof body.data.refreshToken).toBe('string');
    await app.close();
  });

  it('returns 401 INVALID_CREDENTIALS for a wrong password', async () => {
    const app = await makeApp([user()]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    await app.close();
  });

  it('returns 423 ACCOUNT_LOCKED for a locked account', async () => {
    const app = await makeApp([user({ lockedUntil: new Date() })]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    expect(res.statusCode).toBe(423);
    expect(res.json().error.code).toBe('ACCOUNT_LOCKED');
    await app.close();
  });

  it('returns 400 VALIDATION when a field is missing', async () => {
    const app = await makeApp([user()]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    await app.close();
  });

  it('health endpoint responds ok', async () => {
    const app = await makeApp([user()]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('ok');
    await app.close();
  });

  it('public config endpoint exposes the company time zone + server time (no auth)', async () => {
    const app = await makeApp([user()]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/config' });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.timeZone).toBe('Asia/Muscat'); // company default
    expect(d.companyName).toBe('MICO360');
    expect(typeof d.serverTime).toBe('string');
    expect(Number.isNaN(Date.parse(d.serverTime))).toBe(false);
    await app.close();
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('exchanges a valid refresh token for a fresh session', async () => {
    const app = await makeApp([user()]);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    const { refreshToken } = login.json().data;

    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.user.id).toBe('u1');
    expect(typeof body.data.accessToken).toBe('string');
    expect(typeof body.data.refreshToken).toBe('string');
    await app.close();
  });

  it('rejects a bogus refresh token with 401', async () => {
    const app = await makeApp([user()]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: 'not-a-token' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_REFRESH_TOKEN');
    await app.close();
  });

  it('refuses to refresh once the account is locked', async () => {
    const store = makeStore(); // shared so the issued token is still live for the locked app to evaluate
    const app = await makeApp([user()], store);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    const { refreshToken } = login.json().data;
    // Lock the account, then the previously-issued refresh token must not mint new access.
    const lockedApp = await makeApp([user({ lockedUntil: new Date() })], store);
    const res = await lockedApp.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(res.statusCode).toBe(423);
    await app.close();
    await lockedApp.close();
  });

  it('rotates the refresh token: the old one is single-use and rejected on reuse', async () => {
    const app = await makeApp([user()]);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    const first = login.json().data.refreshToken;

    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: first } });
    expect(r1.statusCode).toBe(200);
    const second = r1.json().data.refreshToken;
    expect(second).not.toBe(first);

    // Reusing the now-rotated token must fail (theft/replay detection).
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: first } });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('INVALID_REFRESH_TOKEN');

    // The freshly rotated token still works.
    const r2 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: second } });
    expect(r2.statusCode).toBe(200);
    await app.close();
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the presented refresh token so it can no longer be refreshed', async () => {
    const app = await makeApp([user()]);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    const { refreshToken } = login.json().data;

    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken } });
    expect(out.statusCode).toBe(200);

    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('is idempotent / does not leak whether the token existed', async () => {
    const app = await makeApp([user()]);
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken: 'whatever' } });
    expect(out.statusCode).toBe(200);
    await app.close();
  });
});
