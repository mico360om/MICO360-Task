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
    expect(res.json().data).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
  });

  it('keeps each person’s own week start and time zone', async () => {
    const { app, as } = await setup();
    const put = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('u1'), payload: { weekStart: 1, timeZone: 'Europe/London' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toEqual({ timeZone: 'Europe/London', weekStart: 1, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u1') })).json().data).toEqual({ timeZone: 'Europe/London', weekStart: 1, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u2') })).json().data).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    // Back to the defaults; a partial change leaves the rest.
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('u1'), payload: { timeZone: null } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: await as('u1') })).json().data).toEqual({ timeZone: null, weekStart: 1, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
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
    const put = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: admin, payload: { myProjectsOnly: true, density: 'comfortable' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: true, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    expect(await get(app, admin)).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: true, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    expect((await get(app, await as('a2', ['ADMIN']))).myProjectsOnly).toBe(false);
    // Changing the week start keeps it; turning it off again works.
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: admin, payload: { weekStart: 6 } });
    expect(await get(app, admin)).toEqual({ timeZone: null, weekStart: 6, myProjectsOnly: true, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: admin, payload: { myProjectsOnly: false, density: 'comfortable' } });
    expect((await get(app, admin)).myProjectsOnly).toBe(false);
  });

  it('is an administrator’s option: an employee asking to turn it on is refused, their other settings still save', async () => {
    const { app, as } = await setup();
    const emp = await as('e1');
    const res = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { myProjectsOnly: true, density: 'comfortable' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('Only administrators have this setting.');
    expect((await get(app, emp)).myProjectsOnly).toBe(false);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { weekStart: 1 } })).statusCode).toBe(200);
    // Saying "off" is harmless, so an older client sending the whole object back is not refused.
    expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { myProjectsOnly: false, density: 'comfortable' } })).statusCode).toBe(200);
  });
});

describe('Compact / comfortable rows — each person’s own (1.23.0)', () => {
  const get = async (app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers })).json().data;

  it('is comfortable until the person picks compact, and follows only them', async () => {
    const { app, as } = await setup();
    const emp = await as('e1');
    expect((await get(app, emp)).density).toBe('comfortable');
    const put = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { density: 'compact' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: false, density: 'compact', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    expect((await get(app, emp)).density).toBe('compact');
    expect((await get(app, await as('e2'))).density).toBe('comfortable');
    // Another setting saved later keeps it; back to comfortable works.
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { weekStart: 1 } });
    expect(await get(app, emp)).toEqual({ timeZone: null, weekStart: 1, myProjectsOnly: false, density: 'compact', sidebarCollapsed: false, boardColumnWidth: 'normal' });
    await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { density: 'comfortable' } });
    expect((await get(app, emp)).density).toBe('comfortable');
  });

  it('is anyone’s to set (an administrator too) and takes only the two words', async () => {
    const { app, as } = await setup();
    expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('a1', ['ADMIN']), payload: { density: 'compact' } })).statusCode).toBe(200);
    // "Show my projects only" refused for an employee refuses the whole change: their rows stay as they were.
    const emp = await as('e1');
    const both = await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: emp, payload: { myProjectsOnly: true, density: 'compact' } });
    expect(both.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers: emp })).json().data.density).toBe('comfortable');
    for (const density of ['dense', 'COMPACT', '', null, 1, true]) {
      expect((await app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers: await as('e1'), payload: { density } })).statusCode).toBe(400);
    }
  });
});

describe('Detailed rows, the collapsed menu and board column width — each person’s own (1.23.8)', () => {
  const get = async (app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/api/v1/users/me/preferences', headers })).json().data;
  const put = async (app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>, payload: unknown) =>
    app.inject({ method: 'PUT', url: '/api/v1/users/me/preferences', headers, payload: payload as Record<string, unknown> });

  it('starts with the menu open and Normal columns; the answer adds the two (an older app reads what it knows)', async () => {
    const { app, as } = await setup();
    expect(await get(app, await as('e1'))).toEqual({ timeZone: null, weekStart: null, myProjectsOnly: false, density: 'comfortable', sidebarCollapsed: false, boardColumnWidth: 'normal' });
  });

  it('Detailed is the third row mode, anyone’s to pick', async () => {
    const { app, as } = await setup();
    const emp = await as('e1');
    expect((await put(app, emp, { density: 'detailed' })).statusCode).toBe(200);
    expect((await get(app, emp)).density).toBe('detailed');
    expect((await get(app, await as('e2'))).density).toBe('comfortable');
    for (const density of ['Detailed', 'detail', 'spacious']) expect((await put(app, emp, { density })).statusCode).toBe(400);
    expect((await get(app, emp)).density).toBe('detailed');
  });

  it('the collapsed menu is saved on the account, the person’s alone; a true/false only', async () => {
    const { app, as } = await setup();
    const emp = await as('e1');
    const res = await put(app, emp, { sidebarCollapsed: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sidebarCollapsed).toBe(true);
    expect((await get(app, emp)).sidebarCollapsed).toBe(true);
    expect((await get(app, await as('e2'))).sidebarCollapsed).toBe(false);
    for (const sidebarCollapsed of ['yes', null, 1]) expect((await put(app, emp, { sidebarCollapsed })).statusCode).toBe(400);
    // Another setting saved later keeps it.
    await put(app, emp, { density: 'compact' });
    expect((await get(app, emp)).sidebarCollapsed).toBe(true);
    await put(app, emp, { sidebarCollapsed: false });
    expect((await get(app, emp)).sidebarCollapsed).toBe(false);
  });

  it('board column width is Narrow, Normal or Wide, each person’s own', async () => {
    const { app, as } = await setup();
    const emp = await as('e1', ['EMPLOYEE']);
    for (const boardColumnWidth of ['narrow', 'wide', 'normal'] as const) {
      const res = await put(app, emp, { boardColumnWidth });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.boardColumnWidth).toBe(boardColumnWidth);
    }
    await put(app, emp, { boardColumnWidth: 'wide' });
    expect((await get(app, await as('e2'))).boardColumnWidth).toBe('normal');
    for (const boardColumnWidth of ['Wide', 'huge', '', null, 300]) expect((await put(app, emp, { boardColumnWidth })).statusCode).toBe(400);
    expect((await get(app, emp)).boardColumnWidth).toBe('wide');
  });
});
