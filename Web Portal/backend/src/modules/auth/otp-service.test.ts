import { describe, it, expect } from 'vitest';
import { createOtpService } from './otp-service';
import { InvalidOtpError, OtpExpiredError, TooManyOtpAttemptsError } from './errors';
import { verifyOtp } from '../../lib/otp';

interface StoredOtp {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

function makeHarness(opts: { user?: { id: string; email: string; roles: string[] } | null; ttl?: number; maxAttempts?: number } = {}) {
  const user = opts.user === undefined ? { id: 'u1', email: 'ada@mico360.test', roles: ['EMPLOYEE'] } : opts.user;
  const store: StoredOtp[] = [];
  const emails: { email: string; code: string }[] = [];
  let seq = 0;

  const svc = createOtpService({
    ttlSeconds: opts.ttl ?? 600,
    otpLength: 6,
    maxAttempts: opts.maxAttempts ?? 3,
    users: {
      async findActiveByIdentifier() {
        return user;
      },
    },
    otps: {
      async create(data) {
        store.push({ id: `otp${seq++}`, consumedAt: null, ...data });
      },
      async findActiveForUser(userId) {
        return store.find((o) => o.userId === userId && o.consumedAt === null) ?? null;
      },
      async incrementAttempts(id) {
        store.find((x) => x.id === id)!.attempts += 1;
      },
      async consume(id) {
        store.find((x) => x.id === id)!.consumedAt = new Date();
      },
    },
    mailer: {
      async sendLoginCode(email, code) {
        emails.push({ email, code });
      },
    },
  });

  return { svc, store, emails };
}

describe('OtpService.requestLoginOtp', () => {
  it('stores a hashed code and emails the plaintext code to an active user', async () => {
    const { svc, store, emails } = makeHarness();
    const res = await svc.requestLoginOtp('ada');
    expect(res.sent).toBe(true);
    expect(store).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(store[0]!.codeHash).not.toBe(emails[0]!.code);
    expect(await verifyOtp(emails[0]!.code, store[0]!.codeHash)).toBe(true);
  });

  it('does not reveal whether the account exists (no store/email, still sent:true)', async () => {
    const { svc, store, emails } = makeHarness({ user: null });
    const res = await svc.requestLoginOtp('ghost');
    expect(res.sent).toBe(true);
    expect(store).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });
});

describe('OtpService.verifyLoginOtp', () => {
  async function setup(overrides: { ttl?: number; maxAttempts?: number } = {}) {
    const h = makeHarness(overrides);
    await h.svc.requestLoginOtp('ada');
    return { ...h, code: h.emails[0]!.code };
  }

  it('authenticates with the correct code and consumes the OTP', async () => {
    const { svc, store, code } = await setup();
    const user = await svc.verifyLoginOtp('ada', code);
    expect(user.id).toBe('u1');
    expect(store[0]!.consumedAt).not.toBeNull();
  });

  it('rejects an incorrect code and increments attempts', async () => {
    const { svc, store } = await setup();
    await expect(svc.verifyLoginOtp('ada', '000000')).rejects.toBeInstanceOf(InvalidOtpError);
    expect(store[0]!.attempts).toBe(1);
  });

  it('rejects an expired code', async () => {
    const { svc, code } = await setup({ ttl: -1 });
    await expect(svc.verifyLoginOtp('ada', code)).rejects.toBeInstanceOf(OtpExpiredError);
  });

  it('rejects after too many attempts', async () => {
    const { svc, store, code } = await setup({ maxAttempts: 2 });
    store[0]!.attempts = 2;
    await expect(svc.verifyLoginOtp('ada', code)).rejects.toBeInstanceOf(TooManyOtpAttemptsError);
  });
});
