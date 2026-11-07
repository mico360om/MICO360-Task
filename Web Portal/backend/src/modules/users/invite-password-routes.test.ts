import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createUserService } from './user-service';
import { createMemoryUserRepository } from './memory-user-repository';
import { createMemoryWelcomeTokenStore } from './memory-welcome-store';
import { createWelcomeService } from './welcome-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { verifyPassword } from '../../lib/password';
import type { AuditService } from '../audit/audit-service';
import type { WelcomeEmailParams } from '../email/email-templates';

/**
 * 1.23.6 addendum, User Management's side: one way in (an invitation link or a temporary password, never
 * both), generated temporary passwords returned once, typed ones always temporary, the link's lifetime,
 * Cancel invitation and at most five sends a day.
 */
const tokenService = createTokenService({
  accessSecret: 'ipw-access',
  refreshSecret: 'ipw-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

interface Audited {
  userId: string | null;
  action: string;
  entityId: string | null;
  newValue?: unknown;
}
const DAY = 24 * 3600 * 1000;
let mem: ReturnType<typeof createMemoryUserRepository>;
let audited: Audited[];
let sent: { email: string; params: WelcomeEmailParams }[];
let settingDays: number | undefined;
let tokens: ReturnType<typeof createMemoryWelcomeTokenStore>;

async function makeApp() {
  mem = createMemoryUserRepository();
  audited = [];
  sent = [];
  settingDays = undefined;
  tokens = createMemoryWelcomeTokenStore();
  const auditService = {
    async record(d: Audited) {
      audited.push({ userId: d.userId, action: d.action, entityId: d.entityId ?? null, newValue: d.newValue });
      return {} as never;
    },
    async list() {
      return [];
    },
  } as unknown as AuditService;
  const invitationDays = async () => settingDays ?? 7;
  const welcomeService = createWelcomeService({
    users: { findById: (id) => mem.repo.findById(id), markWelcomeSent: (id, at) => mem.repo.markWelcomeSent(id, at) },
    tokens: tokens.store,
    mailer: {
      isConfigured: () => true,
      isBlocked: async () => false,
      async sendWelcome(email, params) {
        sent.push({ email, params });
        return 'sent';
      },
    },
    appUrl: 'https://task.mico360.test',
    defaultDays: invitationDays,
    resendGapMs: 0,
  });
  const userService = createUserService({ users: mem.repo });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, userService, auditService, welcomeService, invitationDays });
}

const bearer = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
const newUser = { email: 'sara@x.co', username: 'sara', firstName: 'Sara', lastName: 'K' };

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Record<string, string>;
const create = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/users', headers: admin, payload: body });
const post = (url: string, body: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers: admin, payload: body });

beforeEach(async () => {
  app = await makeApp();
  admin = await bearer('admin-1', ['ADMIN']);
});

describe('one way in: an invitation link or a temporary password, never both', () => {
  it('both together are refused from every caller (the website, the Android app, the API) — nothing is made, nothing goes', async () => {
    for (const body of [
      { ...newUser, sendWelcome: true, password: 'Password1!' },
      { ...newUser, sendWelcome: true, generatePassword: 'words' },
      { ...newUser, password: 'Password1!', generatePassword: 'characters' },
    ]) {
      const res = await create(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toEqual({ code: 'ONE_WAY_IN', message: 'Choose one way in: an invitation link or a temporary password — not both.' });
    }
    expect(await mem.repo.list()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('a generated temporary password is returned once (never again), must be changed at the first sign-in, and is audited without its value', async () => {
    const res = await create({ ...newUser, generatePassword: 'words' });
    expect(res.statusCode).toBe(201);
    const { data, meta } = res.json();
    expect(meta.temporaryPassword).toMatch(/^([A-Z][a-z]{3,6}-){4}\d{3}$/);
    expect(await verifyPassword(meta.temporaryPassword, mem.hashOf(data.id)!)).toBe(true);
    expect(data).toMatchObject({ mustChangePassword: true, temporaryPasswordSetBy: { id: 'admin-1' } });
    expect(Date.parse(data.temporaryPasswordExpiresAt) - Date.parse(data.temporaryPasswordSetAt)).toBe(7 * DAY);
    expect(sent).toEqual([]);
    const later = (await app.inject({ method: 'GET', url: `/api/v1/users/${data.id}`, headers: admin })).body;
    expect(later).not.toContain(meta.temporaryPassword);
    expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: admin })).body).not.toContain(meta.temporaryPassword);
    expect(audited.map((a) => a.action)).toEqual(['user.create', 'user.password.temporary']);
    expect(audited[1]).toMatchObject({ userId: 'admin-1', entityId: data.id, newValue: { generated: true, expiresAt: data.temporaryPasswordExpiresAt } });
    expect(JSON.stringify(audited)).not.toContain(meta.temporaryPassword);
  });

  it('16 characters when asked', async () => {
    const res = await create({ ...newUser, generatePassword: 'characters' });
    expect(res.json().meta.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{16}$/);
  });

  it('a typed password (the Android app, the API) is accepted but always temporary: changed at the first sign-in, ends with the lifetime; never echoed', async () => {
    settingDays = 3;
    const res = await create({ ...newUser, password: 'Password1!' });
    expect(res.statusCode).toBe(201);
    const { data, meta } = res.json();
    expect(meta).toBeUndefined();
    expect(data.mustChangePassword).toBe(true);
    expect(Date.parse(data.temporaryPasswordExpiresAt) - Date.parse(data.temporaryPasswordSetAt)).toBe(3 * DAY);
    expect(audited[1]).toMatchObject({ action: 'user.password.temporary', newValue: { generated: false } });
    expect(res.body).not.toContain('Password1!');
  });

  it('an invitation link lasts the setting’s days, or the days chosen for this one (1, 3, 7, 14); anything else is refused', async () => {
    settingDays = 3;
    const first = await create({ ...newUser, sendWelcome: true });
    expect(first.statusCode).toBe(201);
    expect(sent[0]!.params.expiresInDays).toBe(3);
    expect(first.json().data.mustChangePassword).toBe(false);
    const chosen = await create({ ...newUser, email: 'omar@x.co', username: 'omar', sendWelcome: true, inviteDays: 14 });
    expect(sent[1]!.params.expiresInDays).toBe(14);
    expect(Date.parse(chosen.json().meta.welcome.expiresAt) - Date.parse(chosen.json().meta.welcome.sentAt)).toBe(14 * DAY);
    expect((await create({ ...newUser, email: 'x@x.co', username: 'x', sendWelcome: true, inviteDays: 30 })).statusCode).toBe(400);
    // Resend with a lifetime of its own.
    const resend = await post(`/users/${first.json().data.id}/welcome-email`, { days: 1 });
    expect(resend.statusCode).toBe(200);
    expect(sent[2]!.params.expiresInDays).toBe(1);
  });
});

describe('Set a temporary password (Manage account)', () => {
  it('generated: returned once with when it ends; typed: 204; both or neither: 400; never your own account', async () => {
    const sara = (await create({ ...newUser, sendWelcome: true })).json().data;
    const gen = await post(`/users/${sara.id}/password`, { generate: 'characters', days: 14 });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().data).toEqual({ temporaryPassword: expect.stringMatching(/^[A-HJ-NP-Za-km-np-z2-9]{16}$/), expiresAt: expect.any(String) });
    const after = await mem.repo.findById(sara.id);
    expect(after).toMatchObject({ mustChangePassword: true });
    expect(after!.temporaryPasswordExpiresAt!.getTime() - after!.temporaryPasswordSetAt!.getTime()).toBe(14 * DAY);
    // (One way in: the invitation link stops — on the database, tests/integration/invite-password-security.)
    expect(audited.at(-1)).toMatchObject({ action: 'user.password.reset', entityId: sara.id, newValue: { temporary: true, generated: true } });
    expect(JSON.stringify(audited)).not.toContain(gen.json().data.temporaryPassword);
    const typed = await post(`/users/${sara.id}/password`, { password: 'Typed-Pass-77' });
    expect(typed.statusCode).toBe(204);
    expect((await mem.repo.findById(sara.id))!.mustChangePassword).toBe(true);
    expect((await post(`/users/${sara.id}/password`, { password: 'Typed-Pass-77', generate: 'words' })).statusCode).toBe(400);
    expect((await post(`/users/${sara.id}/password`, {})).statusCode).toBe(400);
    const me = await mem.repo.create({ email: 'me@x.co', username: 'me', passwordHash: 'h', firstName: 'Me', lastName: 'A', roleNames: ['ADMIN'] });
    admin = await bearer(me.id, ['ADMIN']);
    const own = await post(`/users/${me.id}/password`, { generate: 'words' });
    expect(own.statusCode).toBe(403);
    expect(own.json().error.code).toBe('NOT_YOUR_OWN');
  });
});

describe('Cancel invitation', () => {
  it('ends the link and any unused temporary password; status "Invitation cancelled"; audited; a new invitation undoes it', async () => {
    const sara = (await create({ ...newUser, sendWelcome: true })).json().data;
    const res = await post(`/users/${sara.id}/invitation/cancel`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: sara.id, invitationCancelledAt: expect.any(String) });
    expect(audited.at(-1)).toMatchObject({ action: 'user.invitation.cancelled', entityId: sara.id, userId: 'admin-1' });
    expect((await post(`/users/${sara.id}/welcome-email`)).statusCode).toBe(200);
    expect((await mem.repo.findById(sara.id))!.invitationCancelledAt).toBeNull();
  });

  it('a temporary-password account: the password stops working', async () => {
    const res = await create({ ...newUser, generatePassword: 'words' });
    const { data, meta } = res.json();
    expect((await post(`/users/${data.id}/invitation/cancel`)).statusCode).toBe(200);
    expect(await verifyPassword(meta.temporaryPassword, mem.hashOf(data.id)!)).toBe(false);
    expect((await mem.repo.findById(data.id))!.mustChangePassword).toBe(false);
  });

  it('someone who has signed in: nothing to cancel (409); an unknown person 404; an employee 403', async () => {
    const sara = (await create({ ...newUser, sendWelcome: true })).json().data;
    const omar = await mem.repo.create({ email: 'omar@x.co', username: 'omar', passwordHash: 'h', firstName: 'Omar', lastName: 'B', roleNames: ['EMPLOYEE'] });
    mem.signedIn(omar.id, new Date('2026-11-01T08:00:00Z'));
    const signedIn = await post(`/users/${omar.id}/invitation/cancel`);
    expect(signedIn.statusCode).toBe(409);
    expect(audited.filter((a) => a.action === 'user.invitation.cancelled')).toEqual([]);
    expect((await post('/users/nobody/invitation/cancel')).statusCode).toBe(404);
    admin = await bearer('emp-1', ['EMPLOYEE']);
    expect((await post(`/users/${sara.id}/invitation/cancel`)).statusCode).toBe(403);
  });
});

describe('at most five invitations a day to one person', () => {
  it('the sixth is refused with 429 and plain words', async () => {
    const sara = (await create({ ...newUser, sendWelcome: true })).json().data;
    for (let i = 0; i < 4; i++) expect((await post(`/users/${sara.id}/welcome-email`)).statusCode).toBe(200);
    const sixth = await post(`/users/${sara.id}/welcome-email`);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error).toEqual({ code: 'DAILY_LIMIT', message: 'No welcome email was sent: it has gone to them 5 times in the last 24 hours (try again tomorrow).' });
  });
});
