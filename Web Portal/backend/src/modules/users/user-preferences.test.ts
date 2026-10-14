import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createMemoryPreferences } from './user-preferences';

const tokenService = createTokenService({
  accessSecret: 'prefs-access',
  refreshSecret: 'prefs-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});

async function setup() {
  const app = await buildApp({ authService, tokenService, userPreferences: createMemoryPreferences() });
  const as = async (id: string) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles: ['EMPLOYEE'] })).accessToken}` });
  return { app, as };
}

describe('GET/PUT /users/me/preferences — personal date settings', () => {
  it('starts with none (the company time zone and a Sunday week apply)', async () => {
    const { app, as } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u1') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ timeZone: null, weekStart: null });
  });

  it('keeps each person’s own week start and time zone', async () => {
    const { app, as } = await setup();
    const put = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('u1'), payload: { weekStart: 1, timeZone: 'Europe/London' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toEqual({ timeZone: 'Europe/London', weekStart: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u1') })).json().data).toEqual({ timeZone: 'Europe/London', weekStart: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u2') })).json().data).toEqual({ timeZone: null, weekStart: null });
    // Back to the defaults; a partial change leaves the rest.
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('u1'), payload: { timeZone: null } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u1') })).json().data).toEqual({ timeZone: null, weekStart: 1 });
  });

  it('refuses an unknown time zone or week start', async () => {
    const { app, as } = await setup();
    for (const payload of [{ timeZone: 'Mars/Olympus' }, { weekStart: 3 }, { weekStart: 'monday' }, { extra: true }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('u1'), payload })).statusCode).toBe(400);
    }
  });

  it('needs a signed-in person', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences' })).statusCode).toBe(401);
  });
});
