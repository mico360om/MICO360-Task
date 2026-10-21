import { describe, it, expect, vi } from 'vitest';
import { createApi } from './api.js';
import { createReadCache } from './read-cache.js';
import { applyPending } from './pending-overlay.js';
import { meetingsListParams, upNextListParams, rowInvitation } from './meetings.js';
import { fakeStorage } from './test-helpers.js';

// Fixes from the review of Stage 6: ranged meeting reads, your answer on the list rows, and the
// saved copies after an answer.
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => 'application/json' } });
const AT = new Date('2026-10-21T06:30:00.000Z'); // 10:30 on Wed 21 Oct in Muscat

describe('review fix #2: which meetings a list asks for', () => {
  it('Meetings: from the start of today in company time (the server then lists them soonest first)', () => {
    expect(meetingsListParams('Asia/Muscat', AT)).toEqual({ from: '2026-10-20T20:00:00.000Z' });
  });

  it('the Dashboard’s Up next: the two weeks from the start of today', () => {
    expect(upNextListParams('Asia/Muscat', AT)).toEqual({ from: '2026-10-20T20:00:00.000Z', to: '2026-11-03T20:00:00.000Z' });
  });
});

describe('review fix #5: your row from the list itself (a newer server)', () => {
  it('myAttendeeId and myResponse make your invitation; null when you aren’t on it; undefined from an older server', () => {
    expect(rowInvitation({ id: 'm1', myAttendeeId: 'a1', myResponse: 'TENTATIVE' }, 'me')).toEqual({ id: 'a1', userId: 'me', response: 'TENTATIVE' });
    expect(rowInvitation({ id: 'm1', myAttendeeId: 'a1', myResponse: null, myPending: true }, 'me')).toEqual({ id: 'a1', userId: 'me', response: 'PENDING', pending: true });
    expect(rowInvitation({ id: 'm1', myAttendeeId: null, myResponse: null }, 'me')).toBeNull();
    expect(rowInvitation({ id: 'm1' }, 'me')).toBeUndefined();
  });

  it('your answer waiting to sync shows on the list’s rows (H3), marked as waiting', () => {
    const rows = [{ id: 'm1', myAttendeeId: 'a1', myResponse: 'PENDING' }, { id: 'm2', myAttendeeId: 'a9', myResponse: 'ACCEPTED' }, { id: 'm3', title: 'older server' }];
    const items = [
      { id: 'q1', kind: 'meeting.respond', status: 'pending', payload: { meetingId: 'm1', attendeeId: 'a1', response: 'DECLINED' } },
      { id: 'q2', kind: 'meeting.respond', status: 'pending', payload: { meetingId: 'm2', attendeeId: 'someone-else', response: 'DECLINED' } },
    ];
    const r = applyPending('meetings:?from=2026-10-20T20%3A00%3A00.000Z', rows, items);
    expect(r.applied).toBe(1);
    expect(r.data[0]).toMatchObject({ myResponse: 'DECLINED', myPending: true });
    expect(r.data[1]).toEqual(rows[1]);
    expect(r.data[2]).toEqual(rows[2]);
  });
});

describe('review fix #6: an answer the server took is kept in the saved copies', () => {
  it('the meeting’s people and today’s lists say it too — only copies already saved are touched', async () => {
    const store = fakeStorage();
    const people = [{ id: 'a1', userId: 'me', response: 'PENDING' }, { id: 'a2', userId: 'u2', response: 'ACCEPTED' }];
    const routes = {
      '/meetings/m1/attendees': people,
      [`/meetings?from=${encodeURIComponent('2026-10-20T20:00:00.000Z')}`]: [{ id: 'm1', myAttendeeId: 'a1', myResponse: 'PENDING' }, { id: 'm2', myAttendeeId: 'a5', myResponse: 'PENDING' }],
    };
    const auth = { authedFetch: vi.fn(async (path) => json({ data: routes[path] ?? [] })) };
    const api = createApi({ auth, cache: createReadCache(store) });
    vi.useFakeTimers({ now: AT, toFake: ['Date'] });
    try {
      await api.meetings.attendees('m1');
      await api.meetings.list(meetingsListParams('Asia/Muscat', AT));
      await api.meetings.rememberAnswer({ meetingId: 'm1', attendeeId: 'a1', response: 'ACCEPTED', timeZone: 'Asia/Muscat' });
    } finally {
      vi.useRealTimers();
    }
    expect(store.data['cache:meeting-attendees:m1'].data.map((a) => a.response)).toEqual(['ACCEPTED', 'ACCEPTED']);
    const list = store.data[`cache:meetings:?from=${encodeURIComponent('2026-10-20T20:00:00.000Z')}`].data;
    expect(list.map((m) => m.myResponse)).toEqual(['ACCEPTED', 'PENDING']);
    // The Dashboard's list was never read here: nothing is saved for it.
    expect(Object.keys(store.data).filter((k) => k.startsWith('cache:meetings:') && k.includes('to='))).toEqual([]);
  });

  it('never throws (storage that fails, nothing saved)', async () => {
    const broken = { get: async () => { throw new Error('gone'); }, set: async () => { throw new Error('gone'); }, remove: async () => {} };
    const api = createApi({ auth: { authedFetch: vi.fn() }, cache: createReadCache(broken) });
    await expect(api.meetings.rememberAnswer({ meetingId: 'm1', attendeeId: 'a1', response: 'ACCEPTED', timeZone: 'Asia/Muscat' })).resolves.toBeUndefined();
  });
});
