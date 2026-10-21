import { describe, it, expect } from 'vitest';
import {
  ALERTS_POLL_MS,
  ALERTS_REFRESH,
  createLauncherBadge,
  alertForPush,
  allRead,
  alertsBadge,
  alertsTabLabel,
  countAfterRead,
  launcherBadgeStep,
  markAllProblem,
  markedRead,
  trayIdsAbout,
  withPendingReads,
  serverCount,
  pushNotificationId,
  whenShown,
  listBehindCount,
  newestShown,
  allReadUpTo,
} from './alerts';
import { NetworkError, ApiError } from './api-client';
import type { ApiNotification } from './types';

const n = (id: string, readAt: string | null = null, extra: Partial<ApiNotification> = {}): ApiNotification => ({
  id,
  type: 'TASK_ASSIGNED',
  title: `Alert ${id}`,
  body: null,
  readAt,
  createdAt: '2026-10-21T08:00:00.000Z',
  ...extra,
});

describe('the Alerts tab number (5c), as on the website’s bell', () => {
  it('shows nothing at none, the count up to 99, then 99+', () => {
    expect(alertsBadge(0)).toBeUndefined();
    expect(alertsBadge(undefined)).toBeUndefined();
    expect(alertsBadge(null)).toBeUndefined();
    expect(alertsBadge(-2)).toBeUndefined();
    expect(alertsBadge(1)).toBe(1);
    expect(alertsBadge(99)).toBe(99);
    expect(alertsBadge(100)).toBe('99+');
  });

  it('is read out with the tab, like the bell’s “Notifications, 3 unread”', () => {
    expect(alertsTabLabel(3)).toBe('Alerts, 3 unread');
    expect(alertsTabLabel(1)).toBe('Alerts, 1 unread');
    expect(alertsTabLabel(0)).toBe('Alerts');
    expect(alertsTabLabel(undefined)).toBe('Alerts');
  });

  it('is asked of the server as often as the website asks (every 30 s, only while the app is in front)', () => {
    expect(ALERTS_POLL_MS).toBe(30_000);
  });
});

describe('the number on the app’s icon (5c)', () => {
  it('follows the server’s unread count, set only when it changes', () => {
    expect(launcherBadgeStep({ shown: null, next: 4 })).toBe(4);
    expect(launcherBadgeStep({ shown: 4, next: 4 })).toBeNull();
    expect(launcherBadgeStep({ shown: 4, next: 6 })).toBe(6);
    expect(launcherBadgeStep({ shown: 6, next: 0 })).toBe(0);
  });

  it('is left alone while the count isn’t known (offline, not loaded yet)', () => {
    expect(launcherBadgeStep({ shown: 3, next: undefined })).toBeNull();
    expect(launcherBadgeStep({ shown: null, next: null })).toBeNull();
  });

  it('isn’t cleared by an answer that may be older than a push that just came in', () => {
    // Clearing the number also takes the app's notifications off the phone: never the one just shown.
    expect(launcherBadgeStep({ shown: 2, next: 0, pushJustArrived: true })).toBeNull();
    expect(launcherBadgeStep({ shown: 2, next: 3, pushJustArrived: true })).toBe(3);
  });

  it('never goes below none, and caps nothing (the launcher draws its own “99+”)', () => {
    expect(launcherBadgeStep({ shown: 1, next: -1 })).toBe(0);
    expect(launcherBadgeStep({ shown: 1, next: 250 })).toBe(250);
  });
});

describe('the app icon’s number, kept for the whole run (5c)', () => {
  const make = () => {
    let t = 1_000_000;
    const set: number[] = [];
    const badge = createLauncherBadge({ set: async (n) => void set.push(n), now: () => t });
    return { badge, set, tick: (ms: number) => (t += ms) };
  };

  it('sets the server’s count once per change', () => {
    const { badge, set } = make();
    badge.count(3);
    badge.count(3);
    badge.count(undefined);
    badge.count(5);
    badge.count(0);
    expect(set).toEqual([3, 5, 0]);
  });

  it('doesn’t clear for ten seconds after a push came in (the answer may be older than it)', () => {
    const { badge, set, tick } = make();
    badge.count(2);
    badge.pushArrived();
    tick(3_000);
    badge.count(0);
    expect(set).toEqual([2]);
    tick(8_000);
    badge.count(0);
    expect(set).toEqual([2, 0]);
  });

  it('is cleared at sign-out, and the next person’s count is set afresh', () => {
    const { badge, set } = make();
    badge.count(4);
    badge.clear();
    badge.start(); // the next person signed in (5c review #5)
    badge.count(4);
    expect(set).toEqual([4, 0, 4]);
  });

  it('never throws when the phone can’t draw a number', async () => {
    const badge = createLauncherBadge({ set: () => Promise.reject(new Error('no launcher support')) });
    expect(() => badge.count(1)).not.toThrow();
    expect(() => badge.clear()).not.toThrow();
  });
});

describe('refreshing the alerts (5c)', () => {
  it('asks again for the list and the count only — not the notification settings under the same key', () => {
    expect(ALERTS_REFRESH).toEqual([
      { queryKey: ['notifications'], exact: true },
      { queryKey: ['notifications', 'unread'], exact: true },
    ]);
  });
});

describe('reading an alert (5c)', () => {
  it('shows it read at once, leaving the others and the same list when there is nothing to change', () => {
    const list = [n('a'), n('b'), n('c', '2026-10-20T10:00:00.000Z')];
    const next = markedRead(list, 'b', '2026-10-21T09:00:00.000Z')!;
    expect(next.map((x) => [x.id, x.readAt])).toEqual([
      ['a', null],
      ['b', '2026-10-21T09:00:00.000Z'],
      ['c', '2026-10-20T10:00:00.000Z'],
    ]);
    expect(next[0]).toBe(list[0]);
    expect(markedRead(list, 'c', '2026-10-21T09:00:00.000Z')).toBe(list);
    expect(markedRead(list, 'zz', '2026-10-21T09:00:00.000Z')).toBe(list);
    expect(markedRead(undefined, 'a', 'x')).toBeUndefined();
  });

  it('takes one off the unread count only when it was unread', () => {
    expect(countAfterRead(3, true)).toBe(2);
    expect(countAfterRead(3, false)).toBe(3);
    expect(countAfterRead(0, true)).toBe(0);
    expect(countAfterRead(undefined, true)).toBeUndefined();
  });

  it('a read kept on this phone to send later shows as read in the list (also from the offline copy)', () => {
    const list = [n('a'), n('b'), n('c')];
    const pending = [
      { kind: 'notification.read', payload: { id: 'b' }, createdAt: Date.parse('2026-10-21T09:30:00.000Z') },
      { kind: 'task.move', payload: { id: 'a', columnId: 'x' }, createdAt: 0 },
      { kind: 'notification.read', payload: { id: 42 }, createdAt: 0 },
    ];
    const shown = withPendingReads(list, pending);
    expect(shown.map((x) => [x.id, x.readAt])).toEqual([
      ['a', null],
      ['b', '2026-10-21T09:30:00.000Z'],
      ['c', null],
    ]);
    expect(withPendingReads(list, [])).toBe(list);
    expect(withPendingReads(list, [pending[1]!])).toBe(list);
  });
});

describe('a push opened from the phone’s notification list (5c)', () => {
  const list = [
    n('new', null, { entityType: 'task', entityId: 't1' }),
    n('older', null, { entityType: 'task', entityId: 't1' }),
    n('read', '2026-10-21T08:30:00.000Z', { entityType: 'task', entityId: 't2' }),
    n('other', null, { entityType: 'conversation', entityId: 'c1' }),
  ];
  it('reads the newest unread alert about the same thing — the one the push was for', () => {
    expect(alertForPush(list, { entityType: 'task', entityId: 't1' })?.id).toBe('new');
    expect(alertForPush(list, { entityType: 'TASK', entityId: 't1' })?.id).toBe('new');
    expect(alertForPush(list, { entityType: 'conversation', entityId: 'c1' })?.id).toBe('other');
  });
  it('reads nothing when that alert is already read, unknown, or the push names nothing', () => {
    expect(alertForPush(list, { entityType: 'task', entityId: 't2' })).toBeNull();
    expect(alertForPush(list, { entityType: 'task', entityId: 't9' })).toBeNull();
    expect(alertForPush(list, {})).toBeNull();
    expect(alertForPush(null, { entityType: 'task', entityId: 't1' })).toBeNull();
  });
});

describe('“Mark all read” done (5c)', () => {
  it('shows every alert read at once, keeping when the read ones were read', () => {
    const list = [n('a'), n('b', '2026-10-20T10:00:00.000Z')];
    expect(allRead(list, '2026-10-21T09:00:00.000Z')?.map((x) => x.readAt)).toEqual(['2026-10-21T09:00:00.000Z', '2026-10-20T10:00:00.000Z']);
    expect(allRead(undefined, 'x')).toBeUndefined();
  });
});

describe('the phone’s own notifications about one thing (5c)', () => {
  const shown = (identifier: string, data: Record<string, unknown> | null) => ({ request: { identifier, content: { data } } });

  it('are found by what they are about, whatever the case of the type', () => {
    const presented = [
      shown('1', { entityType: 'task', entityId: 't1' }),
      shown('2', { entityType: 'TASK', entityId: 't1' }),
      shown('3', { entityType: 'task', entityId: 't2' }),
      shown('4', { entityType: 'conversation', entityId: 't1' }),
      shown('5', null),
    ];
    expect(trayIdsAbout(presented, 'task', 't1')).toEqual(['1', '2']);
    expect(trayIdsAbout(presented, 'Task', 't2')).toEqual(['3']);
    expect(trayIdsAbout(presented, 'task', '')).toEqual([]);
    expect(trayIdsAbout(presented, '', 't1')).toEqual([]);
  });
});

describe('“Mark all read” that didn’t happen (5c)', () => {
  it('says it needs a connection when there is none (it isn’t kept for later: it would also mark alerts not seen yet)', () => {
    expect(markAllProblem(new NetworkError('offline'))).toBe('Marking all as read needs a connection. Try again when you’re back online.');
  });
  it('otherwise asks to try again', () => {
    expect(markAllProblem(new ApiError(500, 'ERROR', 'boom'))).toBe('Couldn’t mark everything as read. Please try again.');
  });
});

describe('the app icon’s number never sticks, follows only the server, and is the next person’s alone (5c review)', () => {
  const make = () => {
    let t = 1_000_000;
    const set: number[] = [];
    const timers: { at: number; fn: () => void }[] = [];
    const badge = createLauncherBadge({ set: async (n) => void set.push(n), now: () => t, later: (fn, ms) => void timers.push({ at: t + ms, fn }) });
    const tick = (ms: number) => {
      t += ms;
      for (const timer of timers.splice(0).filter((x) => (x.at <= t ? (x.fn(), false) : true))) timers.push(timer);
    };
    return { badge, set, tick, timers };
  };

  it('a “none” held back just after a push is put on the icon when the quiet time ends (#1)', () => {
    const { badge, set, tick } = make();
    badge.count(1);
    badge.pushArrived();
    tick(2_000);
    badge.count(0); // the push was read at once: held, not lost
    expect(set).toEqual([1]);
    tick(8_100);
    expect(set).toEqual([1, 0]);
  });

  it('a held “none” isn’t put on the icon when a newer count came meanwhile', () => {
    const { badge, set, tick } = make();
    badge.count(1);
    badge.pushArrived();
    badge.count(0);
    tick(1_000);
    badge.count(2);
    tick(10_000);
    expect(set).toEqual([1, 2]);
  });

  it('coming back to the app starts the same quiet time (a push while away wasn’t heard) (#3)', () => {
    const { badge, set, tick } = make();
    badge.count(3);
    badge.resumed();
    badge.count(0);
    expect(set).toEqual([3]);
    tick(10_100);
    expect(set).toEqual([3, 0]);
  });

  it('after sign-out no count reaches the icon until the next person is signed in (#5)', () => {
    const { badge, set, tick } = make();
    badge.count(4);
    badge.pushArrived();
    badge.count(0); // held
    badge.clear();
    badge.count(4); // a poll still on its way for the person who left
    tick(20_000); // the held "none" isn't applied for them either
    expect(set).toEqual([4, 0]);
    badge.start();
    badge.count(2);
    expect(set).toEqual([4, 0, 2]);
  });

  // 6b review: sign-out clears the icon, turns push off (which can take seconds, and sign-out moves
  // on after its time limit), then clears it again. A second clear that comes after the next
  // sign-in must not switch that person's number off.
  it('a sign-out’s late second clear leaves the next person’s number alone (6b review)', () => {
    const { badge, set } = make();
    badge.count(4);
    const signOut = badge.clear(); // signing out…
    badge.start(); // …someone signed in before the push was off
    badge.count(2);
    badge.clear(signOut); // the sign-out's second clear, late
    badge.count(3);
    expect(set).toEqual([4, 0, 2, 3]);
  });

  it('a sign-out’s second clear in time clears again, and nothing reaches the icon until the next sign-in', () => {
    const { badge, set } = make();
    badge.count(4);
    const signOut = badge.clear();
    badge.count(4); // a poll still on its way
    badge.clear(signOut);
    badge.count(5);
    expect(set).toEqual([4, 0, 0]);
    badge.start();
    badge.count(1);
    expect(set).toEqual([4, 0, 0, 1]);
  });

  it('only the server’s own answers to the count move the icon — not the app’s quick local updates (#3)', () => {
    const query = (key: unknown[], data: unknown) => ({ queryKey: key, state: { data } });
    const fetched = { type: 'updated', action: { type: 'success' }, query: query(['notifications', 'unread'], { count: 2 }) };
    expect(serverCount(fetched)).toBe(2);
    expect(serverCount({ ...fetched, action: { type: 'success', manual: true } })).toBeUndefined();
    expect(serverCount({ ...fetched, action: { type: 'error' } })).toBeUndefined();
    expect(serverCount({ ...fetched, query: query(['notifications'], []) })).toBeUndefined();
    expect(serverCount({ ...fetched, query: query(['notifications', 'unread'], undefined) })).toBeUndefined();
    expect(serverCount({ type: 'added', query: fetched.query })).toBeUndefined();
  });
});

describe('a tapped push reads exactly its alert, and only once the app is shown (5c review #2, #8)', () => {
  it('takes the alert’s id from the push (servers since this fix); an id that isn’t one is ignored', () => {
    expect(pushNotificationId({ entityType: 'task', entityId: 't1', notificationId: 'cmg1n0001' })).toBe('cmg1n0001');
    expect(pushNotificationId({ entityType: 'task', entityId: 't1' })).toBeNull();
    expect(pushNotificationId({ notificationId: '../read-all' })).toBeNull();
    expect(pushNotificationId({ notificationId: 42 })).toBeNull();
  });

  it('waits while the fingerprint lock covers the app, then reads once', () => {
    let covered = true;
    const listeners = new Set<() => void>();
    const gate = { covered: () => covered, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) };
    const tell = () => [...listeners].forEach((l) => l());
    const ran: string[] = [];
    whenShown(gate, () => ran.push('read'));
    tell();
    expect(ran).toEqual([]);
    covered = false;
    tell();
    tell();
    expect(ran).toEqual(['read']);
    expect(listeners.size).toBe(0);
    whenShown(gate, () => ran.push('at once'));
    expect(ran).toEqual(['read', 'at once']);
  });

  it('can be called off before it runs (signed out meanwhile)', () => {
    let covered = true;
    const listeners = new Set<() => void>();
    const gate = { covered: () => covered, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) };
    const ran: string[] = [];
    const cancel = whenShown(gate, () => ran.push('read'));
    cancel();
    covered = false;
    [...listeners].forEach((l) => l());
    expect(ran).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});

describe('the Alerts list keeps up with the tab’s number (5c review #11)', () => {
  it('a higher count from the server (no push heard) means newer alerts: the list is asked for again', () => {
    expect(listBehindCount(undefined, 2)).toBe(false);
    expect(listBehindCount(2, 3)).toBe(true);
    expect(listBehindCount(3, 3)).toBe(false);
    expect(listBehindCount(3, 1)).toBe(false);
  });
});

describe('“Mark all read” reads only what was shown (5c review #9)', () => {
  const list = [
    n('new', null, { createdAt: '2026-10-21T10:30:00.000Z' }),
    n('old', null, { createdAt: '2026-10-21T08:00:00.000Z' }),
    n('read', '2026-10-21T09:00:00.000Z', { createdAt: '2026-10-21T07:00:00.000Z' }),
  ];

  it('sends the newest alert’s time; none shown, none sent', () => {
    expect(newestShown(list)).toBe('2026-10-21T10:30:00.000Z');
    expect(newestShown([])).toBeUndefined();
    expect(newestShown(undefined)).toBeUndefined();
  });

  it('shows read only what came in by then: one that arrived after stays unread', () => {
    const later = [n('newer', null, { createdAt: '2026-10-21T11:00:00.000Z' }), ...list];
    const after = allReadUpTo(later, '2026-10-21T11:05:00.000Z', '2026-10-21T10:30:00.000Z');
    expect(after?.map((x) => [x.id, x.readAt])).toEqual([
      ['newer', null],
      ['new', '2026-10-21T11:05:00.000Z'],
      ['old', '2026-10-21T11:05:00.000Z'],
      ['read', '2026-10-21T09:00:00.000Z'],
    ]);
    expect(allReadUpTo(later, 'x', undefined)?.every((a) => a.readAt)).toBe(true);
  });
});
