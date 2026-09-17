import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createPasswordResetService, type PasswordResetStore, type ResetUserRepo, type ResetMailer } from './password-reset-service';
import { createTokenService } from './token-service';
import { createAuthService } from './auth-service';

let emails: { email: string; link: string }[];
let unlocked: string[];

function makeService() {
  const rows: { id: string; userId: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }[] = [];
  let seq = 0;
  const store: PasswordResetStore = {
    async create(d) { rows.push({ id: `r${seq++}`, consumedAt: null, ...d }); },
    async findActiveByHash(h) { return rows.find((r) => r.tokenHash === h && r.consumedAt === null) ?? null; },
    async consume(id) { const r = rows.find((x) => x.id === id); if (r) r.consumedAt = new Date(); },
  };
  const users: ResetUserRepo = {
    async findActiveByIdentifier(id) { return id === 'ada@x.com' ? { id: 'u1', email: 'ada@x.com' } : null; },
    async setPasswordAndUnlock(userId) { unlocked.push(userId); },
  };
  const mailer: ResetMailer = { async sendPasswordReset(email, link) { emails.push({ email, link }); } };
  return createPasswordResetService({ store, users, mailer, ttlSeconds: 3600, appUrl: 'https://app.test', hashPassword: async (p) => `h:${p}` });
}

const tokenService = createTokenService({ accessSecret: 'pr-a', refreshSecret: 'pr-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });

async function makeApp() {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, passwordResetService: makeService() });
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  emails = [];
  unlocked = [];
  app = await makeApp();
});

describe('Password reset routes', () => {
  it('always returns sent for a forgot request (no account enumeration)', async () => {
    const known = await app.inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { identifier: 'ada@x.com' } });
    expect(known.statusCode).toBe(200);
    expect(known.json().data).toEqual({ sent: true });
    expect(emails).toHaveLength(1);

    const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { identifier: 'ghost@x.com' } });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().data).toEqual({ sent: true });
    expect(emails).toHaveLength(1); // no email sent for the unknown account
  });

  it('resets the password and unlocks the account with a valid token', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { identifier: 'ada@x.com' } });
    const token = new URL(emails[0]!.link).searchParams.get('token')!;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token, password: 'NewPass123' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ reset: true });
    expect(unlocked).toEqual(['u1']);
  });

  it('rejects a weak password (400 WEAK_PASSWORD)', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { identifier: 'ada@x.com' } });
    const token = new URL(emails[0]!.link).searchParams.get('token')!;
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token, password: 'weak' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WEAK_PASSWORD');
  });

  it('rejects an invalid token (400 INVALID_RESET_TOKEN)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/password/reset', payload: { token: 'nope', password: 'NewPass123' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_RESET_TOKEN');
  });
});
