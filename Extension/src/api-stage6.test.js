import { describe, it, expect, vi } from 'vitest';
import { createApi } from './api.js';
import { createReadCache } from './read-cache.js';
import { fakeStorage } from './test-helpers.js';

// Stage 6: search, the calendar, your date settings and meetings.
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => 'application/json' } });

function setup({ pending } = {}) {
  const store = fakeStorage();
  let online = true;
  const calls = [];
  const auth = {
    authedFetch: vi.fn(async (path, init) => {
      calls.push({ path, init });
      if (!online) throw new TypeError('Failed to fetch');
      return json({ data: { path } });
    }),
  };
  const api = createApi({ auth, cache: createReadCache(store), pending });
  return { api, store, calls, offline: () => { online = false; } };
}

describe('api.search', () => {
  it('asks GET /search with the words encoded, fresh every time (never kept on the device)', async () => {
    const { api, store, calls } = setup();
    expect(await api.search('rig & valves/2')).toEqual({ path: '/search?q=rig%20%26%20valves%2F2' });
    expect(calls).toHaveLength(1);
    expect(Object.keys(store.data).filter((k) => k.startsWith('cache:'))).toEqual([]);
  });
});

describe('api.calendar and api.preferences', () => {
  it('reads one visible range of the calendar, kept for offline', async () => {
    const { api, offline } = setup();
    expect(await api.calendar('2026-09-27', '2026-11-07')).toMatchObject({ data: { path: '/calendar?from=2026-09-27&to=2026-11-07' }, stale: false });
    offline();
    expect(await api.calendar('2026-09-27', '2026-11-07')).toMatchObject({ stale: true, data: { path: '/calendar?from=2026-09-27&to=2026-11-07' } });
  });

  it('reads your own date settings (week start, time zone), kept for offline', async () => {
    const { api, offline } = setup();
    expect(await api.preferences()).toMatchObject({ data: { path: '/users/me/preferences' } });
    offline();
    expect(await api.preferences()).toMatchObject({ stale: true });
  });
});

describe('api.meetings', () => {
  it('lists meetings (a range, or those you organize), one meeting, its people and its agenda — all kept for offline', async () => {
    const { api, offline } = setup();
    expect((await api.meetings.list()).data.path).toBe('/meetings');
    expect((await api.meetings.list({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' })).data.path)
      .toBe('/meetings?from=2026-10-01T00%3A00%3A00.000Z&to=2026-11-01T00%3A00%3A00.000Z');
    expect((await api.meetings.list({ mine: true })).data.path).toBe('/meetings?mine=true');
    expect((await api.meetings.get('m/1')).data.path).toBe('/meetings/m%2F1');
    expect((await api.meetings.attendees('m1')).data.path).toBe('/meetings/m1/attendees');
    expect((await api.meetings.agenda('m1')).data.path).toBe('/meetings/m1/agenda');
    offline();
    expect(await api.meetings.get('m/1')).toMatchObject({ stale: true });
    expect(await api.meetings.attendees('m1')).toMatchObject({ stale: true });
  });

  it('your answer waiting to sync shows on the meeting’s people (H3)', async () => {
    const store = fakeStorage();
    const people = [{ id: 'a1', userId: 'me', response: 'PENDING' }, { id: 'a2', userId: 'u2', response: 'ACCEPTED' }];
    const auth = { authedFetch: vi.fn(async () => json({ data: people })) };
    const pending = async () => [{ id: 'q1', kind: 'meeting.respond', userId: 'me', status: 'pending', payload: { meetingId: 'm1', attendeeId: 'a1', response: 'TENTATIVE' } }];
    const api = createApi({ auth, cache: createReadCache(store), pending });
    const r = await api.meetings.attendees('m1');
    expect(r.pending).toBe(1);
    expect(r.data.map((a) => a.response)).toEqual(['TENTATIVE', 'ACCEPTED']);
    expect(store.data['cache:meeting-attendees:m1'].data[0].response).toBe('PENDING'); // the saved copy stays the server's
  });
});
