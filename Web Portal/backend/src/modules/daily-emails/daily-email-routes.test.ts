import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createMemoryIdempotencyStore } from '../../lib/idempotency';
import type { DailyEmailLogRow } from './daily-email-repository';
import type { DailyEmailOverview, ManualSendResult } from './daily-email-service';

const tokenService = createTokenService({ accessSecret: 'd-a', refreshSecret: 'd-r', accessTtl: 900, refreshTtl: 1000, refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} } });
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const auth = async (id: string, roles: string[] = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
const admin = (id = 'a1') => auth(id, ['ADMIN']);

const logRow: DailyEmailLogRow = {
  id: 'r1', userId: 'u1', day: '2026-10-21', kind: 'PENDING', status: 'FAILED', attempts: 4, taskCount: 0, nextAttemptAt: null, lastError: 'HTTP 503', sentAt: null,
  createdAt: new Date('2026-10-21T02:00:00Z'), updatedAt: new Date('2026-10-21T03:05:00Z'), userName: 'Ada Lovelace', email: 'ada@mico360.test',
};
const emailState = { on: true, state: 'SENT' as const, dueAt: null, sentAt: new Date('2026-10-21T03:01:00Z'), taskCount: 4, attempts: 1, nextAttemptAt: null, lastError: null };
const overviewOf = (day: string | null): DailyEmailOverview => ({
  day,
  lastCheckedAt: new Date('2026-10-21T05:41:00Z'),
  nextSendAt: new Date('2026-10-22T02:00:00Z'),
  summary: { people: 1, sent: 1, skipped: 1, failed: 0, retrying: 0, sending: 0, upcoming: 0, toSend: 0 },
  people: [{ userId: 'u1', name: 'Ada Lovelace', email: 'ada@mico360.test', timeZone: 'Asia/Muscat', ownTimeZone: false, time: '07:00', day: day ?? '2026-10-21', pending: emailState, completed: { ...emailState, state: 'SKIPPED', sentAt: null, taskCount: 0 } }],
});
const sentResult = (kind: 'PENDING' | 'COMPLETED', outcome: ManualSendResult['outcome'] = 'sent'): ManualSendResult => ({ kind, outcome, error: null, sentAt: outcome === 'off' ? null : new Date('2026-10-21T06:00:00Z') });

async function makeApp(opts: { configured?: boolean; idempotent?: boolean } = {}) {
  const sendTest = vi.fn(async () => ({ pending: 'sent' as const, completed: 'empty' as const }));
  const list = vi.fn(async () => [logRow]);
  const overview = vi.fn(async (day?: string) => overviewOf(day ?? null));
  const sendNow = vi.fn(async () => ({ sent: 9, skipped: 2, failed: 1, retrying: 1, alreadyDone: 4, off: 3 }));
  const sendFor = vi.fn(async (userId: string, o: { kind?: 'PENDING' | 'COMPLETED'; resend?: boolean } = {}) => {
    if (userId === 'nobody') return null;
    const off: string[] = userId === 'quiet' ? ['PENDING', 'COMPLETED'] : userId === 'half' || userId === 'other-half' ? ['COMPLETED'] : [];
    const kinds = o.kind ? [o.kind] : (['PENDING', 'COMPLETED'] as const);
    return { userId, name: 'Ada Lovelace', email: 'ada@mico360.test', day: '2026-10-21', results: kinds.map((k) => sentResult(k, off.includes(k) ? 'off' : 'sent')) };
  });
  const preview = vi.fn(async (userId: string, kind: 'PENDING' | 'COMPLETED') =>
    userId === 'nobody'
      ? null
      : { userId, name: 'Ada Lovelace', email: 'ada@mico360.test', kind, day: '2026-10-21', on: true, subject: 'Your pending tasks: 2', text: 'Good morning, Ada\n\n- Check the pump (RIG-1, Rig)', taskCount: 2, empty: false },
  );
  const audited: Array<{ action: string; module: string; entityId: string | null; userId: string | null; newValue: unknown }> = [];
  const auditService = {
    record: vi.fn(async (d: { action: string; module: string; entityId?: string | null; userId?: string | null; newValue?: unknown }) => {
      audited.push({ action: d.action, module: d.module, entityId: d.entityId ?? null, userId: d.userId ?? null, newValue: d.newValue });
      return { id: 'x', ip: null, oldValue: null, createdAt: new Date(), ...d, entityId: d.entityId ?? null, userId: d.userId ?? null, newValue: d.newValue };
    }),
    list: vi.fn(async () => []),
  };
  const app = await buildApp({
    authService,
    tokenService,
    auditService,
    ...(opts.idempotent ? { idempotencyStore: createMemoryIdempotencyStore() } : {}),
    dailyEmails: { service: { sendTest, overview, sendNow, sendFor, preview }, log: { list }, isConfigured: () => opts.configured ?? true },
  });
  return { app, sendTest, list, overview, sendNow, sendFor, preview, audited };
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
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails?day=2026-10-21&status=FAILED', headers: await admin() });
    expect(res.statusCode).toBe(200);
    expect(list).toHaveBeenCalledWith({ day: '2026-10-21', status: 'FAILED' });
    expect(res.json().data[0]).toMatchObject({ userName: 'Ada Lovelace', status: 'FAILED', attempts: 4, lastError: 'HTTP 503' });
    expect(res.json().meta).toEqual({ emailEnabled: true });
  });

  it('refuses a malformed day or status', async () => {
    const { app } = await makeApp();
    const headers = await admin();
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails?day=21-10-2026', headers })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails?status=LOST', headers })).statusCode).toBe(400);
  });
});

describe('Daily task emails: the administrators’ overview', () => {
  it('is for admins only', async () => {
    const { app, overview } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails/overview' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails/overview', headers: await auth('u1') })).statusCode).toBe(403);
    expect(overview).not.toHaveBeenCalled();
  });

  it('each person’s today, or a day asked for; with whether email is set up', async () => {
    const { app, overview } = await makeApp({ configured: false });
    const today = await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails/overview', headers: await admin() });
    expect(today.statusCode).toBe(200);
    expect(overview).toHaveBeenLastCalledWith(undefined);
    expect(today.json().data).toMatchObject({
      day: null,
      emailEnabled: false,
      lastCheckedAt: '2026-10-21T05:41:00.000Z',
      nextSendAt: '2026-10-22T02:00:00.000Z',
      summary: { people: 1, sent: 1 },
      people: [{ name: 'Ada Lovelace', time: '07:00', pending: { state: 'SENT', sentAt: '2026-10-21T03:01:00.000Z' } }],
    });
    const past = await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails/overview?day=2026-10-20', headers: await admin() });
    expect(overview).toHaveBeenLastCalledWith('2026-10-20');
    expect(past.json().data.day).toBe('2026-10-20');
  });

  it('refuses a malformed day', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/daily-emails/overview?day=yesterday', headers: await admin() })).statusCode).toBe(400);
  });
});

describe('Daily task emails: "Send today’s emails now"', () => {
  const url = '/api/v1/admin/daily-emails/send-now';

  it('is for admins only', async () => {
    const { app, sendNow } = await makeApp();
    expect((await app.inject({ method: 'POST', url, headers: await auth('u1') })).statusCode).toBe(403);
    expect(sendNow).not.toHaveBeenCalled();
  });

  it('sends and says how it went, and is recorded in the audit log', async () => {
    const { app, audited } = await makeApp();
    const res = await app.inject({ method: 'POST', url, headers: await admin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ sent: 9, skipped: 2, failed: 1, retrying: 1, alreadyDone: 4, off: 3 });
    expect(audited).toEqual([
      { action: 'daily_email.send_now', module: 'daily-emails', entityId: null, userId: 'a1', newValue: { sent: 9, skipped: 2, failed: 1, retrying: 1, alreadyDone: 4, off: 3 } },
    ]);
  });

  it('one press a minute per administrator', async () => {
    const { app, sendNow } = await makeApp();
    expect((await app.inject({ method: 'POST', url, headers: await admin('a1') })).statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url, headers: await admin('a1') });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.message).toBe('Today’s emails were just sent. Wait a minute before sending them again.');
    expect((await app.inject({ method: 'POST', url, headers: await admin('a2') })).statusCode).toBe(200);
    expect(sendNow).toHaveBeenCalledTimes(2);
  });

  it('says plainly when email isn’t set up, and sends nothing', async () => {
    const { app, sendNow } = await makeApp({ configured: false });
    const res = await app.inject({ method: 'POST', url, headers: await admin() });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toMatch(/isn’t set up/);
    expect(sendNow).not.toHaveBeenCalled();
  });

  it('a retried request (the same Idempotency-Key) gets the first answer and sends nothing more', async () => {
    const { app, sendNow } = await makeApp({ idempotent: true });
    const headers = { ...(await admin()), 'idempotency-key': 'send-now-1' };
    const first = await app.inject({ method: 'POST', url, headers });
    const replay = await app.inject({ method: 'POST', url, headers });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    expect(sendNow).toHaveBeenCalledTimes(1);
  });
});

describe('Daily task emails: send one person’s emails', () => {
  const url = '/api/v1/admin/daily-emails/send';

  it('is for admins only', async () => {
    const { app, sendFor } = await makeApp();
    expect((await app.inject({ method: 'POST', url, headers: await auth('u1'), payload: { userId: 'u9' } })).statusCode).toBe(403);
    expect(sendFor).not.toHaveBeenCalled();
  });

  it('sends that person’s emails (or one of them), says how each went, and is audited', async () => {
    const { app, sendFor, audited } = await makeApp();
    const res = await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'u9' } });
    expect(res.statusCode).toBe(200);
    expect(sendFor).toHaveBeenLastCalledWith('u9', { resend: false });
    expect(res.json().data).toMatchObject({ userId: 'u9', name: 'Ada Lovelace', results: [{ kind: 'PENDING', outcome: 'sent' }, { kind: 'COMPLETED', outcome: 'sent' }] });
    expect(audited.at(-1)).toEqual({
      action: 'daily_email.send', module: 'daily-emails', entityId: 'u9', userId: 'a1',
      newValue: { kind: null, resend: false, day: '2026-10-21', results: [{ kind: 'PENDING', outcome: 'sent' }, { kind: 'COMPLETED', outcome: 'sent' }] },
    });
    const one = await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'u8', kind: 'COMPLETED', resend: true } });
    expect(one.statusCode).toBe(200);
    expect(sendFor).toHaveBeenLastCalledWith('u8', { kind: 'COMPLETED', resend: true });
    expect(audited.at(-1)).toMatchObject({ action: 'daily_email.resend', entityId: 'u8', newValue: { kind: 'COMPLETED', resend: true } });
  });

  it('never sends an email the person turned off: says so plainly', async () => {
    const { app } = await makeApp();
    const one = await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'half', kind: 'COMPLETED', resend: true } });
    expect(one.statusCode).toBe(409);
    expect(one.json().error).toEqual({ code: 'EMAIL_TURNED_OFF', message: 'Ada Lovelace turned off the “Completed yesterday” email, so it can’t be sent.' });
    const both = await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'quiet' } });
    expect(both.statusCode).toBe(409);
    expect(both.json().error.message).toBe('Ada Lovelace turned off both daily emails, so there’s nothing to send.');
    // Only one turned off: the other goes.
    const half = await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'other-half' } });
    expect(half.statusCode).toBe(200);
  });

  it('a small gap between sends to the same person', async () => {
    const { app, sendFor } = await makeApp();
    expect((await app.inject({ method: 'POST', url, headers: await admin('a1'), payload: { userId: 'u7' } })).statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url, headers: await admin('a2'), payload: { userId: 'u7', resend: true } });
    expect(again.statusCode).toBe(429);
    expect(again.json().error.message).toBe('This person’s emails were just sent. Wait half a minute before sending again.');
    expect((await app.inject({ method: 'POST', url, headers: await admin('a1'), payload: { userId: 'u6' } })).statusCode).toBe(200);
    expect(sendFor).toHaveBeenCalledTimes(2);
  });

  it('a refusal (turned off, not found) doesn’t start the gap', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'quiet' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'quiet' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'nobody' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'nobody' } })).statusCode).toBe(404);
  });

  it('someone who isn’t an active person with an email address', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'nobody' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('That person isn’t active or has no email address.');
  });

  it('says plainly when email isn’t set up, and sends nothing', async () => {
    const { app, sendFor } = await makeApp({ configured: false });
    const res = await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'u9' } });
    expect(res.statusCode).toBe(503);
    expect(sendFor).not.toHaveBeenCalled();
  });

  it('refuses a request without a person or with an unknown email', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'POST', url, headers: await admin(), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url, headers: await admin(), payload: { userId: 'u9', kind: 'WEEKLY' } })).statusCode).toBe(400);
  });
});

describe('Daily task emails: preview', () => {
  const url = '/api/v1/admin/daily-emails/preview';

  it('is for admins only', async () => {
    const { app, preview } = await makeApp();
    expect((await app.inject({ method: 'GET', url: `${url}?userId=u1&kind=PENDING`, headers: await auth('u1') })).statusCode).toBe(403);
    expect(preview).not.toHaveBeenCalled();
  });

  it('the subject and plain text as it would be sent now — never HTML', async () => {
    const { app, preview } = await makeApp({ configured: false }); // a preview needs no email set up
    const res = await app.inject({ method: 'GET', url: `${url}?userId=u1&kind=PENDING`, headers: await admin() });
    expect(res.statusCode).toBe(200);
    expect(preview).toHaveBeenCalledWith('u1', 'PENDING');
    expect(res.json().data).toMatchObject({ subject: 'Your pending tasks: 2', text: expect.stringContaining('Check the pump'), taskCount: 2, empty: false });
    expect(res.json().data).not.toHaveProperty('html');
  });

  it('someone who isn’t an active person with an email address; a bad request', async () => {
    const { app } = await makeApp();
    expect((await app.inject({ method: 'GET', url: `${url}?userId=nobody&kind=PENDING`, headers: await admin() })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${url}?userId=u1`, headers: await admin() })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `${url}?kind=PENDING`, headers: await admin() })).statusCode).toBe(400);
  });
});
