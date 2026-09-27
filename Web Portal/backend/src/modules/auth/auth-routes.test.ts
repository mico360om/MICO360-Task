import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createAuthService } from './auth-service';
import { createTokenService } from './token-service';
import { createMemoryRefreshTokenStore } from './memory-refresh-token-store';
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
    async applyFailedAttempt(uid, attempts, lockedUntil, expected) {
      const u = byId.get(uid)!;
      if (expected !== undefined && u.failedLoginAttempts !== expected) return false;
      u.failedLoginAttempts = attempts;
      if (lockedUntil) u.lockedUntil = lockedUntil;
      return true;
    },
    async resetFailedAttempts(uid) {
      const u = byId.get(uid)!;
      u.failedLoginAttempts = 0;
      u.lockedUntil = null;
    },
  };
}

type Store = ReturnType<typeof createMemoryRefreshTokenStore>;

async function makeApp(users: AuthUser[], store: Store = createMemoryRefreshTokenStore(), clock?: () => Date) {
  const authService = createAuthService({ users: inMemoryUsers(users), maxAttempts: 5 });
  const tokenService = createTokenService({
    accessSecret: 'access-secret-long-enough',
    refreshSecret: 'refresh-secret-long-enough',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: store,
    ...(clock ? { now: clock } : {}),
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

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with user + tokens for valid credentials', async () => {
    const app = await makeApp([user({ tokenVersion: 2 })]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.user).toEqual({ id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['EMPLOYEE'], avatarUrl: null });
    expect(typeof body.data.accessToken).toBe('string');
    expect(typeof body.data.refreshToken).toBe('string');
    const claims = JSON.parse(Buffer.from(body.data.accessToken.split('.')[1], 'base64url').toString());
    expect(claims.ver).toBe(2);
    await app.close();
  });

  it('returns 401 INVALID_CREDENTIALS for a wrong password', async () => {
    const app = await makeApp([user()]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    await app.close();
  });

  it('returns 423 ACCOUNT_LOCKED with a retry hint while the account is locked', async () => {
    const app = await makeApp([user({ failedLoginAttempts: 5, lockedUntil: inMinutes(10) })]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    expect(res.statusCode).toBe(423);
    expect(res.json().error.code).toBe('ACCOUNT_LOCKED');
    expect(res.json().error.details.retryAfterSeconds).toBeGreaterThan(9 * 60);
    await app.close();
  });

  it('signs in again once the lock has expired', async () => {
    const app = await makeApp([user({ failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) })]);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    expect(res.statusCode).toBe(200);
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
  async function login(app: Awaited<ReturnType<typeof makeApp>>) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'ada', password: 'CorrectHorse1' } });
    return res.json().data.refreshToken as string;
  }
  const refresh = (app: Awaited<ReturnType<typeof makeApp>>, refreshToken: string) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });

  it('exchanges a valid refresh token for a fresh session', async () => {
    const app = await makeApp([user()]);
    const res = await refresh(app, await login(app));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.user.id).toBe('u1');
    expect(typeof body.data.accessToken).toBe('string');
    expect(typeof body.data.refreshToken).toBe('string');
    await app.close();
  });

  it('rejects a bogus refresh token with 401', async () => {
    const app = await makeApp([user()]);
    const res = await refresh(app, 'not-a-token');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_REFRESH_TOKEN');
    await app.close();
  });

  it('refuses to refresh once the account is deactivated', async () => {
    const store = createMemoryRefreshTokenStore(); // shared so the issued token is still live for the second app
    const app = await makeApp([user()], store);
    const refreshToken = await login(app);
    const inactiveApp = await makeApp([user({ status: 'INACTIVE' })], store);
    const res = await refresh(inactiveApp, refreshToken);
    expect(res.statusCode).toBe(403);
    await app.close();
    await inactiveApp.close();
  });

  it('keeps refreshing an existing session while the password sign-in is locked', async () => {
    const store = createMemoryRefreshTokenStore();
    const app = await makeApp([user()], store);
    const refreshToken = await login(app);
    const lockedApp = await makeApp([user({ failedLoginAttempts: 5, lockedUntil: inMinutes(15) })], store);
    expect((await refresh(lockedApp, refreshToken)).statusCode).toBe(200);
    await app.close();
    await lockedApp.close();
  });

  it('rotates the refresh token: the old one is single-use and rejected on reuse', async () => {
    const app = await makeApp([user()]);
    const first = await login(app);

    const r1 = await refresh(app, first);
    expect(r1.statusCode).toBe(200);
    const second = r1.json().data.refreshToken;
    expect(second).not.toBe(first);

    // Reusing the now-rotated token must fail (theft/replay detection).
    const reuse = await refresh(app, first);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('INVALID_REFRESH_TOKEN');

    // Inside the grace window (a second tab), the freshly rotated token still works.
    const r2 = await refresh(app, second);
    expect(r2.statusCode).toBe(200);
    await app.close();
  });

  it('lets only one of two concurrent refreshes win, without ending the session', async () => {
    const app = await makeApp([user()]);
    const first = await login(app);
    const [a, b] = await Promise.all([refresh(app, first), refresh(app, first)]);
    const winner = [a, b].find((r) => r.statusCode === 200)!;
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 401]);
    expect((await refresh(app, winner.json().data.refreshToken)).statusCode).toBe(200);
    await app.close();
  });

  it('revokes the whole sign-in when an old rotated token is replayed after the grace window', async () => {
    let clock = Date.now();
    const app = await makeApp([user()], createMemoryRefreshTokenStore(), () => new Date(clock));
    const first = await login(app);
    const second = (await refresh(app, first)).json().data.refreshToken;
    clock += 60_000;
    expect((await refresh(app, first)).statusCode).toBe(401); // stolen copy replayed
    expect((await refresh(app, second)).statusCode).toBe(401); // the family is gone
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
