import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { DailyEmailLogRow } from './daily-email-repository';

const tokenService = createTokenService({ accessSecret: 'd-a', refreshSecret: 'd-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const auth = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

const logRow: DailyEmailLogRow = {
  id: 'r1', userId: 'u1', day: '2026-10-21', kind: 'PENDING', status: 'FAILED', attempts: 4, taskCount: 0, nextAttemptAt: null, lastError: 'HTTP 503', sentAt: null,
  createdAt: new Date('2026-10-21T02:00:00Z'), updatedAt: new Date('2026-10-21T03:05:00Z'), userName: 'Ada Lovelace', email: 'ada@mico360.test',
};

async function makeApp(opts: { configured?: boolean } = {}) {
  const sendTest = vi.fn(async () => ({ pending: 'sent' as const, completed: 'empty' as const }));
  const list = vi.fn(async () => [logRow]);
  const app = await buildApp({
    authService,
    tokenService,
    dailyEmails: { service: { sendTest }, log: { list }, isConfigured: () => opts.configured ?? true },
  });
  return { app, sendTest, list };
}

describe('Daily task emails: "Send me a test now"', () => {
  it('sends the person’s own emails and says which went', async () => {
    const { app, sendTest } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/daily-emails/test', headers: await auth('u1') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ pending: 'sent', completed: 'empty' });
    expect(sendTest).toHaveBeenCalledWith('u1');
  });

  it('allows one test a minute per person', async () => {
    const { app, sendTest } = await makeApp();
    const headers = await auth('u2');
    expect((await app.inject({ method: 'POST', url: '/api/v1/notifications/daily-emails/test', headers })).statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/api/v1/notifications/daily-emails/test', headers });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.message).toMatch(/a minute/);
    expect(sendTest).toHaveBeenCalledTimes(1);
  });

  it('says plainly when email isn’t set up on the server', async () => {
    const { app, sendTest } = await makeApp({ configured: false });
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/daily-emails/test', headers: await auth('u3') });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toMatch(/isn’t set up/);
    expect(sendTest).not.toHaveBeenCalled();
  });

  it('needs a signed-in person', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'POST', url: '/api/v1/notifications/daily-emails/test' })).statusCode).toBe(401);
  });
});

describe('Daily task emails: the delivery log', () => {
  it('is for admins, filtered by day and status', async () => {
    const { app, list } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails', headers: await auth('u1') })).statusCode).toBe(403);
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails?day=2026-10-21&status=FAILED', headers: await auth('a1', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith({ day: '2026-10-21', status: 'FAILED' });
    expect(res.json().data[0]).toMatchObject({ userName: 'Ada Lovelace', status: 'FAILED', attempts: 4, lastError: 'HTTP 503' });
    expect(res.json().meta).toEqual({ emailEnabled: true });
  });

  it('refuses a malformed day or status', async () => {
    const { app } = await makeApp();
    const headers = await auth('a1', ['ADMIN']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails?day=21-10-2026', headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails?status=LOST', headers })).statusCode).toBe(400);
  });
});
