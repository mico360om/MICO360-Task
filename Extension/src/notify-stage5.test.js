import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fakeStorage, jsonRes } from './test-helpers.js';
import {
  NOTIFICATION_TYPES, REMINDER_OPTIONS, readAlertSettings, saveAlertSettings, newestUnread, alertContent, NOTIFICATION_ID, ALERT_TARGET_KEY, DESKTOP_ALERTS_KEY,
} from './notify.js';
import { pollNotifications, openAlert } from './background-poll.js';
import { USER_DATA_KEYS } from './session.js';

// Stage 5: the desktop alert can say what the newest notification is about (a setting, off until
// chosen), it opens that notification's item, and Settings has the web's notification preferences.

describe('notification preferences: the web’s list', () => {
  it('the six kinds of notification and the reminder times, worded as on the web', () => {
    expect(NOTIFICATION_TYPES.map((t) => t.type)).toEqual(['TASK_ASSIGNED', 'TASK_STATUS', 'TASK_COMMENT', 'MENTION', 'TASK_DUE_SOON', 'TASK_OVERDUE']);
    expect(NOTIFICATION_TYPES[0]).toEqual({ type: 'TASK_ASSIGNED', label: 'Task assignments', desc: 'When a task is assigned to you' });
    expect(REMINDER_OPTIONS.map((o) => o.value)).toEqual([null, 0, 60, 240, 1440, 2880, 10080]);
    expect(REMINDER_OPTIONS[0].label).toBe('Default (1 day)');
  });

  const page = resolve(__dirname, '../../Web Portal/frontend/src/pages/SettingsPage.tsx');
  it.skipIf(!existsSync(page))('the same as the web’s Settings page (pages/SettingsPage.tsx)', () => {
    const src = readFileSync(page, 'utf8');
    for (const t of NOTIFICATION_TYPES) expect(src, t.type).toContain(`{ type: '${t.type}', label: '${t.label}', desc: '${t.desc}' }`);
    for (const o of REMINDER_OPTIONS) expect(src, o.label).toContain(`{ label: '${o.label}', value: ${o.value === null ? 'null' : o.value} }`);
  });
});

describe('desktop alert settings (this device)', () => {
  it('alerts on, without saying what they’re about, until chosen; kept per device and cleared on sign-out', async () => {
    const local = fakeStorage();
    expect(await readAlertSettings(local)).toEqual({ on: true, details: false });
    await saveAlertSettings(local, { details: true });
    expect(await readAlertSettings(local)).toEqual({ on: true, details: true });
    await saveAlertSettings(local, { on: false });
    expect(await readAlertSettings(local)).toEqual({ on: false, details: true });
    expect(USER_DATA_KEYS).toContain(DESKTOP_ALERTS_KEY); // the next person on this device starts private
  });
});

describe('what the desktop alert says', () => {
  const list = [
    { id: 'n1', title: 'Old', body: null, readAt: null, createdAt: '2026-10-21T08:00:00Z' },
    { id: 'n2', title: 'Omar sent you a message', body: 'Pump is fixed', readAt: null, createdAt: '2026-10-21T09:00:00Z', entityType: 'conversation', entityId: 'c1' },
    { id: 'n3', title: 'Read one', body: null, readAt: '2026-10-21T09:30:00Z', createdAt: '2026-10-21T09:30:00Z' },
  ];

  it('the newest unread notification', () => {
    expect(newestUnread(list).id).toBe('n2');
    expect(newestUnread([])).toBeNull();
    expect(newestUnread(null)).toBeNull();
  });

  it('only how many are new — not the total — unless it may say what the newest is about', () => {
    expect(alertContent({ fresh: 2, newest: list[1], details: false })).toEqual({ title: 'MICO360 Tasks', message: 'You have 2 new notifications' });
    expect(alertContent({ fresh: 1, newest: null, details: true })).toEqual({ title: 'MICO360 Tasks', message: 'You have 1 new notification' });
    expect(alertContent({ fresh: 1, newest: list[1], details: true })).toEqual({ title: 'Omar sent you a message', message: 'Pump is fixed', contextMessage: 'MICO360 Tasks' });
    // Chrome needs words in every alert: one with no text of its own says what a click does.
    expect(alertContent({ fresh: 3, newest: list[0], details: true })).toEqual({ title: 'Old', message: 'Click to open it.', contextMessage: 'And 2 more new notifications' });
    expect(alertContent({ fresh: 2, newest: list[0], details: true }).contextMessage).toBe('And 1 more new notification');
  });
});

/** A stand-in server for the worker's poll: answers by path; records what was sent. */
function server(routes) {
  const calls = [];
  const authedFetch = vi.fn(async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET' });
    const r = routes[`${init.method || 'GET'} ${path}`];
    if (r instanceof Error) throw r;
    return r === undefined ? jsonRes({ error: { code: 'NOT_FOUND' } }, 404) : jsonRes(r, 200);
  });
  return { authedFetch, calls };
}

describe('the background poll', () => {
  const deps = ({ local, ...over } = {}) => ({
    local: fakeStorage({ lastUnread: 1, lastUnreadUser: 'me', ...local }),
    session: fakeStorage(),
    notifications: { create: vi.fn() },
    setBadge: vi.fn(),
    userId: 'me',
    ...over,
  });

  it('a new notification: the badge, an alert with how many are new, nothing about what it says', async () => {
    const { authedFetch, calls } = server({ 'GET /notifications/unread-count': { data: { count: 3 } }, 'GET /conversations': { data: [] } });
    const d = deps({ authedFetch });
    await pollNotifications(d);
    expect(d.setBadge).toHaveBeenCalledWith(3);
    expect(d.notifications.create).toHaveBeenCalledWith(NOTIFICATION_ID, expect.objectContaining({ type: 'basic', title: 'MICO360 Tasks', message: 'You have 2 new notifications' }));
    expect(calls.map((c) => c.path)).not.toContain('/notifications'); // the list isn't read when the alert can't say what it is
    expect(d.local.data.lastUnread).toBe(3);
    expect(d.session.data[ALERT_TARGET_KEY]).toBeNull();
  });

  it('allowed to say what it is about: the newest one’s title and words, and a click will open it', async () => {
    const { authedFetch } = server({
      'GET /notifications/unread-count': { data: { count: 2 } },
      'GET /notifications': { data: [{ id: 'n2', title: 'Omar sent you a message', body: 'Pump is fixed', readAt: null, createdAt: '2026-10-21T09:00:00Z', entityType: 'conversation', entityId: 'c1' }] },
      'GET /conversations': { data: [] },
    });
    const d = deps({ authedFetch, local: { [DESKTOP_ALERTS_KEY]: { on: true, details: true } } });
    await pollNotifications(d);
    expect(d.notifications.create).toHaveBeenCalledWith(NOTIFICATION_ID, expect.objectContaining({ title: 'Omar sent you a message', message: 'Pump is fixed', contextMessage: 'MICO360 Tasks' }));
    expect(d.session.data[ALERT_TARGET_KEY]).toEqual({ id: 'n2', entityType: 'conversation', entityId: 'c1', userId: 'me' });
  });

  it('alerts switched off: the badge only', async () => {
    const { authedFetch } = server({ 'GET /notifications/unread-count': { data: { count: 5 } }, 'GET /conversations': { data: [] } });
    const d = deps({ authedFetch, local: { [DESKTOP_ALERTS_KEY]: { on: false, details: false } } });
    await pollNotifications(d);
    expect(d.setBadge).toHaveBeenCalledWith(5);
    expect(d.notifications.create).not.toHaveBeenCalled();
  });

  it('no alert without a rise, or on the first poll for this person', async () => {
    const same = server({ 'GET /notifications/unread-count': { data: { count: 1 } } });
    const d1 = deps({ authedFetch: same.authedFetch });
    await pollNotifications(d1);
    expect(d1.notifications.create).not.toHaveBeenCalled();
    const first = server({ 'GET /notifications/unread-count': { data: { count: 4 } } });
    const d2 = deps({ authedFetch: first.authedFetch, local: { lastUnreadUser: 'someone-else' } });
    await pollNotifications(d2);
    expect(d2.notifications.create).not.toHaveBeenCalled();
    expect(d2.local.data).toMatchObject({ lastUnread: 4, lastUnreadUser: 'me' });
  });

  it('something new arrived: tells the server which direct messages reached this device (the sender sees “Delivered”)', async () => {
    const last = { id: 'm9', userId: 'omar', body: 'hi', createdAt: '2026-10-21T09:00:00Z', deletedAt: null };
    const { authedFetch, calls } = server({
      'GET /notifications/unread-count': { data: { count: 2 } },
      'GET /conversations': { data: [
        { conversation: { id: 'c1', kind: 'DIRECT' }, participants: [{ userId: 'me', lastReadAt: null, lastDeliveredAt: null }, { userId: 'omar' }], unread: 1, lastMessage: last },
        { conversation: { id: 'c2', kind: 'DIRECT' }, participants: [{ userId: 'me', lastReadAt: '2026-10-21T10:00:00Z' }, { userId: 'aisha' }], unread: 0, lastMessage: { ...last, id: 'm8' } },
      ] },
      'POST /conversations/c1/delivered': {},
    });
    await pollNotifications(deps({ authedFetch }));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/conversations/c1/delivered']);
  });

  it('offline: nothing changes, nothing is thrown', async () => {
    const authedFetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const d = deps({ authedFetch });
    await expect(pollNotifications(d)).resolves.toBeNull();
    expect(d.setBadge).not.toHaveBeenCalled();
    expect(d.local.data.lastUnread).toBe(1);
  });
});

describe('a click on the desktop alert', () => {
  it('one that said what it was about opens its item and marks it read', async () => {
    const session = fakeStorage({ [ALERT_TARGET_KEY]: { id: 'n2', entityType: 'task', entityId: 't7', userId: 'me' } });
    const open = vi.fn();
    const openUrl = vi.fn();
    const markRead = vi.fn(async () => {});
    await openAlert({ session, open, openUrl, markRead, appBase: 'https://task.mico360.com', userId: 'me' });
    expect(open).toHaveBeenCalledWith('#/task/t7');
    expect(markRead).toHaveBeenCalledWith('n2');
    expect(session.data[ALERT_TARGET_KEY]).toBeUndefined();
  });

  it('a meeting opens its page here (Stage 6); a notification about nothing in particular opens Notifications', async () => {
    const open = vi.fn();
    const openUrl = vi.fn();
    await openAlert({ session: fakeStorage({ [ALERT_TARGET_KEY]: { id: 'n3', entityType: 'meeting', entityId: 'mt1', userId: 'me' } }), open, openUrl, markRead: vi.fn(async () => {}), appBase: 'https://task.mico360.com/', userId: 'me' });
    expect(open).toHaveBeenCalledWith('#/meeting/mt1');
    expect(openUrl).not.toHaveBeenCalled();
    await openAlert({ session: fakeStorage({ [ALERT_TARGET_KEY]: { id: 'n4', entityType: 'project', entityId: 'p1', userId: 'me' } }), open, openUrl, markRead: vi.fn(async () => {}), appBase: '', userId: 'me' });
    expect(open).toHaveBeenLastCalledWith('#/notifications');
    await openAlert({ session: fakeStorage(), open, openUrl, markRead: vi.fn(), appBase: '', userId: 'me' });
    expect(open).toHaveBeenLastCalledWith('#/notifications');
  });

  it('an alert kept for someone who has since signed out opens only Notifications', async () => {
    const open = vi.fn();
    const markRead = vi.fn();
    await openAlert({ session: fakeStorage({ [ALERT_TARGET_KEY]: { id: 'n2', entityType: 'task', entityId: 't7', userId: 'someone-else' } }), open, openUrl: vi.fn(), markRead, appBase: '', userId: 'me' });
    expect(open).toHaveBeenCalledWith('#/notifications');
    expect(markRead).not.toHaveBeenCalled();
  });
});
