import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createOtpService } from './otp-service';
import { createTokenService } from './token-service';
import { createAuthService } from './auth-service';
import type { AuthUserRepository } from './user-repository';

// Minimal auth service (login route stays present but unused here).
const noopUsers: AuthUserRepository = {
  async findByIdentifier() {
    return null;
  },
  async findById() {
    return null;
  },
  async applyFailedAttempt() {},
  async resetFailedAttempts() {},
};

function makeOtpHarness() {
  const store: { id: string; userId: string; codeHash: string; expiresAt: Date; attempts: number; consumedAt: Date | null }[] = [];
  const emails: { email: string; code: string }[] = [];
  let seq = 0;
  const otpService = createOtpService({
    ttlSeconds: 600,
    otpLength: 6,
    maxAttempts: 3,
    users: {
      async findActiveByIdentifier(identifier) {
        return identifier === 'ada' ? { id: 'u1', email: 'ada@mico360.test', roles: ['EMPLOYEE'] } : null;
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
  return { otpService, emails };
}

async function makeApp() {
  const { otpService, emails } = makeOtpHarness();
  const tokenService = createTokenService({
    accessSecret: 'otp-access-secret',
    refreshSecret: 'otp-refresh-secret',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  const authService = createAuthService({ users: noopUsers, maxAttempts: 5 });
  const app = await buildApp({ authService, tokenService, otpService });
  return { app, emails };
}

describe('OTP login routes', () => {
  it('POST /auth/otp/request returns sent:true', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { identifier: 'ada' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sent).toBe(true);
    await app.close();
  });

  it('POST /auth/otp/verify with the correct code returns tokens', async () => {
    const { app, emails } = await makeApp();
    await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { identifier: 'ada' } });
    const code = emails[0]!.code;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { identifier: 'ada', code } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.id).toBe('u1');
    expect(typeof res.json().data.accessToken).toBe('string');
    await app.close();
  });

  it('POST /auth/otp/verify with a wrong code returns 401 INVALID_OTP', async () => {
    const { app } = await makeApp();
    await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { identifier: 'ada' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { identifier: 'ada', code: '000000' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_OTP');
    await app.close();
  });
});
