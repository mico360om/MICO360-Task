import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../app';
import { createNotificationService } from './notification-service';
import { normalizePreferences } from './notification-preferences';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { NotificationRecord, NotificationRepository } from './notification-repository';

function inMemory(): NotificationRepository {
  const rows = new Map<string, NotificationRecord>();
  let seq = 0;
  return {
    async create(data) {
      const n: NotificationRecord = { id: `n${seq++}`, userId: data.userId, type: data.type, title: data.title, body: data.body ?? null, entityType: null, entityId: null, readAt: null, createdAt: new Date() };
      rows.set(n.id, n);
      return n;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async list(userId) { return [...rows.values()].filter((n) => n.userId === userId); },
    async markRead(id) { const n = { ...rows.get(id)!, readAt: new Date() }; rows.set(id, n); return n; },
    async markAllRead(userId) { for (const n of rows.values()) if (n.userId === userId) n.readAt = new Date(); },
    async unreadCount(userId) { return [...rows.values()].filter((n) => n.userId === userId && !n.readAt).length; },
    async findUnread(userId, type, entityType, entityId) {
      return [...rows.values()].reverse().find((n) => n.userId === userId && n.type === type && n.entityType === entityType && n.entityId === entityId && !n.readAt) ?? null;
    },
    async refresh(id, data) { const n = { ...rows.get(id)!, title: data.title, body: data.body ?? null, createdAt: new Date() }; rows.set(id, n); return n; },
    async markEntityRead(userId, entityType, entityId) {
      let count = 0;
      for (const n of rows.values()) if (n.userId === userId && n.entityType === entityType && n.entityId === entityId && !n.readAt) { n.readAt = new Date(); count += 1; }
      return count;
    },
  };
}

const tokenService = createTokenService({
  accessSecret: 'ntf-access',
  refreshSecret: 'ntf-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const notificationService = createNotificationService({ notifications: inMemory() });
  await notificationService.notify({ userId: 'u1', type: 'TASK_ASSIGNED', title: 'hello' });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, notificationService });
}
async function token() {
  return (await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Notification routes', () => {
  it('lists the current user’s notifications (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: { authorization: `Bearer ${await token()}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('reports the unread count (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications/unread-count', headers: { authorization: `Bearer ${await token()}` } });
    expect(res.json().data.count).toBe(1);
  });

  it('rejects unauthenticated access (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications' });
    expect(res.statusCode).toBe(401);
  });
});

describe('Notification preferences: daily task emails', () => {
  async function appWithStore() {
    const stored = new Map<string, unknown>();
    const notificationService = createNotificationService({
      notifications: inMemory(),
      preferences: {
        async get(userId) { return normalizePreferences(stored.get(userId) ?? null); },
        async set(userId, prefs) { stored.set(userId, prefs); return prefs; },
      },
    });
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    return buildApp({ authService, tokenService, notificationService });
  }

  it('reads the daily email settings, on at 06:00 by default', async () => {
    const a = await appWithStore();
    const res = await a.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: { authorization: `Bearer ${await token()}` } });
    expect(res.json().data.dailyEmails).toEqual({ pending: true, completed: true, time: '06:00' });
  });

  it('saves them without losing other settings, and an app that doesn’t know them keeps them', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { muted: ['TASK_COMMENT'], reminderLeadMinutes: 120 } });
    const saved = await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails: { completed: false, time: '07:15' } } });
    expect(saved.json().data).toMatchObject({ muted: ['TASK_COMMENT'], reminderLeadMinutes: 120, dailyEmails: { pending: true, completed: false, time: '07:15' } });
    // The phone app (before this release) saves the muted types with the reminder time, and leaves the
    // reminder time out to go back to the default — that still works, and the daily emails stay.
    await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { muted: [] } });
    const after = (await a.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: auth })).json().data;
    expect(after).toMatchObject({ muted: [], dailyEmails: { pending: true, completed: false, time: '07:15' } });
    expect(after.reminderLeadMinutes).toBeUndefined();
  });

  it('saves the weekly management summary switch, and saves that leave it out keep it', async () => {
    const a = await appWithStore();
    const auth = { authorization: `Bearer ${await token()}` };
    expect((await a.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: auth })).json().data.weeklySummary).toBe(true);
    const off = await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { weeklySummary: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().data.weeklySummary).toBe(false);
    // The daily email settings and an older app's save (muted types only) leave it as it is.
    await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { dailyEmails: { time: '07:00' } } });
    await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { muted: ['TASK_COMMENT'] } });
    expect((await a.inject({ method: 'GET', url: '/api/v1/notifications/preferences', headers: auth })).json().data).toMatchObject({ weeklySummary: false, muted: ['TASK_COMMENT'] });
    expect((await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: auth, payload: { weeklySummary: 'off' } })).statusCode).toBe(400);
  });

  it('refuses a time that isn’t HH:MM', async () => {
    const a = await appWithStore();
    const res = await a.inject({ method: 'PUT', url: '/api/v1/notifications/preferences', headers: { authorization: `Bearer ${await token()}` }, payload: { dailyEmails: { time: '6pm' } } });
    expect(res.statusCode).toBe(400);
  });
});

describe('Mark all read up to the newest shown (5c review)', () => {
  async function appWithSpy() {
    const notificationService = createNotificationService({ notifications: inMemory() });
    const markAllRead = vi.spyOn(notificationService, 'markAllRead');
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    return { app: await buildApp({ authService, tokenService, notificationService }), markAllRead };
  }
  const post = async (a: Awaited<ReturnType<typeof appWithSpy>>['app'], body?: unknown) =>
    a.inject({ method: 'POST', url: '/api/v1/notifications/read-all', headers: { authorization: `Bearer ${await token()}` }, ...(body !== undefined ? { payload: body as object } : {}) });

  it('reads only what came in up to the time given: a newer one stays unread', async () => {
    const { app: a, markAllRead } = await appWithSpy();
    const res = await post(a, { upTo: '2026-10-21T10:00:00.000Z' });
    expect(res.statusCode).toBe(200);
    expect(markAllRead).toHaveBeenCalledWith('u1', new Date('2026-10-21T10:00:00.000Z'));
  });

  it('without a time, reads everything, as before (older apps and pages)', async () => {
    const { app: a, markAllRead } = await appWithSpy();
    expect((await post(a)).statusCode).toBe(200);
    expect(markAllRead).toHaveBeenCalledWith('u1', undefined);
    expect((await post(a, {})).statusCode).toBe(200);
    expect(markAllRead).toHaveBeenLastCalledWith('u1', undefined);
  });

  it('refuses a time that isn’t one', async () => {
    const { app: a, markAllRead } = await appWithSpy();
    expect((await post(a, { upTo: 'yesterday' })).statusCode).toBe(400);
    expect(markAllRead).not.toHaveBeenCalled();
  });
});
