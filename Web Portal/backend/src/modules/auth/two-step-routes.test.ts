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
import { createTwoStep } from './two-step';
import { createMemoryTrustedBrowserStore } from './memory-trusted-browser-store';
import { hashPassword, verifyPassword } from '../../lib/password';
import type { AuthUser, AuthUserRepository } from './user-repository';

/**
 * 1.24 two-step sign-in for administrators, on the HTTP side. The website says it can take the code step
 * (acceptChallenge, as since onboarding); the Android app and the extension never do, so they are refused
 * for administrators — the way they sign in today, unchanged — and keep working for everyone else.
 */
type Person = AuthUser & { emailVerifiedAt: Date | null; tokenVersion: number; mustChange?: boolean };
let people: Map<string, Person>;
let mails: { to: string; code: string; kind?: string }[];
let notices: { to: string; browser: string }[];
let audit: { action: string; module?: string; entityId?: string | null; newValue?: unknown; userId?: string | null }[];
let signIns: string[];
let hash: string;
let tempHash: string;
let switchedOn: boolean;
let mailOn: boolean;

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PW = 'CorrectHorse1';

function person(id: string, o: Partial<Person> = {}): Person {
  const p: Person = {
    id,
    email: `${id}@acme.com`,
    username: id,
    passwordHash: hash,
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    roles: ['EMPLOYEE'],
    emailVerifiedAt: new Date('2026-10-01T00:00:00Z'),
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

async function makeApp(o: { secureCookies?: boolean } = {}) {
  const signInChallenges = createSignInChallenges({
    store: createMemorySignInChallengeStore(),
    key: 'route-test-key',
    mailer: { isConfigured: () => mailOn, async sendSignInCode(to, code, opts) { mails.push({ to, code, kind: opts.kind }); } },
  });
  const emailVerification = createEmailVerification({
    mailConfigured: () => mailOn,
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
        return p ? { id: p.id, email: p.email, username: p.username, roles: p.roles ?? [], avatarUrl: null, tokenVersion: p.tokenVersion } : null;
      },
    },
    otps: createMemoryOtpStore(),
    mailer: { isConfigured: () => true, async sendLoginCode(to, code) { mails.push({ to, code, kind: 'LOGIN' }); } },
    runInBackground: (task) => void task(),
  });
  const firstPassword = createFirstPassword({
    key: 'first-password-test-key',
    hashPassword,
    verifyPassword,
    repo: {
      async state(id) {
        const p = people.get(id);
        return p ? { mustChange: p.mustChange === true, expiresAt: null, passwordHash: p.passwordHash, tokenVersion: p.tokenVersion, active: p.status === 'ACTIVE', cancelled: false } : null;
      },
      async complete(id, expected, newHash) {
        const p = people.get(id);
        if (!p || !p.mustChange || p.passwordHash !== expected) return false;
        Object.assign(p, { passwordHash: newHash, mustChange: false, tokenVersion: p.tokenVersion + 1 });
        return true;
      },
    },
  });
  const twoStep = createTwoStep({
    switchedOn,
    mailConfigured: () => mailOn,
    store: createMemoryTrustedBrowserStore(),
    key: 'trusted-browser-test-key-long-enough',
    notifyTrusted: async (user, info) => void notices.push({ to: user.email, browser: info.browser }),
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
    async modules() {
      return [];
    },
  };
  const userState = async (id: string) => {
    const p = people.get(id);
    return p ? { active: p.status === 'ACTIVE', tokenVersion: p.tokenVersion, roles: p.roles ?? [] } : null;
  };
  return buildApp({
    authService,
    tokenService,
    signInChallenges,
    emailVerification,
    otpService,
    firstPassword,
    twoStep,
    userState,
    websiteOrigin: 'https://tasks.acme.test',
    secureCookies: o.secureCookies ?? false,
    auditService: auditService as never,
  });
}

type App = Awaited<ReturnType<typeof makeApp>>;
const post = (app: App, url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as Record<string, unknown>, headers: { 'user-agent': CHROME, ...headers } });
const WEBSITE = { acceptChallenge: true, acceptPasswordChange: true };
const lastMail = () => mails[mails.length - 1]!;
/** An emailed sign-in code is made in the background (bcrypt): wait until it has gone. */
async function codeRequested(app: App, identifier: string) {
  const before = mails.length;
  await post(app, '/auth/otp/request', { identifier });
  for (let i = 0; i < 100 && mails.length === before; i++) await new Promise((r) => setTimeout(r, 20));
}
const actions = () => audit.filter((a) => a.module === 'auth').map((a) => a.action);

/** The trust cookie from a reply ("name=value"), or null. */
function trustCookie(res: { headers: Record<string, unknown> }): { pair: string; raw: string } | null {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []).find((c) => /mico_tb_/.test(c));
  if (!raw) return null;
  return { pair: raw.split(';')[0]!, raw };
}

/** Password → code → session on the website; `trust` ticks "Trust this browser". */
async function signInWithCode(app: App, id: string, trust: boolean, cookie?: string) {
  const first = await post(app, '/auth/login', { identifier: id, password: PW, ...WEBSITE }, cookie ? { cookie } : {});
  const challenge = first.json().data.challenge;
  const done = await post(app, '/auth/challenge/verify', { challenge: challenge.token, code: lastMail().code, acceptPasswordChange: true, trustBrowser: trust });
  return { first, challenge, done };
}

beforeEach(async () => {
  hash ??= await hashPassword(PW);
  tempHash ??= await hashPassword('Kite-Mango-Fern-Ripple-472');
  people = new Map();
  mails = [];
  notices = [];
  audit = [];
  signIns = [];
  switchedOn = true;
  mailOn = true;
  person('boss', { roles: ['ADMIN'] });
  person('emma', { roles: ['EMPLOYEE'] });
});

describe('the website: an administrator’s password, then a code', () => {
  it('the right password on an untrusted browser gives the code step — no session — and emails a TWO_STEP code', async () => {
    const app = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(body.user).toBeUndefined();
    expect(body.challenge).toMatchObject({ kind: 'TWO_STEP', sentTo: 'b•••@acme.com', codeSent: true, trustOffered: true });
    expect(mails).toEqual([{ to: 'boss@acme.com', code: expect.stringMatching(/^\d{6}$/), kind: 'TWO_STEP' }]);
    expect(signIns).toEqual([]);
    expect(actions()).toEqual(['auth.two_step.code_sent']);
    expect(audit[0]).toMatchObject({ userId: 'boss', entityId: 'boss' });
  });

  it('a wrong password is the usual answer (nothing says the account is an administrator)', async () => {
    const app = await makeApp();
    for (const extra of [WEBSITE, {}]) {
      const res = await post(app, '/auth/login', { identifier: 'boss', password: 'wrong-one-1', ...extra });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    }
    expect(mails).toEqual([]);
  });

  it('the right code signs in; ticked “Trust this browser” sets a 30-day httpOnly cookie, audits and emails a notice', async () => {
    const app = await makeApp();
    const { done } = await signInWithCode(app, 'boss', true);
    expect(done.statusCode).toBe(200);
    expect(done.json().data).toMatchObject({ user: { id: 'boss', roles: ['ADMIN'] }, accessToken: expect.any(String), refreshToken: expect.any(String) });
    const c = trustCookie(done)!;
    expect(c.raw).toMatch(/^mico_tb_[0-9a-f]{12}=[^;]+; Path=\/api\/v1\/auth; Max-Age=2592000; HttpOnly; SameSite=Strict$/);
    expect(signIns).toEqual(['boss']);
    expect(actions()).toEqual(['auth.two_step.code_sent', 'auth.two_step.passed', 'auth.two_step.browser_trusted']);
    expect(audit.find((a) => a.action === 'auth.two_step.browser_trusted')!.newValue).toEqual({ browser: 'Chrome on Windows' });
    expect(notices).toEqual([{ to: 'boss@acme.com', browser: 'Chrome on Windows' }]);
    expect(JSON.stringify(audit)).not.toContain(c.pair.split('=')[1]!);
  });

  it('a trusted browser skips the code (no email), for 30 days', async () => {
    const app = await makeApp();
    const { done } = await signInWithCode(app, 'boss', true);
    const cookie = trustCookie(done)!.pair;
    mails = [];
    const again = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE }, { cookie: `theme=dark; ${cookie}` });
    expect(again.statusCode).toBe(200);
    expect(again.json().data).toMatchObject({ user: { id: 'boss' }, accessToken: expect.any(String) });
    expect(mails).toEqual([]);
  });

  it('unticked: no cookie, and the next sign-in asks again', async () => {
    const app = await makeApp();
    const { done } = await signInWithCode(app, 'boss', false);
    expect(done.statusCode).toBe(200);
    expect(trustCookie(done)).toBeNull();
    expect(notices).toEqual([]);
    expect(actions()).not.toContain('auth.two_step.browser_trusted');
    const again = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE });
    expect(again.json().data.challenge).toMatchObject({ kind: 'TWO_STEP' });
  });

  it('after a password change or Sign out everywhere (the session version moved on) the code is asked again', async () => {
    const app = await makeApp();
    const cookie = trustCookie((await signInWithCode(app, 'boss', true)).done)!.pair;
    people.get('boss')!.tokenVersion += 1;
    const again = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE }, { cookie });
    expect(again.json().data.challenge).toMatchObject({ kind: 'TWO_STEP' });
  });

  it('another administrator’s cookie on this browser doesn’t count for this one', async () => {
    person('ceo', { roles: ['ADMIN'] });
    const app = await makeApp();
    const cookie = trustCookie((await signInWithCode(app, 'boss', true)).done)!.pair;
    const other = await post(app, '/auth/login', { identifier: 'ceo', password: PW, ...WEBSITE }, { cookie });
    expect(other.json().data.challenge).toMatchObject({ kind: 'TWO_STEP' });
  });

  it('5 wrong codes end the step (each audited, then “too many”); even the right code is refused after that', async () => {
    const app = await makeApp();
    const { challenge } = (await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE })).json().data;
    const right = lastMail().code;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await post(app, '/auth/challenge/verify', { challenge: challenge.token, code: wrong });
      expect(r.json().error.code).toBe('WRONG_CODE');
    }
    const last = await post(app, '/auth/challenge/verify', { challenge: challenge.token, code: right, trustBrowser: true });
    expect(last.statusCode).toBe(429);
    expect(last.json().error.code).toBe('TOO_MANY_WRONG_CODES');
    expect(trustCookie(last)).toBeNull();
    const failed = audit.filter((a) => a.action === 'auth.two_step.failed');
    expect(failed.map((a) => a.newValue)).toEqual([...Array.from({ length: 5 }, () => ({ reason: 'wrong-code' })), { reason: 'too-many-wrong-codes' }]);
    expect(failed.every((a) => a.userId === 'boss' && a.entityId === 'boss')).toBe(true);
    expect(signIns).toEqual([]);
  });

  it('“Send another code” audits the new code it sends', async () => {
    const app = await makeApp();
    const { challenge } = (await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE })).json().data;
    const soon = await post(app, '/auth/challenge/resend', { challenge: challenge.token });
    expect(soon.json().data.codeSent).toBe(false);
    expect(actions()).toEqual(['auth.two_step.code_sent']);
  });

  it('an employee is never asked (website or app), and never gets a trust cookie', async () => {
    const app = await makeApp();
    for (const extra of [WEBSITE, {}]) {
      const res = await post(app, '/auth/login', { identifier: 'emma', password: PW, ...extra });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ user: { id: 'emma' }, accessToken: expect.any(String) });
    }
    expect(mails).toEqual([]);
    expect(actions()).toEqual([]);
  });

  it('an administrator whose email isn’t confirmed yet gets ONE code (the confirmation counts as the second step) and may trust the browser', async () => {
    people.get('boss')!.emailVerifiedAt = null;
    const app = await makeApp();
    const first = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE });
    expect(first.json().data.challenge).toMatchObject({ kind: 'VERIFY_EMAIL', trustOffered: true });
    const done = await post(app, '/auth/challenge/verify', { challenge: first.json().data.challenge.token, code: lastMail().code, trustBrowser: true });
    expect(done.statusCode).toBe(200);
    expect(mails).toHaveLength(1);
    expect(trustCookie(done)).not.toBeNull();
    expect(people.get('boss')!.emailVerifiedAt).not.toBeNull();
  });

  it('an employee’s email confirmation offers no trust tick-box and sets no cookie', async () => {
    people.get('emma')!.emailVerifiedAt = null;
    const app = await makeApp();
    const first = await post(app, '/auth/login', { identifier: 'emma', password: PW, ...WEBSITE });
    expect(first.json().data.challenge.trustOffered).toBe(false);
    const done = await post(app, '/auth/challenge/verify', { challenge: first.json().data.challenge.token, code: lastMail().code, trustBrowser: true });
    expect(done.statusCode).toBe(200);
    expect(trustCookie(done)).toBeNull();
  });

  it('over https (or in production) the cookie is Secure and __Secure- prefixed, and read under that name', async () => {
    const app = await makeApp({ secureCookies: true });
    const { done } = await signInWithCode(app, 'boss', true);
    const c = trustCookie(done)!;
    expect(c.raw).toMatch(/^__Secure-mico_tb_[0-9a-f]{12}=[^;]+; Path=\/api\/v1\/auth; Max-Age=2592000; HttpOnly; SameSite=Strict; Secure$/);
    mails = [];
    const again = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE }, { cookie: c.pair });
    expect(again.json().data.accessToken).toEqual(expect.any(String));
    // The same value without its prefix (a page on plain http could plant that) doesn't count.
    const bare = c.pair.replace('__Secure-', '');
    const planted = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE }, { cookie: bare });
    expect(planted.json().data.challenge).toBeDefined();
  });
});

describe('a temporary password: the code first, then “Choose your own password”', () => {
  it('the trust ticked at the code waits for the new password (made under the new session version)', async () => {
    person('newboss', { roles: ['ADMIN'], passwordHash: tempHash, mustChange: true });
    const app = await makeApp();
    const first = await post(app, '/auth/login', { identifier: 'newboss', password: 'Kite-Mango-Fern-Ripple-472', ...WEBSITE });
    const { challenge } = first.json().data;
    expect(challenge.kind).toBe('TWO_STEP');
    const step = await post(app, '/auth/challenge/verify', { challenge: challenge.token, code: lastMail().code, acceptPasswordChange: true, trustBrowser: true });
    expect(step.json().data.changePassword).toBeDefined();
    expect(trustCookie(step)).toBeNull();
    const done = await post(app, '/auth/password/first-change', { ticket: step.json().data.changePassword.ticket, password: 'MyOwnPass99', trustBrowser: true });
    expect(done.statusCode).toBe(200);
    const cookie = trustCookie(done)!.pair;
    mails = [];
    const again = await post(app, '/auth/login', { identifier: 'newboss', password: 'MyOwnPass99', ...WEBSITE }, { cookie });
    expect(again.json().data.accessToken).toEqual(expect.any(String));
    expect(mails).toEqual([]);
  });

  it('an employee’s first change sets no trust cookie', async () => {
    person('newbie', { roles: ['EMPLOYEE'], passwordHash: tempHash, mustChange: true });
    const app = await makeApp();
    const step = await post(app, '/auth/login', { identifier: 'newbie', password: 'Kite-Mango-Fern-Ripple-472', ...WEBSITE });
    const done = await post(app, '/auth/password/first-change', { ticket: step.json().data.changePassword.ticket, password: 'MyOwnPass99', trustBrowser: true });
    expect(done.statusCode).toBe(200);
    expect(trustCookie(done)).toBeNull();
  });
});

describe('the Android app and the extension (they never send acceptChallenge): website only for administrators', () => {
  it('an administrator’s right password is refused with plain words (403 ADMIN_WEBSITE_ONLY), audited; an employee signs in as today', async () => {
    const app = await makeApp();
    const admin = await post(app, '/auth/login', { identifier: 'boss', password: PW });
    expect(admin.statusCode).toBe(403);
    expect(admin.json().error).toEqual({ code: 'ADMIN_WEBSITE_ONLY', message: 'Admins sign in on the website (two-step sign-in).' });
    expect(mails).toEqual([]);
    expect(signIns).toEqual([]);
    expect(audit).toContainEqual(expect.objectContaining({ module: 'auth', action: 'auth.two_step.app_refused', userId: 'boss', newValue: { via: 'password' } }));
    const staff = await post(app, '/auth/login', { identifier: 'emma', password: PW });
    expect(staff.statusCode).toBe(200);
    expect(staff.json().data).toMatchObject({ user: { id: 'emma' }, accessToken: expect.any(String), refreshToken: expect.any(String) });
  });

  it('a trusted browser’s cookie doesn’t open the app either', async () => {
    const app = await makeApp();
    const cookie = trustCookie((await signInWithCode(app, 'boss', true)).done)!.pair;
    const res = await post(app, '/auth/login', { identifier: 'boss', password: PW }, { cookie });
    expect(res.json().error.code).toBe('ADMIN_WEBSITE_ONLY');
  });

  it('renewal: an administrator without the website’s flag is refused (401 ADMIN_WEBSITE_ONLY, audited) and that session is over', async () => {
    const app = await makeApp();
    const web = (await signInWithCode(app, 'boss', false)).done.json().data;
    const refused = await post(app, '/auth/refresh', { refreshToken: web.refreshToken });
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error).toEqual({ code: 'ADMIN_WEBSITE_ONLY', message: 'Admins sign in on the website (two-step sign-in).' });
    expect(audit).toContainEqual(expect.objectContaining({ action: 'auth.two_step.app_refused', userId: 'boss', newValue: { via: 'refresh' } }));
    // Over: the website's flag can't bring the spent token back.
    const after = await post(app, '/auth/refresh', { refreshToken: web.refreshToken, acceptChallenge: true });
    expect(after.statusCode).toBe(401);
  });

  it('renewal: the website (its flag, or a page still on the old version at the site’s own address) renews an administrator’s session', async () => {
    const app = await makeApp();
    const web = (await signInWithCode(app, 'boss', false)).done.json().data;
    const flagged = await post(app, '/auth/refresh', { refreshToken: web.refreshToken, acceptChallenge: true });
    expect(flagged.statusCode).toBe(200);
    const oldPage = await post(app, '/auth/refresh', { refreshToken: flagged.json().data.refreshToken }, { origin: 'https://tasks.acme.test' });
    expect(oldPage.statusCode).toBe(200);
    // An extension's own address is not the website's.
    const ext = await post(app, '/auth/refresh', { refreshToken: oldPage.json().data.refreshToken }, { origin: 'chrome-extension://abcdefghijklmnop' });
    expect(ext.statusCode).toBe(401);
    expect(ext.json().error.code).toBe('ADMIN_WEBSITE_ONLY');
  });

  it('renewal: an employee’s app session renews as today (no flag needed)', async () => {
    const app = await makeApp();
    const s = (await post(app, '/auth/login', { identifier: 'emma', password: PW })).json().data;
    const res = await post(app, '/auth/refresh', { refreshToken: s.refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.id).toBe('emma');
  });

  it('fingerprint sign-in on the phone is refused for an administrator (403), works for an employee', async () => {
    const app = await makeApp();
    // A key an employee made on the phone works.
    const emma = (await post(app, '/auth/login', { identifier: 'emma', password: PW })).json().data;
    const key = (await post(app, '/auth/biometric-credential', { refreshToken: emma.refreshToken })).json().data.refreshToken;
    expect((await post(app, '/auth/biometric-sign-in', { credential: key })).statusCode).toBe(200);
    // An administrator's (made on the website's session: the API allows it) is refused.
    const web = (await signInWithCode(app, 'boss', false)).done.json().data;
    const bossKey = (await post(app, '/auth/biometric-credential', { refreshToken: web.refreshToken })).json().data.refreshToken;
    const refused = await post(app, '/auth/biometric-sign-in', { credential: bossKey });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('ADMIN_WEBSITE_ONLY');
    expect(audit).toContainEqual(expect.objectContaining({ action: 'auth.two_step.app_refused', userId: 'boss', newValue: { via: 'fingerprint' } }));
  });
});

describe('“Sign in with an emailed code” (no password) for administrators', () => {
  it('is refused after the right code with plain words (403 ADMIN_PASSWORD_AND_CODE), audited; a wrong code says nothing more', async () => {
    const app = await makeApp();
    await codeRequested(app, 'boss');
    const right = lastMail().code;
    const wrong = await post(app, '/auth/otp/verify', { identifier: 'boss', code: right === '000000' ? '111111' : '000000' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('INVALID_OTP');
    const res = await post(app, '/auth/otp/verify', { identifier: 'boss', code: right, acceptPasswordChange: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({ code: 'ADMIN_PASSWORD_AND_CODE', message: 'Admins sign in with their password and a code.' });
    expect(res.json().data).toBeUndefined();
    expect(signIns).toEqual([]);
    expect(audit).toContainEqual(expect.objectContaining({ action: 'auth.two_step.code_only_refused', userId: 'boss' }));
  });

  it('an employee still signs in with an emailed code', async () => {
    const app = await makeApp();
    await codeRequested(app, 'emma');
    const res = await post(app, '/auth/otp/verify', { identifier: 'emma', code: lastMail().code });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.id).toBe('emma');
  });
});

describe('break-glass: ADMIN_TWO_STEP=off (or no mail provider at all)', () => {
  it('switched off: administrators sign in with the password alone, on the website, the app and the extension; renewals need no flag', async () => {
    switchedOn = false;
    const app = await makeApp();
    for (const extra of [WEBSITE, {}]) {
      const res = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...extra });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.accessToken).toEqual(expect.any(String));
    }
    const s = (await post(app, '/auth/login', { identifier: 'boss', password: PW })).json().data;
    expect((await post(app, '/auth/refresh', { refreshToken: s.refreshToken })).statusCode).toBe(200);
    expect(mails).toEqual([]);
  });

  it('switched back on: asked again at once', async () => {
    switchedOn = false;
    await makeApp();
    switchedOn = true;
    const app = await makeApp();
    expect((await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE })).json().data.challenge).toBeDefined();
  });

  it('no mail provider: no code can go, so the password alone signs in (said on the banner)', async () => {
    mailOn = false;
    const app = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE });
    expect(res.json().data.accessToken).toEqual(expect.any(String));
  });
});

describe('Settings → Security: GET /auth/two-step and Forget all trusted browsers', () => {
  async function signedInAdmin(app: App) {
    const { done } = await signInWithCode(app, 'boss', true);
    return { session: done.json().data, cookie: trustCookie(done)!.pair };
  }
  const get = (app: App, token: string, cookie?: string) =>
    app.inject({ method: 'GET', url: '/api/v1/auth/two-step', headers: { authorization: `Bearer ${token}`, ...(cookie ? { cookie } : {}) } });

  it('an administrator sees it on, the trusted browsers’ count, and until when this browser is trusted', async () => {
    const app = await makeApp();
    const { session, cookie } = await signedInAdmin(app);
    await signInWithCode(app, 'boss', true);
    const res = await get(app, session.accessToken, cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ on: true, reason: null, trustedBrowsers: 2, thisBrowserTrustedUntil: expect.any(String) });
    const without = await get(app, session.accessToken);
    expect(without.json().data.thisBrowserTrustedUntil).toBeNull();
  });

  it('says why it is off (for the red banner)', async () => {
    switchedOn = false;
    const app = await makeApp();
    const s = (await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE })).json().data;
    expect((await get(app, s.accessToken)).json().data).toEqual({ on: false, reason: 'switched-off', trustedBrowsers: 0, thisBrowserTrustedUntil: null });
  });

  it('is for administrators only (an employee is refused; no sign-in: 401)', async () => {
    const app = await makeApp();
    const emma = (await post(app, '/auth/login', { identifier: 'emma', password: PW })).json().data;
    expect((await get(app, emma.accessToken)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/two-step' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/two-step/forget', headers: { authorization: `Bearer ${emma.accessToken}` } })).statusCode).toBe(403);
  });

  it('Forget all trusted browsers: every one asks again, this page stays signed in, the cookie is cleared, audited', async () => {
    const app = await makeApp();
    const { session, cookie } = await signedInAdmin(app);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/two-step/forget', headers: { authorization: `Bearer ${session.accessToken}`, cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ forgotten: 1 });
    expect(trustCookie(res)!.raw).toMatch(/^mico_tb_[0-9a-f]{12}=; Path=\/api\/v1\/auth; Max-Age=0; HttpOnly; SameSite=Strict$/);
    expect(audit).toContainEqual(expect.objectContaining({ module: 'auth', action: 'auth.two_step.browsers_forgotten', userId: 'boss', newValue: { count: 1 } }));
    // This page's session still works.
    expect((await get(app, session.accessToken)).json().data.trustedBrowsers).toBe(0);
    // The old cookie no longer skips the code.
    const again = await post(app, '/auth/login', { identifier: 'boss', password: PW, ...WEBSITE }, { cookie });
    expect(again.json().data.challenge).toBeDefined();
  });
});
