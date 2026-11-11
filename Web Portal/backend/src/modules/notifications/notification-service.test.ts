import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createNotificationService } from './notification-service';
import type { NotificationRepository } from './notification-repository';
import { createMemoryNotificationRepository } from './notification-memory.fixture';
import { NotFoundError } from '../../lib/http-errors';

/** The shared in-memory repository (the database's rules), a fresh one per call. */
const inMemory = (): NotificationRepository => createMemoryNotificationRepository();

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
    // (the third argument is the companies scope: null = every notification of theirs)
    expect(markAllRead).toHaveBeenCalledWith('u1', upTo, null);
    await svc.markAllRead('u1');
    expect(markAllRead).toHaveBeenLastCalledWith('u1', undefined, null);
  });
});

describe('The bell follows the person’s projects and the picked company (companies)', () => {
  it('passes the scope’s projects on to the list, the count and read-all; no scope = everything', async () => {
    const repo = inMemory();
    const list = vi.spyOn(repo, 'list');
    const count = vi.spyOn(repo, 'unreadCount');
    const readAll = vi.spyOn(repo, 'markAllRead');
    const svc = createNotificationService({ notifications: repo });
    await svc.listForUser('u1', { projectIds: ['p1'], pick: 'A' });
    expect(list).toHaveBeenLastCalledWith('u1', ['p1']);
    await svc.unreadCount('u1', { projectIds: [], pick: null });
    expect(count).toHaveBeenLastCalledWith('u1', []);
    await svc.markAllRead('u1', undefined, { projectIds: ['p2'], pick: 'B' });
    expect(readAll).toHaveBeenLastCalledWith('u1', undefined, ['p2']);
    await svc.listForUser('u1');
    expect(list).toHaveBeenLastCalledWith('u1', null);
  });
});

describe('meeting reminders: push options and the live pop-up', () => {
  it('passes push options (the meetings channel) to the phone push', async () => {
    const sendToUser = vi.fn(async () => 1);
    const svc = createNotificationService({ notifications: inMemory(), push: { sendToUser } });
    const n = await svc.notify(
      { userId: 'u1', type: 'MEETING_REMINDER', title: 'Meeting in 15 minutes: Review', body: '09:00–10:00', entityType: 'meeting', entityId: 'm1' },
      { push: { channelId: 'meetings', ttlSeconds: 900, tag: 'meeting-m1' } },
    );
    expect(sendToUser).toHaveBeenCalledWith('u1', {
      title: 'Meeting in 15 minutes: Review', body: '09:00–10:00', entityType: 'meeting', entityId: 'm1', notificationId: n!.id, channelId: 'meetings', ttlSeconds: 900, tag: 'meeting-m1',
    });
  });

  it('tells the person’s open pages about each stored notification (not about muted ones)', async () => {
    const onDelivered = vi.fn();
    const svc = createNotificationService({
      notifications: inMemory(),
      preferences: { async get() { return { muted: ['TASK_COMMENT'] }; }, async set(_u, p) { return p; } },
      onDelivered,
    });
    const n = await svc.notify({ userId: 'u1', type: 'MEETING_REMINDER', title: 'Meeting in 15 minutes: Review', entityType: 'meeting', entityId: 'm1' });
    await svc.notify({ userId: 'u1', type: 'TASK_COMMENT', title: 'New comment' });
    expect(onDelivered).toHaveBeenCalledTimes(1);
    expect(onDelivered).toHaveBeenCalledWith(n);
  });

  it('a failing live hook never fails the notification', async () => {
    const svc = createNotificationService({ notifications: inMemory(), onDelivered: () => { throw new Error('socket down'); } });
    await expect(svc.notify({ userId: 'u1', type: 'X', title: 'a' })).resolves.not.toBeNull();
  });
});

// 1.23 Client accounts: no bell, no phone push, nothing on their open pages — ever.
describe('NotificationService — client accounts', () => {
  it('never stores, pushes or announces a notification for a client account', async () => {
    const push = { sendToUser: vi.fn(async () => 1) };
    const onDelivered = vi.fn();
    const s = createNotificationService({ notifications: inMemory(), push, onDelivered, isClient: async (id) => id === 'client-1' });
    expect(await s.notify({ userId: 'client-1', type: 'MEETING_INVITE', title: 'You are invited' })).toBeNull();
    expect(await s.notifyOnce({ userId: 'client-1', type: 'CHAT_MESSAGE', title: 'x', entityType: 'conversation', entityId: 'c' })).toBeNull();
    expect(await s.listForUser('client-1')).toEqual([]);
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(onDelivered).not.toHaveBeenCalled();
    expect(await s.notify({ userId: 'staff-1', type: 'X', title: 'still delivered' })).not.toBeNull();
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
  });
});

describe('Notification & Scheduling centre: delivery by the person’s rules', () => {
  const decision = (d: Partial<import('../notify-policy/delivery').DeliveryDecision>) => ({ kind: null, bell: true, push: 'now' as const, email: 'off' as const, releaseAt: null, ...d });
  const setup = (d: Partial<import('../notify-policy/delivery').DeliveryDecision>) => {
    const push = { sendToUser: vi.fn(async () => 1) };
    const delivery = { decide: vi.fn(async () => decision(d)), hold: vi.fn(async () => {}), email: vi.fn(async () => {}) };
    const svc2 = createNotificationService({ notifications: inMemory(), push, delivery });
    return { svc2, push, delivery };
  };
  const input = { userId: 'u1', type: 'TASK_OVERDUE', title: 'A task is overdue', body: 'MICO-1 · Pour slab', entityType: 'task', entityId: 't1' };

  it('working time: the bell, the push now, no email', async () => {
    const { svc2, push, delivery } = setup({});
    expect(await svc2.notify(input)).not.toBeNull();
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(delivery.hold).not.toHaveBeenCalled();
    expect(delivery.email).not.toHaveBeenCalled();
  });

  it('quiet hours: the bell fills, the push and email are held until the morning', async () => {
    const releaseAt = new Date('2026-11-16T04:00:00Z');
    const { svc2, push, delivery } = setup({ push: 'hold', email: 'hold', releaseAt });
    const n = (await svc2.notify(input, { expiresAt: null }))!;
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(delivery.hold.mock.calls.map((c) => (c as unknown as [{ channel: string; notificationId: string; releaseAt: Date }])[0])).toEqual([
      expect.objectContaining({ channel: 'PUSH', notificationId: n.id, releaseAt }),
      expect.objectContaining({ channel: 'EMAIL', notificationId: n.id, releaseAt, title: 'A task is overdue' }),
    ]);
  });

  it('bell off: nothing stored and no push — an email-only choice still emails', async () => {
    const { svc2, push, delivery } = setup({ bell: false, push: 'off', email: 'now' });
    expect(await svc2.notify(input)).toBeNull();
    expect(await svc2.unreadCount('u1')).toBe(0);
    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(delivery.email).toHaveBeenCalledWith('u1', input);
  });

  it('a notice’s own email (an @mention) is used instead of the plain one', async () => {
    const own = vi.fn(async () => {});
    const { svc2, delivery } = setup({ email: 'now' });
    await svc2.notify({ ...input, type: 'MENTION' }, { email: own });
    expect(own).toHaveBeenCalledTimes(1);
    expect(delivery.email).not.toHaveBeenCalled();
  });

  it('passes a meeting’s start so a held reminder after it is dropped', async () => {
    const { svc2, delivery } = setup({});
    const expiresAt = new Date('2026-11-15T18:00:00Z');
    await svc2.notify({ ...input, type: 'MEETING_REMINDER' }, { expiresAt });
    expect(delivery.decide).toHaveBeenCalledWith('u1', 'MEETING_REMINDER', { expiresAt });
  });

  it('without the centre (older wiring) a notice’s own email goes whenever the bell does', async () => {
    const own = vi.fn(async () => {});
    const legacy = createNotificationService({ notifications: inMemory(), preferences: { get: async () => ({ muted: ['MENTION'] }), set: async (_u, p) => p } });
    await legacy.notify({ ...input, type: 'MENTION' }, { email: own });
    expect(own).not.toHaveBeenCalled();
    await legacy.notify({ ...input, type: 'TASK_COMMENT' }, { email: own });
    expect(own).toHaveBeenCalledTimes(1);
  });
});

describe('review M10: the person’s rules can’t be read', () => {
  it('the notice still goes (bell + push now), their muted types still apply', async () => {
    const push = { sendToUser: vi.fn(async () => 1) };
    const delivery = { decide: vi.fn(async () => { throw new Error('database blip'); }), hold: vi.fn(async () => {}), email: vi.fn(async () => {}) };
    const svc3 = createNotificationService({ notifications: inMemory(), push, delivery, preferences: { get: async () => ({ muted: ['TASK_COMMENT'] }), set: async (_u, p) => p } });
    expect(await svc3.notify({ userId: 'u1', type: 'TASK_OVERDUE', title: 'A task is overdue' })).not.toBeNull();
    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(await svc3.notify({ userId: 'u1', type: 'TASK_COMMENT', title: 'A comment' })).toBeNull();
  });
});
