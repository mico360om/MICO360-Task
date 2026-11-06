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
import { hashPassword } from '../../lib/password';
import type { AuthUser, AuthUserRepository } from './user-repository';

/**
 * Onboarding: the sign-in challenge on the HTTP side. The website says it can take the code step
 * (acceptChallenge); anything else (the Android app, the extension) is refused with plain words.
 */
type Person = AuthUser & { emailVerifiedAt: Date | null; activatedAt: Date | null };
let people: Map<string, Person>;
let mailOn: boolean;
let mails: { to: string; code: string }[];
let audit: { action: string; entityId?: string | null; newValue?: unknown; userId?: string | null }[];
let signIns: string[];
let logs: unknown[];
let hash: string;

function person(id: string, o: Partial<Person> = {}): Person {
  const p: Person = {
    id,
    email: `${id}@oxy.com`,
    username: id,
    passwordHash: hash,
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    roles: ['EMPLOYEE'],
    emailVerifiedAt: null,
    activatedAt: null,
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
  const logger = { info: (...a: unknown[]) => void logs.push(a), warn: (...a: unknown[]) => void logs.push(a), error: (...a: unknown[]) => void logs.push(a), debug: () => {} };
  const store = createMemorySignInChallengeStore();
  const signInChallenges = createSignInChallenges({
    store,
    key: 'route-test-key',
    logger,
    mailer: { isConfigured: () => mailOn, async sendSignInCode(to, code) { mails.push({ to, code }); } },
  });
  const emailVerification = createEmailVerification({
    mailConfigured: () => mailOn,
    audit: { record: async (e) => void audit.push(e) },
    repo: {
      async find(id) {
        const p = people.get(id);
        return p ? ({ id: p.id, email: p.email, emailVerifiedAt: p.emailVerifiedAt, roles: p.roles ?? [], status: p.status } satisfies VerificationPerson) : null;
      },
      async otherVerifiedAdmins(id) {
        return [...people.values()].filter((p) => p.id !== id && p.status === 'ACTIVE' && p.roles?.includes('ADMIN') && p.emailVerifiedAt).length;
      },
      async markVerified(id, at, email) {
        const p = people.get(id);
        if (!p || p.emailVerifiedAt || (email && p.email.toLowerCase() !== email.toLowerCase())) return false;
        p.emailVerifiedAt = at;
        p.activatedAt ??= at;
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
  const authService = createAuthService({ users: authUsers(), maxAttempts: 5 });
  const tokenService = createTokenService({
    accessSecret: 'access-secret-long-enough',
    refreshSecret: 'refresh-secret-long-enough',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: createMemoryRefreshTokenStore(),
  });
  const app = await buildApp({ authService, tokenService, signInChallenges, emailVerification, otpService, logger: logger as never });
  return { app, store };
}

const post = (app: Awaited<ReturnType<typeof makeApp>>['app'], url: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/v1${url}`, payload: payload as Record<string, unknown> });
const lastCode = () => mails[mails.length - 1]!.code;

beforeEach(async () => {
  hash ??= await hashPassword('CorrectHorse1');
  people = new Map();
  mailOn = true;
  mails = [];
  audit = [];
  signIns = [];
  logs = [];
  person('boss', { roles: ['ADMIN'], emailVerifiedAt: new Date('2026-10-01T00:00:00Z') });
});

describe('POST /auth/login with an unconfirmed email address', () => {
  it('the website (acceptChallenge) gets a challenge — no session — and the code is emailed', async () => {
    person('ann');
    const { app } = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'ann', password: 'CorrectHorse1', acceptChallenge: true });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(body.challenge).toMatchObject({ kind: 'VERIFY_EMAIL', sentTo: 'a•••@oxy.com', codeSent: true });
    expect(typeof body.challenge.token).toBe('string');
    expect(mails).toEqual([{ to: 'ann@oxy.com', code: expect.stringMatching(/^\d{6}$/) }]);
    expect(signIns).toEqual([]);
  });

  it('anything else (the app, the extension) is refused with plain words: 403 EMAIL_NOT_VERIFIED', async () => {
    person('ann');
    const { app } = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'ann', password: 'CorrectHorse1' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toEqual({ code: 'EMAIL_NOT_VERIFIED', message: 'Confirm your email on the website first: sign in there and enter the 6-digit code we email you.' });
    expect(mails).toEqual([]);
  });

  it('a wrong password says nothing about verification (401 as always)', async () => {
    person('ann');
    const { app } = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'ann', password: 'wrong-one-1', acceptChallenge: true });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(mails).toEqual([]);
  });

  it('a confirmed (or grandfathered) account signs in as before, with or without acceptChallenge', async () => {
    person('bo', { emailVerifiedAt: new Date('2026-09-01T00:00:00Z') });
    const { app } = await makeApp();
    for (const extra of [{}, { acceptChallenge: true }]) {
      const res = await post(app, '/auth/login', { identifier: 'bo', password: 'CorrectHorse1', ...extra });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json().data.accessToken).toBe('string');
    }
    expect(mails).toEqual([]);
  });

  it('with no mail settings nothing is asked: the temporary password signs in as today', async () => {
    person('ann');
    mailOn = false;
    const { app } = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'ann', password: 'CorrectHorse1' });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().data.accessToken).toBe('string');
  });

  it('the last active administrator is never put through the code step', async () => {
    people.delete('boss');
    person('solo', { roles: ['ADMIN'] });
    const { app } = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'solo', password: 'CorrectHorse1' });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().data.accessToken).toBe('string');
  });

  it('a client account is asked too (before the portal)', async () => {
    person('cli', { roles: ['CLIENT'] });
    const { app } = await makeApp();
    const res = await post(app, '/auth/login', { identifier: 'cli', password: 'CorrectHorse1', acceptChallenge: true });
    expect(res.json().data.challenge.kind).toBe('VERIFY_EMAIL');
  });
});

describe('POST /auth/challenge/verify and /auth/challenge/resend', () => {
  async function challenged(id = 'ann') {
    const made = await makeApp();
    const res = await post(made.app, '/auth/login', { identifier: id, password: 'CorrectHorse1', acceptChallenge: true });
    return { ...made, token: res.json().data.challenge.token as string };
  }

  it('the right code gives the session (same shape as sign-in), confirms the address and records the sign-in', async () => {
    person('ann');
    const { app, token } = await challenged();
    const res = await post(app, '/auth/challenge/verify', { challenge: token, code: lastCode() });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.user).toEqual({ id: 'ann', email: 'ann@oxy.com', username: 'ann', roles: ['EMPLOYEE'], avatarUrl: null });
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(people.get('ann')!.emailVerifiedAt).toBeInstanceOf(Date);
    expect(signIns).toEqual(['ann']);
    expect(audit).toEqual([expect.objectContaining({ action: 'user.email.verified', entityId: 'ann', userId: 'ann', newValue: { how: 'code', email: 'ann@oxy.com' } })]);
    // The next sign-in needs no code.
    const again = await post(app, '/auth/login', { identifier: 'ann', password: 'CorrectHorse1' });
    expect(again.statusCode).toBe(200);
  });

  it('a wrong code: 401 WRONG_CODE, no session, nothing confirmed', async () => {
    person('ann');
    const { app, token } = await challenged();
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    const res = await post(app, '/auth/challenge/verify', { challenge: token, code: wrong });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('WRONG_CODE');
    expect(people.get('ann')!.emailVerifiedAt).toBeNull();
  });

  it('deactivated between the two steps: refused (403 ACCOUNT_INACTIVE), nothing confirmed', async () => {
    person('ann');
    const { app, token } = await challenged();
    people.get('ann')!.status = 'INACTIVE';
    const res = await post(app, '/auth/challenge/verify', { challenge: token, code: lastCode() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCOUNT_INACTIVE');
    expect(people.get('ann')!.emailVerifiedAt).toBeNull();
  });

  it('the email changed between the two steps: the code no longer counts (401 SIGN_IN_EXPIRED)', async () => {
    person('ann');
    const { app, token } = await challenged();
    people.get('ann')!.email = 'ann@elsewhere.com';
    const res = await post(app, '/auth/challenge/verify', { challenge: token, code: lastCode() });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('SIGN_IN_EXPIRED');
    expect(people.get('ann')!.emailVerifiedAt).toBeNull();
  });

  it('resend within the minute sends nothing and says how long to wait', async () => {
    person('ann');
    const { app, token } = await challenged();
    const res = await post(app, '/auth/challenge/resend', { challenge: token });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ codeSent: false });
    expect(res.json().data.retryAfterSeconds).toBeGreaterThan(0);
    expect(mails).toHaveLength(1);
  });

  it('an unknown challenge: 401 SIGN_IN_EXPIRED for verify and resend', async () => {
    const { app } = await makeApp();
    expect((await post(app, '/auth/challenge/verify', { challenge: 'x'.repeat(43), code: '123456' })).json().error.code).toBe('SIGN_IN_EXPIRED');
    expect((await post(app, '/auth/challenge/resend', { challenge: 'x'.repeat(43) })).json().error.code).toBe('SIGN_IN_EXPIRED');
  });

  it('lengths are checked: an overlong token or code is 400', async () => {
    const { app } = await makeApp();
    expect((await post(app, '/auth/challenge/verify', { challenge: 'x'.repeat(201), code: '123456' })).statusCode).toBe(400);
    expect((await post(app, '/auth/challenge/verify', { challenge: 'x'.repeat(43), code: '1'.repeat(21) })).statusCode).toBe(400);
    expect((await post(app, '/auth/challenge/resend', { challenge: '' })).statusCode).toBe(400);
  });

  it('codes and tokens are never logged', async () => {
    person('ann');
    mailOn = true;
    const { app, token } = await challenged();
    const wrong = lastCode() === '000000' ? '111111' : '000000';
    await post(app, '/auth/challenge/verify', { challenge: token, code: wrong });
    await post(app, '/auth/challenge/verify', { challenge: token, code: lastCode() });
    const text = JSON.stringify(logs);
    expect(text).not.toContain(lastCode());
    expect(text).not.toContain(token);
  });
});

describe('The email-code sign-in (website and app) confirms the address', () => {
  it('signing in with an emailed code sets emailVerifiedAt (audited as a sign-in code)', async () => {
    person('ann');
    const { app } = await makeApp();
    await post(app, '/auth/otp/request', { identifier: 'ann' });
    await new Promise((r) => setTimeout(r, 300)); // bcrypt in the background
    const res = await post(app, '/auth/otp/verify', { identifier: 'ann', code: lastCode() });
    expect(res.statusCode).toBe(200);
    expect(people.get('ann')!.emailVerifiedAt).toBeInstanceOf(Date);
    expect(audit[0]).toMatchObject({ action: 'user.email.verified', entityId: 'ann', newValue: { how: 'sign-in code' } });
    // …so the password works on the app afterwards.
    expect((await post(app, '/auth/login', { identifier: 'ann', password: 'CorrectHorse1' })).statusCode).toBe(200);
  });
});
