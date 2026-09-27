import { describe, it, expect } from 'vitest';
import { createOtpService, type OtpUser } from './otp-service';
import { createMemoryOtpStore } from './memory-otp-store';
import { EmailUnavailableError, InvalidOtpError, OtpExpiredError, TooManyOtpAttemptsError } from './errors';
import { verifyOtp } from '../../lib/otp';

const ADA: OtpUser = { id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['EMPLOYEE'], avatarUrl: null, tokenVersion: 0 };

function makeHarness(
  opts: { user?: OtpUser | null; ttl?: number; maxAttempts?: number; configured?: boolean; failSend?: boolean; maxFailuresPerHour?: number } = {},
) {
  const user = opts.user === undefined ? ADA : opts.user;
  let clock = new Date('2026-09-26T08:00:00.000Z').getTime();
  const now = () => new Date(clock);
  const store = createMemoryOtpStore(now);
  const emails: { email: string; code: string }[] = [];
  const warnings: string[] = [];
  const cleared: string[] = [];
  const pending: Promise<void>[] = [];

  const svc = createOtpService({
    ttlSeconds: opts.ttl ?? 600,
    otpLength: 6,
    maxAttempts: opts.maxAttempts ?? 3,
    maxFailuresPerHour: opts.maxFailuresPerHour,
    users: {
      async findActiveByIdentifier() {
        return user;
      },
      async clearLock(userId) {
        cleared.push(userId);
      },
    },
    otps: store,
    mailer: {
      async sendLoginCode(email, code) {
        if (opts.failSend) throw new Error('mailjet 500');
        emails.push({ email, code });
      },
      isConfigured: () => opts.configured ?? true,
    },
    runInBackground: (task) => {
      pending.push(task().catch((err) => void warnings.push(String(err))));
    },
    logger: { warn: (msg) => void warnings.push(msg) },
    now,
  });

  const flush = async () => {
    await Promise.all(pending.splice(0));
  };
  return { svc, store, emails, warnings, cleared, flush, advance: (ms: number) => (clock += ms) };
}

describe('OtpService.requestLoginOtp', () => {
  it('stores a hashed code and emails the plaintext code to an active user', async () => {
    const { svc, store, emails, flush } = makeHarness();
    const res = await svc.requestLoginOtp('ada');
    await flush();
    expect(res.sent).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(store.rows[0]!.codeHash).not.toBe(emails[0]!.code);
    expect(await verifyOtp(emails[0]!.code, store.rows[0]!.codeHash)).toBe(true);
  });

  it('does not reveal whether the account exists (no store/email, still sent:true)', async () => {
    const { svc, store, emails, flush } = makeHarness({ user: null });
    const res = await svc.requestLoginOtp('ghost');
    await flush();
    expect(res.sent).toBe(true);
    expect(store.rows).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('answers 503 EMAIL_NOT_CONFIGURED for every identifier when email is not configured', async () => {
    await expect(makeHarness({ configured: false }).svc.requestLoginOtp('ada')).rejects.toBeInstanceOf(EmailUnavailableError);
    await expect(makeHarness({ configured: false, user: null }).svc.requestLoginOtp('ghost')).rejects.toBeInstanceOf(EmailUnavailableError);
  });

  it('logs a delivery failure but keeps the generic answer', async () => {
    const { svc, flush, warnings } = makeHarness({ failSend: true });
    await expect(svc.requestLoginOtp('ada')).resolves.toEqual({ sent: true });
    await flush();
    expect(warnings.join(' ')).toMatch(/mailjet 500/);
  });

  it('throttles code requests per account (1 a minute, 5 an hour)', async () => {
    const h = makeHarness();
    await h.svc.requestLoginOtp('ada');
    await h.svc.requestLoginOtp('ada'); // same minute: silently dropped
    await h.flush();
    expect(h.emails).toHaveLength(1);
    for (let i = 0; i < 6; i++) {
      h.advance(61_000);
      await h.svc.requestLoginOtp('ada');
      await h.flush();
    }
    expect(h.emails).toHaveLength(5); // hourly cap
    expect(h.warnings.some((w) => /throttled/.test(w))).toBe(true);
  });

  it('invalidates the previous code when a new one is issued', async () => {
    const h = makeHarness();
    await h.svc.requestLoginOtp('ada');
    await h.flush();
    const firstCode = h.emails[0]!.code;
    h.advance(61_000);
    await h.svc.requestLoginOtp('ada');
    await h.flush();
    const secondCode = h.emails[1]!.code;
    if (firstCode !== secondCode) await expect(h.svc.verifyLoginOtp('ada', firstCode)).rejects.toBeInstanceOf(InvalidOtpError);
    await expect(h.svc.verifyLoginOtp('ada', secondCode)).resolves.toMatchObject({ id: 'u1' });
  });
});

describe('OtpService.verifyLoginOtp', () => {
  async function setup(overrides: Parameters<typeof makeHarness>[0] = {}) {
    const h = makeHarness(overrides);
    await h.svc.requestLoginOtp('ada');
    await h.flush();
    return { ...h, code: h.emails[0]!.code };
  }
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

  it('authenticates with the correct code, consumes the OTP, returns the full user and clears the lock', async () => {
    const { svc, store, code, cleared } = await setup();
    const user = await svc.verifyLoginOtp('ada', code);
    expect(user).toMatchObject({ id: 'u1', username: 'ada', avatarUrl: null });
    expect(store.rows[0]!.consumedAt).not.toBeNull();
    expect(cleared).toEqual(['u1']);
  });

  it('rejects an incorrect code and increments attempts', async () => {
    const { svc, store, code } = await setup();
    await expect(svc.verifyLoginOtp('ada', wrong(code))).rejects.toBeInstanceOf(InvalidOtpError);
    expect(store.rows[0]!.attempts).toBe(1);
  });

  it('rejects an expired code', async () => {
    const { svc, code } = await setup({ ttl: -1 });
    await expect(svc.verifyLoginOtp('ada', code)).rejects.toBeInstanceOf(OtpExpiredError);
  });

  it('rejects after too many attempts', async () => {
    const { svc, store, code } = await setup({ maxAttempts: 2 });
    store.rows[0]!.attempts = 2;
    await expect(svc.verifyLoginOtp('ada', code)).rejects.toBeInstanceOf(TooManyOtpAttemptsError);
  });

  it('counts parallel guesses atomically, so no more than maxAttempts are ever compared', async () => {
    const { svc, store, code } = await setup({ maxAttempts: 3 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => svc.verifyLoginOtp('ada', wrong(code))));
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof InvalidOtpError)).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof TooManyOtpAttemptsError)).toHaveLength(5);
    expect(store.rows[0]!.attempts).toBe(3);
  });

  it('caps failures per account across codes — requesting a new code does not reset the count', async () => {
    const h = makeHarness({ maxAttempts: 3, maxFailuresPerHour: 5 });
    for (let i = 0; i < 2; i++) {
      await h.svc.requestLoginOtp('ada');
      await h.flush();
      const code = h.emails.at(-1)!.code;
      for (let g = 0; g < 3; g++) await h.svc.verifyLoginOtp('ada', wrong(code)).catch(() => {});
      h.advance(61_000);
    }
    await h.svc.requestLoginOtp('ada');
    await h.flush();
    await expect(h.svc.verifyLoginOtp('ada', h.emails.at(-1)!.code)).rejects.toBeInstanceOf(TooManyOtpAttemptsError);
  });

  it('a code can only be used once', async () => {
    const { svc, code } = await setup();
    await svc.verifyLoginOtp('ada', code);
    await expect(svc.verifyLoginOtp('ada', code)).rejects.toBeInstanceOf(InvalidOtpError);
  });

  it('rejects an unknown account with the same error', async () => {
    const { svc } = makeHarness({ user: null });
    await expect(svc.verifyLoginOtp('ghost', '123456')).rejects.toBeInstanceOf(InvalidOtpError);
  });
});
