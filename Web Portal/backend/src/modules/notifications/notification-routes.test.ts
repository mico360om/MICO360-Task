import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createNotificationService } from './notification-service';
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
