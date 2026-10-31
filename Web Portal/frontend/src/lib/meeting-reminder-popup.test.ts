import { describe, it, expect } from 'vitest';
import { MAX_POPUPS, popupsAfter, popupsWithout, readLiveNotification } from './meeting-reminder-popup';

const n = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: 'MEETING_REMINDER', title: `Meeting in 15 minutes: ${id}`, body: '09:00–10:00', entityType: 'meeting', entityId: `m-${id}`, createdAt: '2026-10-31T04:45:00.000Z', readAt: null, ...over,
});

describe('the live meeting reminder pop-ups', () => {
  it('reads the server’s notification:new payload (anything else is ignored)', () => {
    expect(readLiveNotification(n('a'))).toMatchObject({ id: 'a', type: 'MEETING_REMINDER', entityId: 'm-a', readAt: null });
    expect(readLiveNotification({ id: 'x' })).toBeNull();
    expect(readLiveNotification(null)).toBeNull();
    expect(readLiveNotification('nope')).toBeNull();
  });

  it('pops up meeting reminders only, newest first; a newer one for the same meeting replaces the older', () => {
    let list = popupsAfter([], readLiveNotification(n('a'))!);
    list = popupsAfter(list, readLiveNotification(n('chat', { type: 'CHAT_MESSAGE' }))!);
    list = popupsAfter(list, readLiveNotification(n('b'))!);
    expect(list.map((x) => x.id)).toEqual(['b', 'a']);
    list = popupsAfter(list, readLiveNotification(n('a2', { entityId: 'm-a' }))!);
    expect(list.map((x) => x.id)).toEqual(['a2', 'b']);
    // The same notification twice (two events) stays one.
    expect(popupsAfter(list, list[0]!).map((x) => x.id)).toEqual(['a2', 'b']);
  });

  it('keeps at most three on the screen, and a dismissed one goes', () => {
    let list: ReturnType<typeof popupsAfter> = [];
    for (const id of ['a', 'b', 'c', 'd']) list = popupsAfter(list, readLiveNotification(n(id))!);
    expect(MAX_POPUPS).toBe(3);
    expect(list.map((x) => x.id)).toEqual(['d', 'c', 'b']);
    expect(popupsWithout(list, 'c').map((x) => x.id)).toEqual(['d', 'b']);
  });
});
