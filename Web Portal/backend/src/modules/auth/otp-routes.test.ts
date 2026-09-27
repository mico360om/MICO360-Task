import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createOtpService } from './otp-service';
import { createMemoryOtpStore } from './memory-otp-store';
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

function makeOtpHarness(configured = true) {
  const emails: { email: string; code: string }[] = [];
  const pending: Promise<void>[] = [];
  const otpService = createOtpService({
    ttlSeconds: 600,
    otpLength: 6,
    maxAttempts: 3,
    users: {
      async findActiveByIdentifier(identifier) {
        return identifier === 'ada'
          ? { id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['EMPLOYEE'], avatarUrl: '/uploads/ada.png', tokenVersion: 1 }
          : null;
      },
    },
    otps: createMemoryOtpStore(),
    mailer: {
      async sendLoginCode(email, code) {
        emails.push({ email, code });
      },
      isConfigured: () => configured,
    },
    runInBackground: (task) => void pending.push(task()),
  });
  return { otpService, emails, flush: () => Promise.all(pending.splice(0)) };
}

async function makeApp(configured = true) {
  const { otpService, emails, flush } = makeOtpHarness(configured);
  const tokenService = createTokenService({
    accessSecret: 'otp-access-secret',
    refreshSecret: 'otp-refresh-secret',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  const authService = createAuthService({ users: noopUsers, maxAttempts: 5 });
  const app = await buildApp({ authService, tokenService, otpService });
  return { app, emails, flush, tokenService };
}

describe('OTP login routes', () => {
  it('POST /auth/otp/request returns sent:true', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { identifier: 'ada' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sent).toBe(true);
    await app.close();
  });

  it('POST /auth/otp/request answers 503 EMAIL_NOT_CONFIGURED for any identifier when email is off', async () => {
    const { app } = await makeApp(false);
    for (const identifier of ['ada', 'ghost']) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { identifier } });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('EMAIL_NOT_CONFIGURED');
    }
    await app.close();
  });

  it('POST /auth/otp/verify with the correct code returns tokens and the full user', async () => {
    const { app, emails, flush, tokenService } = await makeApp();
    await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { identifier: 'ada' } });
    await flush();
    const code = emails[0]!.code;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { identifier: 'ada', code } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user).toEqual({ id: 'u1', email: 'ada@mico360.test', username: 'ada', roles: ['EMPLOYEE'], avatarUrl: '/uploads/ada.png' });
    expect(tokenService.verifyAccess(res.json().data.accessToken).ver).toBe(1);
    await app.close();
  });

  it('POST /auth/otp/verify with a wrong code returns 401 INVALID_OTP', async () => {
    const { app, emails, flush } = await makeApp();
    await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { identifier: 'ada' } });
    await flush();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { identifier: 'ada', code: emails[0]!.code === '000000' ? '111111' : '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_OTP');
    await app.close();
  });
});
