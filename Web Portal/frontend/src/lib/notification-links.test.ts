import { describe, it, expect } from 'vitest';
import { notificationTarget } from './notification-links';

describe('notificationTarget', () => {
  it('opens the related task (entity type in any case)', () => {
    expect(notificationTarget({ entityType: 'task', entityId: 't1' })).toEqual({ kind: 'task', taskId: 't1' });
    expect(notificationTarget({ entityType: 'TASK', entityId: 't2' })).toEqual({ kind: 'task', taskId: 't2' });
  });

  it('opens the conversation a chat notification is about (not just the Chat page)', () => {
    expect(notificationTarget({ entityType: 'conversation', entityId: 'c1' })).toEqual({ kind: 'path', to: '/chat?conversation=c1' });
    expect(notificationTarget({ entityType: 'conversation', entityId: null })).toEqual({ kind: 'path', to: '/chat' });
  });

  it('ignores notifications with nothing to open', () => {
    expect(notificationTarget({ entityType: 'digest', entityId: null })).toBeNull();
    expect(notificationTarget({ entityType: null, entityId: null })).toBeNull();
  });
});

describe('Mark all read: only what the reader was shown (5c review)', () => {
  it('sends the newest notification’s time as upTo; nothing shown, no time', async () => {
    const { newestShown } = await import('./notification-links');
    expect(newestShown([
      { createdAt: '2026-10-21T09:00:00.000Z' },
      { createdAt: '2026-10-21T10:30:00.000Z' },
      { createdAt: '2026-10-20T08:00:00.000Z' },
    ])).toBe('2026-10-21T10:30:00.000Z');
    expect(newestShown([])).toBeUndefined();
    expect(newestShown(undefined)).toBeUndefined();
    expect(newestShown([{ createdAt: 'not a date' }])).toBeUndefined();
  });

  it('the request carries it (and stays bodyless without one, as before)', async () => {
    const { notificationsApi } = await import('../api/notifications');
    const calls: [string, unknown][] = [];
    const client = { post: async (path: string, body?: unknown) => { calls.push([path, body]); return { data: { ok: true } }; } };
    await notificationsApi(client as never).markAllRead('2026-10-21T10:30:00.000Z');
    await notificationsApi(client as never).markAllRead();
    expect(calls).toEqual([
      ['/notifications/read-all', { upTo: '2026-10-21T10:30:00.000Z' }],
      ['/notifications/read-all', undefined],
    ]);
  });
});
