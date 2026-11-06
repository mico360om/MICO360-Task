import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createUserService } from './user-service';
import { createMemoryUserRepository } from './memory-user-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { AuditService } from '../audit/audit-service';
import type { IdentityLookup } from './identity-check';
import type { AdminResetOutcome } from '../auth/password-reset-service';

/**
 * Onboarding's administrator routes: a reason with a status change, "Send password reset", "Mark email
 * as verified", the duplicate check while typing, and the detail rules on a new account.
 */
const tokenService = createTokenService({
  accessSecret: 'onb-access',
  refreshSecret: 'onb-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

let mem: ReturnType<typeof createMemoryUserRepository>;
let audit: { action: string; entityId: string | null; newValue: unknown; userId: string | null }[];
let resets: string[];
let resetAnswer: (id: string) => AdminResetOutcome;
let mailOn: boolean;
let verified: { id: string; how: string; reason?: string; actorId?: string | null }[];
let lookups: unknown[];

const lookup: IdentityLookup = {
  async byEmail(email) {
    lookups.push(['email', email]);
    return email.toLowerCase() === 'ahmed@oxy.com' ? { id: 'c1', name: 'Ahmed Al Harthy', username: 'ahmed', kind: 'client', organisation: 'OXY', status: 'ACTIVE' } : null;
  },
  async byUsername(username) {
    return username.toLowerCase() === 'ahmed' ? { id: 'c1', name: 'Ahmed Al Harthy', username: 'ahmed', kind: 'client', organisation: 'OXY', status: 'ACTIVE' } : null;
  },
  async sameName(firstName, lastName, opts) {
    lookups.push(['name', firstName, lastName, opts]);
    return firstName === 'Saif' ? [{ id: 'c2', name: 'Saif Al Said', username: 'saif', kind: 'client', organisation: 'OXY', status: 'ACTIVE' }] : [];
  },
};

async function makeApp() {
  mem = createMemoryUserRepository();
  audit = [];
  resets = [];
  verified = [];
  lookups = [];
  mailOn = true;
  resetAnswer = (id) => ({ userId: id, email: 'x@y.co', sent: true, sentAt: '2026-11-07T08:00:00.000Z' });
  const auditService = {
    async record(d: { action: string; entityId?: string | null; newValue?: unknown; userId?: string | null }) {
      audit.push({ action: d.action, entityId: d.entityId ?? null, newValue: d.newValue, userId: d.userId ?? null });
      return {} as never;
    },
    async list() {
      return [];
    },
  } as unknown as AuditService;
  const userService = createUserService({ users: mem.repo });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({
    authService,
    tokenService,
    userService,
    auditService,
    identityLookup: lookup,
    adminPasswordReset: {
      isConfigured: () => mailOn,
      async sendForAdministrator(id) {
        resets.push(id);
        return resetAnswer(id);
      },
    },
    emailVerification: {
      needsCode: async () => false,
      mailConfigured: () => mailOn,
      async confirm(id, how, opts) {
        verified.push({ id, how, ...(opts?.reason ? { reason: opts.reason } : {}), actorId: opts?.actorId ?? null });
        return 'verified';
      },
    },
  });
}
const adminHeaders = async (id = 'admin') => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles: ['ADMIN'] })).accessToken}` });
const employeeHeaders = async () => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id: 'emp', roles: ['EMPLOYEE'] })).accessToken}` });
const newUser = { email: 'sara@x.co', username: 'sara', password: 'Password1!', firstName: 'Sara', lastName: 'A' };

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});
const make = async (payload: Record<string, unknown> = {}) => (await app.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders(), payload: { ...newUser, ...payload } })).json().data;

describe('Deactivate / reactivate with a reason', () => {
  it('the reason is audited with the status and what it was', async () => {
    const sara = await make();
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/users/${sara.id}/status`, headers: await adminHeaders(), payload: { status: 'INACTIVE', reason: 'Left the company' } });
    expect(res.statusCode).toBe(200);
    expect(audit.find((a) => a.action === 'user.status')).toMatchObject({ entityId: sara.id, newValue: { status: 'INACTIVE', previous: 'ACTIVE', reason: 'Left the company' } });
    await app.inject({ method: 'PATCH', url: `/api/v1/users/${sara.id}/status`, headers: await adminHeaders(), payload: { status: 'ACTIVE' } });
    expect(audit.filter((a) => a.action === 'user.status')[1]).toMatchObject({ newValue: { status: 'ACTIVE', previous: 'INACTIVE' } });
  });

  it('a reason longer than 300 characters is refused (400)', async () => {
    const sara = await make();
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/users/${sara.id}/status`, headers: await adminHeaders(), payload: { status: 'INACTIVE', reason: 'x'.repeat(301) } });
    expect(res.statusCode).toBe(400);
  });
});

describe('Send password reset (administrators)', () => {
  it('sends, audits who and to which address (never the link)', async () => {
    const sara = await make();
    resetAnswer = (id) => ({ userId: id, email: 'sara@x.co', sent: true, sentAt: '2026-11-07T08:00:00.000Z' });
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/password-reset-email`, headers: await adminHeaders() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ sent: true, email: 'sara@x.co' });
    expect(resets).toEqual([sara.id]);
    expect(audit.find((a) => a.action === 'user.password.reset_sent')).toEqual({ action: 'user.password.reset_sent', entityId: sara.id, userId: 'admin', newValue: { to: 'sara@x.co' } });
  });

  it('a refusal is its status with the reason in words', async () => {
    const sara = await make();
    resetAnswer = (id) => ({ userId: id, email: 'sara@x.co', sent: false, reason: 'ACCOUNT_INACTIVE', why: 'the account is inactive (reactivate it first)' });
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/password-reset-email`, headers: await adminHeaders() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({ code: 'ACCOUNT_INACTIVE', message: 'No reset link was sent: the account is inactive (reactivate it first).' });
    expect(audit.some((a) => a.action === 'user.password.reset_sent')).toBe(false);
  });

  it('without mail settings: 503 EMAIL_NOT_CONFIGURED, nothing tried', async () => {
    const sara = await make();
    mailOn = false;
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/password-reset-email`, headers: await adminHeaders() });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('EMAIL_NOT_CONFIGURED');
    expect(resets).toEqual([]);
  });

  it('employees can’t (403)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/x/password-reset-email', headers: await employeeHeaders() });
    expect(res.statusCode).toBe(403);
  });
});

describe('Mark email as verified (administrators, with a reason)', () => {
  it('confirms the address as the administrator, with the reason', async () => {
    const sara = await make();
    const res = await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/email-verified`, headers: await adminHeaders(), payload: { reason: 'Checked by phone' } });
    expect(res.statusCode).toBe(200);
    expect(verified).toEqual([{ id: sara.id, how: 'administrator', reason: 'Checked by phone', actorId: 'admin' }]);
    expect(res.json().data.id).toBe(sara.id);
  });

  it('a reason is required (1–300 characters)', async () => {
    const sara = await make();
    for (const payload of [{}, { reason: '   ' }, { reason: 'x'.repeat(301) }]) {
      expect((await app.inject({ method: 'POST', url: `/api/v1/users/${sara.id}/email-verified`, headers: await adminHeaders(), payload })).statusCode).toBe(400);
    }
    expect(verified).toEqual([]);
  });

  it('never your own account (403): another administrator vouches for you', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/admin/email-verified', headers: await adminHeaders('admin'), payload: { reason: 'me' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_YOUR_OWN');
  });

  it('employees can’t (403)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/x/email-verified', headers: await employeeHeaders(), payload: { reason: 'x' } })).statusCode).toBe(403);
  });
});

describe('The duplicate check while typing (administrators)', () => {
  it('names the account holding the email, the username, and anyone with the same name at the same organisation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users/identity-check',
      headers: await adminHeaders(),
      payload: { email: ' Ahmed@OXY.com ', username: 'AHMED', firstName: 'Saif', lastName: 'Al Said', organisation: 'oxy', client: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      email: { id: 'c1', name: 'Ahmed Al Harthy', username: 'ahmed', kind: 'client', organisation: 'OXY', status: 'ACTIVE' },
      username: { id: 'c1', name: 'Ahmed Al Harthy', username: 'ahmed', kind: 'client', organisation: 'OXY', status: 'ACTIVE' },
      sameName: [{ id: 'c2', name: 'Saif Al Said', username: 'saif', kind: 'client', organisation: 'OXY', status: 'ACTIVE' }],
    });
    // The email is looked up trimmed.
    expect(lookups[0]).toEqual(['email', 'Ahmed@OXY.com']);
  });

  it('the account being edited isn’t a clash with itself', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/users/identity-check', headers: await adminHeaders(), payload: { email: 'ahmed@oxy.com', excludeId: 'c1' } });
    expect(res.json().data).toEqual({ email: null, username: null, sameName: [] });
  });

  it('nothing given, nothing found; lengths are checked; employees can’t', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/identity-check', headers: await adminHeaders(), payload: {} })).json().data).toEqual({ email: null, username: null, sameName: [] });
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/identity-check', headers: await adminHeaders(), payload: { email: `${'a'.repeat(200)}@x.co` } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/users/identity-check', headers: await employeeHeaders(), payload: { email: 'a@b.co' } })).statusCode).toBe(403);
  });
});

describe('A new account’s details follow the rules (the server never trusts the form)', () => {
  it('a username with a space, or too short: 400 naming the field', async () => {
    for (const username of ['sa', 'with space']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders(), payload: { ...newUser, username } });
      expect(res.statusCode, username).toBe(400);
      expect(res.json().error.details).toMatchObject({ field: 'username', fieldErrors: { username: [expect.any(String)] } });
    }
  });

  it('a duplicate email (any case, spaces) is 409 naming the field and the holder', async () => {
    await make();
    const res = await app.inject({ method: 'POST', url: '/api/v1/users', headers: await adminHeaders(), payload: { ...newUser, email: '  SARA@x.co ', username: 'sara2' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'DUPLICATE_USER', message: 'This email address is already used by Sara A.', details: { field: 'email', name: 'Sara A', kind: 'staff' } });
  });
});
