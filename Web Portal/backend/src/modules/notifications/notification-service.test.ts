import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  describe('one waiting notification per conversation (direct messages)', () => {
    const dm = (title: string, conversation = 'c1') => ({ userId: 'u1', type: 'CHAT_MESSAGE', title, entityType: 'conversation', entityId: conversation });

    it('a second message in the same conversation updates the waiting notification instead of adding one', async () => {
      const first = (await svc.notifyOnce(dm('New message from Aisha Khan')))!;
      const second = (await svc.notifyOnce(dm('2 new messages from Aisha Khan')))!;
      expect(second.id).toBe(first.id);
      expect(await svc.unreadCount('u1')).toBe(1);
      expect((await svc.listForUser('u1')).map((n) => n.title)).toEqual(['2 new messages from Aisha Khan']);
    });

    it('two messages arriving at the same moment still leave one waiting notification', async () => {
      const [first, second] = await Promise.all([
        svc.notifyOnce(dm('New message from Aisha Khan')),
        svc.notifyOnce(dm('2 new messages from Aisha Khan')),
      ]);
      expect(second!.id).toBe(first!.id);
      expect(await svc.unreadCount('u1')).toBe(1);
      expect((await svc.listForUser('u1')).map((n) => n.title)).toEqual(['2 new messages from Aisha Khan']);
      // The next one, on its own, still finds that row.
      const third = (await svc.notifyOnce(dm('3 new messages from Aisha Khan')))!;
      expect(third.id).toBe(first!.id);
      expect(await svc.unreadCount('u1')).toBe(1);
    });

    it('another conversation, or one already read, gets its own notification', async () => {
      const first = (await svc.notifyOnce(dm('New message from Aisha Khan')))!;
      await svc.notifyOnce(dm('New message from Omar Ahmed', 'c2'));
      expect(await svc.unreadCount('u1')).toBe(2);
      await svc.markRead(first.id, 'u1');
      const again = (await svc.notifyOnce(dm('New message from Aisha Khan')))!;
      expect(again.id).not.toBe(first.id);
      expect(await svc.unreadCount('u1')).toBe(2);
    });

    it('reading the conversation clears its notifications, and only its own', async () => {
      await svc.notifyOnce(dm('New message from Aisha Khan'));
      await svc.notify({ userId: 'u1', type: 'CHAT_MENTION', title: 'You were mentioned in chat', entityType: 'conversation', entityId: 'c1' });
      await svc.notifyOnce(dm('New message from Omar Ahmed', 'c2'));
      await svc.notify({ userId: 'u2', type: 'CHAT_MESSAGE', title: 'for someone else', entityType: 'conversation', entityId: 'c1' });

      expect(await svc.markEntityRead('u1', 'conversation', 'c1')).toBe(2);
      expect(await svc.unreadCount('u1')).toBe(1);
      expect(await svc.unreadCount('u2')).toBe(1);
    });

    it('respects a muted type and still pushes each message to the phone', async () => {
      const push = { sendToUser: vi.fn(async () => 1) };
      const prefs = { get: async () => ({ muted: ['CHAT_MESSAGE'] }), set: async (_: string, p: unknown) => p };
      const muted = createNotificationService({ notifications: inMemory(), preferences: prefs as never, push });
      expect(await muted.notifyOnce(dm('x'))).toBeNull();
      expect(push.sendToUser).not.toHaveBeenCalled();

      const loud = createNotificationService({ notifications: inMemory(), push });
      await loud.notifyOnce(dm('New message from Aisha Khan'));
      await loud.notifyOnce(dm('2 new messages from Aisha Khan'));
      expect(push.sendToUser).toHaveBeenCalledTimes(2);
    });
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

  it('pushes each delivered notification to the phone, but not muted ones (NTF-01)', async () => {
    const sendToUser = vi.fn(async () => 1);
    const withPush = createNotificationService({
      notifications: inMemory(),
      preferences: { async get() { return { muted: ['TASK_COMMENT'] }; }, async set(_u, p) { return p; } },
      push: { sendToUser },
    });
    await withPush.notify({ userId: 'u1', type: 'TASK_ASSIGNED', title: 'You were assigned a task', body: 'Fix login', entityType: 'task', entityId: 't1' });
    await withPush.notify({ userId: 'u1', type: 'TASK_COMMENT', title: 'New comment' });
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(sendToUser).toHaveBeenCalledWith('u1', { title: 'You were assigned a task', body: 'Fix login', entityType: 'task', entityId: 't1', notificationId: 'n0' });
  });

  it('never fails the in-app notification when the push fails', async () => {
    const logger = { error: vi.fn() };
    const withPush = createNotificationService({ notifications: inMemory(), push: { sendToUser: async () => { throw new Error('FCM down'); } }, logger });
    await expect(withPush.notify({ userId: 'u1', type: 'X', title: 'a' })).resolves.not.toBeNull();
    await new Promise((resolve) => setImmediate(resolve));
    expect(logger.error).toHaveBeenCalledWith('push notification failed', expect.objectContaining({ userId: 'u1' }));
  });
});

describe('the push names its notification (5c review)', () => {
  it('carries the stored notification’s id, so a tap on the phone reads exactly that one', async () => {
    const sendToUser = vi.fn(async () => 1);
    const svc = createNotificationService({ notifications: inMemory(), push: { sendToUser } });
    const first = await svc.notify({ userId: 'u1', type: 'TASK_COMMENT', title: 'New comment', entityType: 'task', entityId: 't1' });
    const second = await svc.notify({ userId: 'u1', type: 'TASK_MENTION', title: 'You were mentioned', entityType: 'task', entityId: 't1' });
    expect(sendToUser.mock.calls.map((c) => (c as unknown as [string, { notificationId?: string }])[1].notificationId)).toEqual([first!.id, second!.id]);
  });

  it('a waiting conversation notification that is reworded keeps its id in the push', async () => {
    const sendToUser = vi.fn(async () => 1);
    const svc = createNotificationService({ notifications: inMemory(), push: { sendToUser } });
    const a = await svc.notifyOnce({ userId: 'u1', type: 'CHAT_MESSAGE', title: 'Omar: hi', entityType: 'conversation', entityId: 'c1' });
    const b = await svc.notifyOnce({ userId: 'u1', type: 'CHAT_MESSAGE', title: 'Omar: are you there?', entityType: 'conversation', entityId: 'c1' });
    expect(b!.id).toBe(a!.id);
    expect(sendToUser.mock.calls.map((c) => (c as unknown as [string, { notificationId?: string }])[1].notificationId)).toEqual([a!.id, a!.id]);
  });
});

describe('Mark all read up to a time (5c review)', () => {
  it('passes the time on, so only what came in by then is read', async () => {
    const repo = inMemory();
    const markAllRead = vi.spyOn(repo, 'markAllRead');
    const svc = createNotificationService({ notifications: repo });
    const upTo = new Date('2026-10-21T10:00:00.000Z');
    await svc.markAllRead('u1', upTo);
    expect(markAllRead).toHaveBeenCalledWith('u1', upTo);
    await svc.markAllRead('u1');
    expect(markAllRead).toHaveBeenLastCalledWith('u1', undefined);
  });
});
