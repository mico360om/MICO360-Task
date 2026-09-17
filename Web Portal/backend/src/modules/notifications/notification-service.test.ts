import { describe, it, expect, beforeEach } from 'vitest';
import { createNotificationService } from './notification-service';
import type { NotificationRecord, NotificationRepository } from './notification-repository';
import { NotFoundError } from '../../lib/http-errors';

function inMemory(): NotificationRepository {
  const rows = new Map<string, NotificationRecord>();
  let seq = 0;
  return {
    async create(data) {
      const n: NotificationRecord = {
        id: `n${seq++}`,
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body ?? null,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        readAt: null,
        createdAt: new Date(),
      };
      rows.set(n.id, n);
      return n;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async list(userId) { return [...rows.values()].filter((n) => n.userId === userId); },
    async markRead(id) { const n = { ...rows.get(id)!, readAt: new Date() }; rows.set(id, n); return n; },
    async markAllRead(userId) { for (const n of rows.values()) if (n.userId === userId && !n.readAt) n.readAt = new Date(); },
    async unreadCount(userId) { return [...rows.values()].filter((n) => n.userId === userId && !n.readAt).length; },
  };
}

let svc: ReturnType<typeof createNotificationService>;
beforeEach(() => {
  svc = createNotificationService({ notifications: inMemory() });
});

describe('NotificationService', () => {
  it('creates and lists notifications for a user', async () => {
    await svc.notify({ userId: 'u1', type: 'TASK_ASSIGNED', title: 'You were assigned a task' });
    await svc.notify({ userId: 'u2', type: 'TASK_ASSIGNED', title: 'other' });
    const list = await svc.listForUser('u1');
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('You were assigned a task');
  });

  it('counts unread and decrements after markRead', async () => {
    const n = (await svc.notify({ userId: 'u1', type: 'X', title: 'a' }))!;
    await svc.notify({ userId: 'u1', type: 'X', title: 'b' });
    expect(await svc.unreadCount('u1')).toBe(2);
    await svc.markRead(n.id, 'u1');
    expect(await svc.unreadCount('u1')).toBe(1);
  });

  it('throws NotFound marking another user’s notification', async () => {
    const n = (await svc.notify({ userId: 'u1', type: 'X', title: 'a' }))!;
    await expect(svc.markRead(n.id, 'u2')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('marks all as read', async () => {
    await svc.notify({ userId: 'u1', type: 'X', title: 'a' });
    await svc.notify({ userId: 'u1', type: 'X', title: 'b' });
    await svc.markAllRead('u1');
    expect(await svc.unreadCount('u1')).toBe(0);
  });

  it('suppresses a muted notification type per user preferences', async () => {
    const store = new Map<string, { muted: string[] }>();
    const withPrefs = createNotificationService({
      notifications: inMemory(),
      preferences: {
        async get(userId) { return store.get(userId) ?? { muted: [] }; },
        async set(userId, prefs) { store.set(userId, prefs); return prefs; },
      },
    });
    await withPrefs.setPreferences('u1', { muted: ['TASK_COMMENT'] });
    expect((await withPrefs.getPreferences('u1')).muted).toEqual(['TASK_COMMENT']);

    const muted = await withPrefs.notify({ userId: 'u1', type: 'TASK_COMMENT', title: 'New comment' });
    expect(muted).toBeNull(); // suppressed
    const allowed = await withPrefs.notify({ userId: 'u1', type: 'TASK_ASSIGNED', title: 'Assigned' });
    expect(allowed).not.toBeNull();
    expect(await withPrefs.listForUser('u1')).toHaveLength(1); // only the allowed one was stored
  });
});
