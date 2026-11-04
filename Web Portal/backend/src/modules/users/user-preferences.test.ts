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
  const as = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
  return { app, as };
}

describe('GET/PUT /users/me/preferences — personal date settings', () => {
  it('starts with none (the company time zone and a Sunday week apply)', async () => {
    const { app, as } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u1') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: false });
  });

  it('keeps each person’s own week start and time zone', async () => {
    const { app, as } = await setup();
    const put = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('u1'), payload: { weekStart: 1, timeZone: 'Europe/London' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toEqual({ timeZone: 'Europe/London', weekStart: 1, myProjectsOnly: false });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u1') })).json().data).toEqual({ timeZone: 'Europe/London', weekStart: 1, myProjectsOnly: false });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u2') })).json().data).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: false });
    // Back to the defaults; a partial change leaves the rest.
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('u1'), payload: { timeZone: null } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u1') })).json().data).toEqual({ timeZone: null, weekStart: 1, myProjectsOnly: false });
  });

  it('refuses an unknown time zone or week start', async () => {
    const { app, as } = await setup();
    for (const payload of [{ timeZone: 'Mars/Olympus' }, { weekStart: 3 }, { weekStart: 'monday' }, { extra: true }, { myProjectsOnly: 'yes' }, { myProjectsOnly: null }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('u1'), payload })).statusCode).toBe(400);
    }
  });

  it('needs a signed-in person', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences' })).statusCode).toBe(401);
  });
});

describe('“Show my projects only” — an administrator’s own setting (1.22)', () => {
  const get = async (app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers })).json().data;

  it('is off until an administrator turns it on, and stays theirs alone', async () => {
    const { app, as } = await setup();
    const admin = await as('a1', ['ADMIN']);
    expect((await get(app, admin)).myProjectsOnly).toBe(false);
    const put = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: admin, payload: { myProjectsOnly: true } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: true });
    expect(await get(app, admin)).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: true });
    expect((await get(app, await as('a2', ['ADMIN']))).myProjectsOnly).toBe(false);
    // Changing the week start keeps it; turning it off again works.
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: admin, payload: { weekStart: 6 } });
    expect(await get(app, admin)).toEqual({ timeZone: null, weekStart: 6, myProjectsOnly: true });
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: admin, payload: { myProjectsOnly: false } });
    expect((await get(app, admin)).myProjectsOnly).toBe(false);
  });

  it('is an administrator’s option: an employee asking to turn it on is refused, their other settings still save', async () => {
    const { app, as } = await setup();
    const emp = await as('e1');
    const res = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { myProjectsOnly: true } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('Only administrators have this setting.');
    expect((await get(app, emp)).myProjectsOnly).toBe(false);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { weekStart: 1 } })).statusCode).toBe(200);
    // Saying "off" is harmless, so an older client sending the whole object back is not refused.
    expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { myProjectsOnly: false } })).statusCode).toBe(200);
  });
});
