import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildApp } from './app';
import { createTokenService } from './modules/auth/token-service';
import { createAuthService } from './modules/auth/auth-service';
import { createAuthGuard, type UserState } from './modules/auth/auth-guard';

// Review fix N1 (13 Nov 2026): the server shares ONE sign-in check (and its 10-second account cache)
// between the routes and the code that ends sessions, so a deactivation, a password change or a role
// change is refused on the very next request — not up to 10 seconds later.
const tokenService = createTokenService({
  accessSecret: 'sg-access',
  refreshSecret: 'sg-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

const states = new Map<string, UserState>();
const userState = async (id: string) => states.get(id) ?? null;
const bearer = async (id: string, roles: string[], ver = 0) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles, tokenVersion: ver })).accessToken}` });

afterEach(() => {
  states.clear();
  vi.useRealTimers();
});

describe('one shared sign-in check (N1)', () => {
  it('buildApp uses the guard it is given: forgetting an account there refuses its revoked token at once', async () => {
    const guard = createAuthGuard(tokenService, { userState });
    const app = await buildApp({ authService, tokenService, userState, authGuard: guard });
    states.set('a1', { active: true, tokenVersion: 0, roles: ['ADMIN'] });
    const h = await bearer('a1', ['ADMIN']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h })).statusCode).toBe(200);

    // An administrator deactivates them (status off, token version raised); the revoke forgets the cache.
    states.set('a1', { active: false, tokenVersion: 1, roles: ['ADMIN'] });
    guard.forgetUser('a1');
    const after = await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it('without a forget the cache still holds for up to 10 seconds (what N1 was), then refuses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T08:00:00Z'));
    const guard = createAuthGuard(tokenService, { userState });
    const app = await buildApp({ authService, tokenService, userState, authGuard: guard });
    states.set('a1', { active: true, tokenVersion: 0, roles: ['ADMIN'] });
    const h = await bearer('a1', ['ADMIN']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h })).statusCode).toBe(200);
    states.set('a1', { active: false, tokenVersion: 1, roles: ['ADMIN'] });
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h })).statusCode).toBe(200);
    vi.setSystemTime(new Date('2026-11-13T08:00:11Z'));
    expect((await app.inject({ method: 'GET', url: '/api/v1/metrics', headers: h })).statusCode).toBe(401);
    await app.close();
  });
});
