import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createAuthService } from './auth-service';
import { createTokenService } from './token-service';
import { createMemoryRefreshTokenStore } from './memory-refresh-token-store';
import { createSignInChallenges } from './sign-in-challenge';
import { createMemorySignInChallengeStore } from './memory-sign-in-challenge-store';
import { createEmailVerification, type VerificationPerson } from './email-verification';
import { createOtpService } from './otp-service';
import { createMemoryOtpStore } from './memory-otp-store';
import { createFirstPassword } from './first-password';
import { hashPassword, verifyPassword } from '../../lib/password';
import type { AuthUser, AuthUserRepository } from './user-repository';

/**
 * 1.23.6 addendum on the HTTP side: a temporary password signs in only as far as "Choose your own
 * password" — the website (acceptPasswordChange) gets the step, the Android app and the extension are
 * told to use the website first; an unused one past its lifetime stops; nobody else is ever asked.
 */
type Person = AuthUser & { emailVerifiedAt: Date | null; activatedAt: Date | null; mustChange: boolean; expiresAt: Date | null; tokenVersion: number; cancelled?: boolean };
let people: Map<string, Person>;
let mails: { to: string; code: string }[];
let audit: { action: string; entityId?: string | null; newValue?: unknown; userId?: string | null; module?: string }[];
let signIns: string[];
let tempHash: string;
let ownHash: string;
const DAY = 24 * 3600 * 1000;

function person(id: string, o: Partial<Person> = {}): Person {
  const p: Person = {
    id,
    email: `${id}@oxy.com`,
    username: id,
    passwordHash: tempHash,
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    roles: ['EMPLOYEE'],
    emailVerifiedAt: new Date('2026-11-01T00:00:00Z'),
    activatedAt: null,
    mustChange: true,
    expiresAt: new Date(Date.now() + 7 * DAY),
    tokenVersion: 0,
    ...o,
  };
  people.set(id, p);
  return p;
}

const authUsers = (): AuthUserRepository => ({
  async findByIdentifier(identifier) {
    for (const p of people.values()) if (p.email === identifier || p.username === identifier) return { ...p };
    return null;
  },
  async findById(id) {
    const p = people.get(id);
    return p ? { ...p } : null;
  },
  async applyFailedAttempt(id, attempts, lockedUntil) {
    const p = people.get(id)!;
    p.failedLoginAttempts = attempts;
    if (lockedUntil) p.lockedUntil = lockedUntil;
    return true;
  },
  async resetFailedAttempts(id) {
    people.get(id)!.failedLoginAttempts = 0;
  },
  async recordSignIn(id) {
    signIns.push(id);
  },
});

async function makeApp() {
  const signInChallenges = createSignInChallenges({
    store: createMemorySignInChallengeStore(),
    key: 'route-test-key',
    mailer: { isConfigured: () => true, async sendSignInCode(to, code) { mails.push({ to, code }); } },
  });
  const emailVerification = createEmailVerification({
    mailConfigured: () => true,
    repo: {
      async find(id) {
        const p = people.get(id);
        return p ? ({ id: p.id, email: p.email, emailVerifiedAt: p.emailVerifiedAt, roles: p.roles ?? [], status: p.status } satisfies VerificationPerson) : null;
      },
      async otherVerifiedAdmins() {
        return 1;
      },
      async markVerified(id, at) {
        const p = people.get(id);
        if (!p || p.emailVerifiedAt) return false;
        p.emailVerifiedAt = at;
        return true;
      },
    },
  });
  const otpService = createOtpService({
    ttlSeconds: 600,
    otpLength: 6,
    maxAttempts: 3,
    users: {
      async findActiveByIdentifier(identifier) {
        const p = [...people.values()].find((x) => (x.email === identifier || x.username === identifier) && x.status === 'ACTIVE');
        return p ? { id: p.id, email: p.email, username: p.username, roles: p.roles ?? [], avatarUrl: null } : null;
      },
    },
    otps: createMemoryOtpStore(),
    mailer: { isConfigured: () => true, async sendLoginCode(to, code) { mails.push({ to, code }); } },
    runInBackground: (task) => void task(),
  });
  const firstPassword = createFirstPassword({
    key: 'first-password-test-key',
    hashPassword,
    verifyPassword,
    repo: {
      async state(id) {
        const p = people.get(id);
        return p ? { mustChange: p.mustChange, expiresAt: p.expiresAt, passwordHash: p.passwordHash, tokenVersion: p.tokenVersion, active: p.status === 'ACTIVE', cancelled: p.cancelled === true } : null;
      },
      async complete(id, expected, newHash, at) {
        const p = people.get(id);
        if (!p || !p.mustChange || p.passwordHash !== expected) return false;
        Object.assign(p, { passwordHash: newHash, mustChange: false, expiresAt: null, tokenVersion: p.tokenVersion + 1, activatedAt: p.activatedAt ?? at });
        return true;
      },
    },
  });
  const authService = createAuthService({ users: authUsers(), maxAttempts: 5 });
  const tokenService = createTokenService({
    accessSecret: 'access-secret-long-enough',
    refreshSecret: 'refresh-secret-long-enough',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: createMemoryRefreshTokenStore(),
  });
  const auditService = {
    async record(e: (typeof audit)[number]) {
      audit.push(e);
      return {} as never;
    },
    async list() {
      return [];
    },
  };
  return buildApp({ authService, tokenService, signInChallenges, emailVerification, otpService, firstPassword, auditService: auditService as never });
}

const post = (app: Awaited<ReturnType<typeof makeApp>>, url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as Record<string, unknown> });
const WEBSITE = { acceptChallenge: true, acceptPasswordChange: true };

beforeEach(async () => {
  tempHash ??= await hashPassword('Kite-Mango-Fern-Ripple-472');
  ownHash ??= await hashPassword('LongTimeOwn55');
  people = new Map();
  mails = [];
  audit = [];
  signIns = [];
});

describe('POST /auth/login with a temporary password', () => {
  it('the website gets "Choose your own password" (a step ticket), no session, no sign-in recorded', async () => {
    person('ann');
    const app = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'ann', password: 'Kite-Mango-Fern-Ripple-472', ...WEBSITE });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(body.user).toBeUndefined();
    expect(body.changePassword).toEqual({ ticket: expect.any(String), expiresAt: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('Kite');
    expect(signIns).toEqual([]);
  });

  it('the Android app and the extension (no acceptPasswordChange) are told to set it on the website first', async () => {
    person('ann');
    const app = await makeApp();
    for (const extra of [{}, { acceptChallenge: true }]) {
      const res = await post(app, '/auth/login', { identifier: 'ann', password: 'Kite-Mango-Fern-Ripple-472', ...extra });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED', message: expect.stringMatching(/^Set your own password on the website first/) });
    }
    expect(signIns).toEqual([]);
  });

  it('choosing their own password signs them in (once), audited; afterwards only the new password works', async () => {
    person('ann');
    const app = await makeApp();
    const { ticket } = (await post(app, '/auth/login', { identifier: 'ann', password: 'Kite-Mango-Fern-Ripple-472', ...WEBSITE })).json().data.changePassword;
    const same = await post(app, '/auth/password/first-change', { ticket, password: 'Kite-Mango-Fern-Ripple-472' });
    expect(same.statusCode).toBe(400);
    expect(same.json().error.code).toBe('SAME_AS_TEMPORARY');
    const weak = await post(app, '/auth/password/first-change', { ticket, password: 'short' });
    expect(weak.json().error.code).toBe('WEAK_PASSWORD');
    const done = await post(app, '/auth/password/first-change', { ticket, password: 'MyOwnPass99' });
    expect(done.statusCode).toBe(200);
    expect(done.json().data).toMatchObject({ user: { id: 'ann', username: 'ann' }, accessToken: expect.any(String), refreshToken: expect.any(String) });
    expect(signIns).toEqual(['ann']);
    expect(audit).toContainEqual(expect.objectContaining({ module: 'users', action: 'user.password.changed_first_sign_in', entityId: 'ann', userId: 'ann' }));
    expect(JSON.stringify(audit)).not.toContain('MyOwnPass99');
    expect((await post(app, '/auth/password/first-change', { ticket, password: 'Another77Pass' })).json().error.code).toBe('PASSWORD_CHANGE_EXPIRED');
    expect((await post(app, '/auth/login', { identifier: 'ann', password: 'Kite-Mango-Fern-Ripple-472', ...WEBSITE })).statusCode).toBe(401);
    const again = await post(app, '/auth/login', { identifier: 'ann', password: 'MyOwnPass99' });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.accessToken).toEqual(expect.any(String));
  });

  it('an unused temporary password past its lifetime stops (said only after the right password)', async () => {
    person('ann', { expiresAt: new Date(Date.now() - 1000) });
    const app = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'ann', password: 'Kite-Mango-Fern-Ripple-472', ...WEBSITE });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({ code: 'TEMPORARY_PASSWORD_EXPIRED', message: 'This temporary password has expired. Ask your administrator for a new one.' });
    expect((await post(app, '/auth/login', { identifier: 'ann', password: 'Wrong-Guess-11', ...WEBSITE })).json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('no existing account is asked: someone with their own password signs in as before (website and app)', async () => {
    person('omar', { passwordHash: ownHash, mustChange: false, expiresAt: null });
    const app = await makeApp();
    for (const extra of [WEBSITE, {}]) {
      const res = await post(app, '/auth/login', { identifier: 'omar', password: 'LongTimeOwn55', ...extra });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.accessToken).toEqual(expect.any(String));
    }
  });

  it('an unconfirmed address: the emailed code first, then the change (the step comes from /auth/challenge/verify)', async () => {
    person('ann', { emailVerifiedAt: null });
    const app = await makeApp();
    const { challenge } = (await post(app, '/auth/login', { identifier: 'ann', password: 'Kite-Mango-Fern-Ripple-472', ...WEBSITE })).json().data;
    expect(challenge).toBeDefined();
    const verified = await post(app, '/auth/challenge/verify', { challenge: challenge.token, code: mails.at(-1)!.code, acceptPasswordChange: true });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().data.accessToken).toBeUndefined();
    expect(verified.json().data.changePassword.ticket).toEqual(expect.any(String));
    expect(signIns).toEqual([]);
  });

  it('the emailed-code sign-in leads to the same step (website) or the same refusal (app)', async () => {
    person('ann');
    person('bea');
    const app = await makeApp();
    await post(app, '/auth/otp/request', { identifier: 'ann' });
    await new Promise((r) => setTimeout(r, 300)); // bcrypt in the background
    const app1 = await post(app, '/auth/otp/verify', { identifier: 'ann', code: mails.at(-1)!.code });
    expect(app1.statusCode).toBe(403);
    expect(app1.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await post(app, '/auth/otp/request', { identifier: 'bea' });
    await new Promise((r) => setTimeout(r, 300));
    const web = await post(app, '/auth/otp/verify', { identifier: 'bea', code: mails.at(-1)!.code, acceptPasswordChange: true });
    expect(web.statusCode).toBe(200);
    expect(web.json().data.changePassword.ticket).toEqual(expect.any(String));
    expect(signIns).toEqual([]);
  });

  // Security review finding 1: a cancelled invitation blocks a password that was never marked temporary
  // (an account made before 1.23.6 with a typed password) — the same answer as a wrong password.
  it('a cancelled invitation: even the right password signs nobody in, and no code step starts', async () => {
    person('ann', { passwordHash: ownHash, mustChange: false, expiresAt: null, cancelled: true, emailVerifiedAt: null });
    const app = await makeApp();
    for (const extra of [WEBSITE, {}]) {
      const res = await post(app, '/auth/login', { identifier: 'ann', password: 'LongTimeOwn55', ...extra });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    }
    expect(mails).toEqual([]);
    expect(signIns).toEqual([]);
  });

  // Security re-review leftover: a session that slipped in just before Cancel invitation ends at its
  // first refresh.
  it('a cancelled invitation: a refresh gives no new session', async () => {
    person('omar', { passwordHash: ownHash, mustChange: false, expiresAt: null });
    const app = await makeApp();
    const signedIn = (await post(app, '/auth/login', { identifier: 'omar', password: 'LongTimeOwn55' })).json().data;
    people.get('omar')!.cancelled = true;
    const res = await post(app, '/auth/refresh', { refreshToken: signedIn.refreshToken });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_REFRESH_TOKEN');
  });
});
