// @vitest-environment jsdom
/**
 * "Mark all as read" stops at the newest notification shown: POST /notifications/read-all with
 * `{ upTo }` (the newest one's createdAt), so a notification that comes in after the person looked —
 * or before an offline "Mark all" is replayed — stays unread. The time is kept in the queued change,
 * so a replay sends the same one. A server from before `upTo` ignores the body and reads them all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationsScreen } from '../app/screens/notifications.js';
import { mutationRequest, sendOrQueue, flushQueue, makePerformMutation, getQueue } from './queue.js';
import { applyPending } from './pending-overlay.js';
import { fakeStorage, jsonRes } from './test-helpers.js';

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((n) => n.textContent.trim() === text);

beforeEach(() => {
  document.body.innerHTML = '';
});

function screenCtx(list, write = vi.fn(async () => ({ queued: false }))) {
  return {
    appBase: 'https://task.mico360.com',
    api: { notifications: { list: vi.fn(async () => ({ data: list.map((n) => ({ ...n })) })) } },
    write,
    afterMutation: vi.fn(),
    navigate: vi.fn(),
    openTask: vi.fn(),
    openExternal: vi.fn(),
  };
}

const SHOWN = [
  { id: 'n1', title: 'You were assigned a task', readAt: null, entityType: 'task', entityId: 't1', createdAt: '2026-10-21T08:00:00.000Z' },
  { id: 'n2', title: 'New message', readAt: null, entityType: 'conversation', entityId: 'cv1', createdAt: '2026-10-21T09:30:00.000Z' },
  { id: 'n3', title: 'Meeting tomorrow', readAt: '2026-10-21T09:45:00.000Z', entityType: 'meeting', entityId: 'm1', createdAt: '2026-10-21T07:00:00.000Z' },
];

describe('“Mark all as read” stops at the newest notification shown', () => {
  it('sends the newest one’s time (whatever order the list is in)', async () => {
    const ctx = screenCtx([SHOWN[0], SHOWN[2], SHOWN[1]]);
    const root = NotificationsScreen(ctx);
    document.body.append(root);
    await settle();
    byText(root, 'button', 'Mark all as read').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('notification.readAll', { upTo: '2026-10-21T09:30:00.000Z' });
    expect(root.querySelectorAll('.nrow.unread')).toHaveLength(0);
  });

  it('no time to go by (an older server’s list): it reads them all, as before', async () => {
    const ctx = screenCtx(SHOWN.map(({ createdAt, ...n }) => n));
    const root = NotificationsScreen(ctx);
    document.body.append(root);
    await settle();
    byText(root, 'button', 'Mark all as read').click();
    await settle();
    expect(ctx.write).toHaveBeenCalledWith('notification.readAll', {});
  });

  it('the request carries the time; without one the body is empty (read everything)', () => {
    const r = mutationRequest({ kind: 'notification.readAll', payload: { upTo: '2026-10-21T09:30:00.000Z' }, idempotencyKey: 'k-1' });
    expect(r.path).toBe('/notifications/read-all');
    expect(JSON.parse(r.init.body)).toEqual({ upTo: '2026-10-21T09:30:00.000Z' });
    expect(JSON.parse(mutationRequest({ kind: 'notification.readAll', payload: {} }).init.body)).toEqual({});
    // A time the server would refuse (400) is never sent: then everything is read, as before.
    expect(JSON.parse(mutationRequest({ kind: 'notification.readAll', payload: { upTo: 'yesterday' } }).init.body)).toEqual({});
  });

  it('kept offline, it replays later with the same time (one that came in since stays unread)', async () => {
    const storage = fakeStorage();
    const r = await sendOrQueue({ kind: 'notification.readAll', payload: { upTo: '2026-10-21T09:30:00.000Z' } }, {
      doFetch: async () => { throw new TypeError('Failed to fetch'); }, storage, userId: 'me',
    });
    expect(r.queued).toBe(true);
    expect((await getQueue(storage))[0].payload).toEqual({ upTo: '2026-10-21T09:30:00.000Z' });
    const sent = [];
    const doFetch = vi.fn(async (path, init) => { sent.push({ path, body: JSON.parse(init.body) }); return jsonRes({ data: { ok: true } }); });
    await flushQueue(storage, makePerformMutation(doFetch), { userId: 'me' });
    expect(sent).toEqual([{ path: '/notifications/read-all', body: { upTo: '2026-10-21T09:30:00.000Z' } }]);
  });

  it('while it waits to sync, the list shows read only what came in by then', () => {
    const waiting = { id: 'q1', kind: 'notification.readAll', payload: { upTo: '2026-10-21T09:30:00.000Z' }, userId: 'me', status: 'pending', queuedAt: Date.parse('2026-10-21T10:00:00.000Z') };
    const later = { id: 'n4', title: 'Another', readAt: null, createdAt: '2026-10-21T09:50:00.000Z' };
    const { data } = applyPending('notifications', [...SHOWN, later], [waiting]);
    expect(data.map((n) => [n.id, Boolean(n.readAt)])).toEqual([['n1', true], ['n2', true], ['n3', true], ['n4', false]]);
  });
});
