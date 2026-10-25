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

const tokenService = createTokenService({
  accessSecret: 'wel-access',
  refreshSecret: 'wel-refresh',
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
let mem: ReturnType<typeof createMemoryUserRepository>;
let audited: Audited[];
let sent: { email: string; params: WelcomeEmailParams }[];

/** People the database can't read (a server error for them only). */
let brokenIds: Set<string>;

async function makeApp(opts: { configured?: boolean; blocked?: string[]; auditFails?: boolean; welcomeThrows?: boolean } = {}) {
  brokenIds = new Set();
  mem = createMemoryUserRepository();
  audited = [];
  sent = [];
  const auditService = {
    async record(d: Audited) {
      if (opts.auditFails && d.action === 'user.welcome_email') throw new Error('audit table away');
      audited.push({ userId: d.userId, action: d.action, entityId: d.entityId ?? null, newValue: d.newValue });
      return {} as never;
    },
    async list() {
      return [];
    },
  } as unknown as AuditService;
  const realWelcome = createWelcomeService({
    users: {
      findById: (id) => (brokenIds.has(id) ? Promise.reject(new Error('database away')) : mem.repo.findById(id)),
      markWelcomeSent: (id, at) => mem.repo.markWelcomeSent(id, at),
    },
    tokens: createMemoryWelcomeTokenStore().store,
    mailer: {
      isConfigured: () => opts.configured ?? true,
      isBlocked: async (email) => (opts.blocked ?? []).includes(email),
      async sendWelcome(email, params) {
        sent.push({ email, params });
        return 'sent';
      },
    },
    appUrl: 'https://task.mico360.test',
  });
  // A welcome service that fails outright (as if something below it threw).
  const welcomeService: typeof realWelcome = opts.welcomeThrows
    ? { ...realWelcome, send: async () => Promise.reject(new Error('database away')) }
    : realWelcome;
  const userService = createUserService({ users: mem.repo });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, userService, auditService, welcomeService });
}

const bearer = async (id: string, roles: string[]) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
const newUser = { email: 'sara@x.co', username: 'sara', password: 'Password1!', firstName: 'Sara', lastName: 'K' };

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: { authorization: string };
beforeEach(async () => {
  app = await makeApp();
  admin = await bearer('admin', ['ADMIN']);
});

async function create(payload: Record<string, unknown>, headers = admin) {
  return app.inject({ method: 'POST', url: '/api/v1/users', headers, payload });
}
const tokenIn = (i = sent.length - 1) => new URL(sent[i]!.params.setPasswordLink).searchParams.get('token')!;

describe('POST /users/:id/welcome-email — one person', () => {
  it('an administrator sends it: the result, and an audit entry of who sent it to whom (never the link)', async () => {
    const sara = (await create(newUser)).json().data;
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/welcome-email`, headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ userId: sara.id, username: 'sara', name: 'Sara K', email: 'sara@x.co', sent: true });
    expect(sent.map((s) => s.email)).toEqual(['sara@x.co']);
    expect(audited).toContainEqual({ userId: 'admin', action: 'user.welcome_email', entityId: sara.id, newValue: { to: 'sara@x.co', username: 'sara', bulk: false } });
    expect(JSON.stringify(audited)).not.toContain(tokenIn());
    expect(JSON.stringify(res.json())).not.toContain(tokenIn());
  });

  it('an email that went is reported as sent even if its audit entry couldn’t be written', async () => {
    app = await makeApp({ auditFails: true });
    const sara = (await create(newUser)).json().data;
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/welcome-email`, headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sent).toBe(true);
  });

  it('refuses with the reason in plain words (409), and nothing is audited as sent', async () => {
    const sara = (await create(newUser)).json().data;
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${sara.id}/status`, headers: admin, payload: { status: 'SUSPENDED' } });
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/welcome-email`, headers: admin });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'ACCOUNT_SUSPENDED', message: 'No welcome email was sent: the account is suspended.' });
    expect(audited.some((a) => a.action === 'user.welcome_email')).toBe(false);
  });

  it('an unknown person is 404; a second send within a minute is 429', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/nobody/welcome-email', headers: admin })).statusCode).toBe(404);
    const sara = (await create(newUser)).json().data;
    await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/welcome-email`, headers: admin });
    const again = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/welcome-email`, headers: admin });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.code).toBe('TOO_SOON');
  });
});

describe('POST /users/welcome-emails — several people', () => {
  it('sends to the chosen people and says per person why not; each send is audited', async () => {
    app = await makeApp({ blocked: ['bo@x.co'] });
    const ada = (await create({ ...newUser, email: 'ada@x.co', username: 'ada', firstName: 'Ada' })).json().data;
    const bo = (await create({ ...newUser, email: 'bo@x.co', username: 'bo', firstName: 'Bo' })).json().data;
    const cy = (await create({ ...newUser, email: 'cy@x.co', username: 'cy', firstName: 'Cy' })).json().data;
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${cy.id}/status`, headers: admin, payload: { status: 'INACTIVE' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/welcome-emails', headers: admin, payload: { userIds: [ada.id, bo.id, cy.id] } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect({ sent: data.sent, notSent: data.notSent }).toEqual({ sent: 1, notSent: 2 });
    expect(data.results.map((r: { username: string; sent: boolean; reason?: string; why?: string }) => [r.username, r.sent, r.reason ?? null, r.why ?? null])).toEqual([
      ['ada', true, null, null],
      ['bo', false, 'EMAIL_BLOCKED', 'emails to this address are blocked (it bounced or was marked as spam)'],
      ['cy', false, 'ACCOUNT_INACTIVE', 'the account is inactive'],
    ]);
    expect(audited.filter((a) => a.action === 'user.welcome_email')).toEqual([
      { userId: 'admin', action: 'user.welcome_email', entityId: ada.id, newValue: { to: 'ada@x.co', username: 'ada', bulk: true } },
    ]);
  });

  it('at most 200 people a send, and at least one', async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `u${i}`);
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/welcome-emails', headers: admin, payload: { userIds: tooMany } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/welcome-emails', headers: admin, payload: { userIds: [] } })).statusCode).toBe(400);
  });

  it('one bulk send a minute per administrator', async () => {
    const sara = (await create(newUser)).json().data;
    const bulk = (headers: { authorization: string }) => app.inject({ method: 'POST', url: '/api/v1/users/welcome-emails', headers, payload: { userIds: [sara.id] } });
    expect((await bulk(admin)).statusCode).toBe(200);
    const again = await bulk(admin);
    expect(again.statusCode).toBe(429);
    expect(again.json().error).toEqual({ code: 'TOO_SOON', message: 'Welcome emails were just sent. Wait a minute before sending more.' });
    // Another administrator isn't held up (the person just emailed is refused as too soon, not the request).
    const other = await bulk(await bearer('admin-2', ['ADMIN']));
    expect(other.statusCode).toBe(200);
    expect(other.json().data.results[0]).toMatchObject({ sent: false, reason: 'TOO_SOON' });
  });
});

describe('Welcome emails are for administrators, and need email set up', () => {
  it('an employee is refused (403), a stranger too (401), and nothing is sent', async () => {
    const sara = (await create(newUser)).json().data;
    const employee = await bearer(sara.id, ['EMPLOYEE']);
    expect((await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/welcome-email`, headers: employee })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/welcome-emails', headers: employee, payload: { userIds: [sara.id] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/welcome-email` })).statusCode).toBe(401);
    expect((await create({ ...newUser, email: 'x@x.co', username: 'x', sendWelcome: true }, employee)).statusCode).toBe(403);
    expect(sent).toEqual([]);
  });

  it('email not set up: says so plainly (503) for one, several, or a new account (which isn’t made)', async () => {
    app = await makeApp({ configured: false });
    const sara = (await create(newUser)).json().data;
    const one = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/welcome-email`, headers: admin });
    expect(one.statusCode).toBe(503);
    expect(one.json().error).toEqual({
      code: 'EMAIL_NOT_CONFIGURED',
      message: 'Email isn’t set up on this server yet, so no welcome email can be sent. An administrator needs to add the email (Mailjet) keys.',
    });
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/welcome-emails', headers: admin, payload: { userIds: [sara.id] } })).statusCode).toBe(503);
    expect((await create({ ...newUser, email: 'new@x.co', username: 'new', password: undefined, sendWelcome: true })).statusCode).toBe(503);
    expect((await mem.repo.list()).map((u) => u.username)).toEqual(['sara']);
  });
});

describe('POST /users with "Send a welcome email"', () => {
  it('needs no password: the account gets an unusable one, and the email goes (audited)', async () => {
    const { password, ...noPassword } = newUser;
    void password;
    const res = await create({ ...noPassword, sendWelcome: true });
    expect(res.statusCode).toBe(201);
    const { data, meta } = res.json();
    expect(meta.welcome).toMatchObject({ userId: data.id, sent: true });
    expect(data.welcomeSentAt).toBeTruthy();
    expect(mem.hashOf(data.id)).toMatch(/^\$2[aby]\$/);
    expect(sent[0]!.params.setPasswordLink).toMatch(/^https:\/\/task\.mico360\.test\/reset\?token=.+&welcome=1$/);
    expect(audited.map((a) => a.action)).toEqual(['user.create', 'user.welcome_email']);
    expect(audited[0]!.newValue).toEqual({ email: 'sara@x.co', username: 'sara', roleNames: ['EMPLOYEE'], welcomeEmail: true });
  });

  it('with a temporary password as well: that password works, and the email goes', async () => {
    const res = await create({ ...newUser, sendWelcome: true });
    expect(res.statusCode).toBe(201);
    expect(await verifyPassword('Password1!', mem.hashOf(res.json().data.id)!)).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('without it, today’s rule stays: a temporary password is required (and no email goes)', async () => {
    const { password, ...noPassword } = newUser;
    void password;
    const res = await create(noPassword);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(res.json().error.details.fieldErrors.password).toEqual(['Required']);
    expect((await create({ ...newUser, sendWelcome: false })).json().meta).toBeUndefined();
    expect(sent).toEqual([]);
  });

  it('a weak temporary password is still refused', async () => {
    expect((await create({ ...newUser, password: 'abc', sendWelcome: true })).json().error.code).toBe('WEAK_PASSWORD');
    expect(sent).toEqual([]);
  });

  it('the account is made even when the welcome email can’t go, and says why', async () => {
    app = await makeApp({ blocked: ['sara@x.co'] });
    const res = await create({ ...newUser, sendWelcome: true });
    expect(res.statusCode).toBe(201);
    expect(res.json().meta.welcome).toMatchObject({ sent: false, reason: 'EMAIL_BLOCKED' });
    expect(audited.map((a) => a.action)).toEqual(['user.create']);
  });
});

describe('A server error during a send never loses the account, the results or the audit entries', () => {
  it('POST /users: the account is made and the answer is 201 with a failed welcome result, never a 500', async () => {
    app = await makeApp({ welcomeThrows: true });
    const res = await create({ ...newUser, sendWelcome: true });
    expect(res.statusCode).toBe(201);
    expect(res.json().meta.welcome).toMatchObject({ userId: res.json().data.id, username: 'sara', sent: false, reason: 'SERVER_ERROR', why: 'something went wrong on the server (try again)' });
    expect((await mem.repo.list()).map((u) => u.username)).toEqual(['sara']);
  });

  it('several people: the one the server failed on is “not sent”, the others go and are audited one by one', async () => {
    const ada = (await create({ ...newUser, email: 'ada@x.co', username: 'ada' })).json().data;
    const bo = (await create({ ...newUser, email: 'bo@x.co', username: 'bo' })).json().data;
    brokenIds.add(bo.id);
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/welcome-emails', headers: admin, payload: { userIds: [ada.id, bo.id] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ sent: 1, notSent: 1 });
    expect(res.json().data.results[1]).toMatchObject({ userId: bo.id, sent: false, reason: 'SERVER_ERROR' });
    expect(audited.filter((a) => a.action === 'user.welcome_email').map((a) => a.entityId)).toEqual([ada.id]);
  });

  it('one person: a server error answers 500 in plain words', async () => {
    const bo = (await create(newUser)).json().data;
    brokenIds.add(bo.id);
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${bo.id}/welcome-email`, headers: admin });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({ code: 'SERVER_ERROR', message: 'No welcome email was sent: something went wrong on the server (try again).' });
  });
});
