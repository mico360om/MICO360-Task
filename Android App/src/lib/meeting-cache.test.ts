import { describe, it, expect, afterEach, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { ApiError, NetworkError } from './api-client';
import { afterMeetingDeleted, afterMeetingSaved, afterPartChanged, answerFailed, answerScope, dropRow, noteTaskRefreshes, patchRow, putRow } from './meeting-cache';
import type { ApiMeeting, ApiMeetingAttendee } from './types';

const person = (id: string, over: Partial<ApiMeetingAttendee> = {}): ApiMeetingAttendee => ({
  id,
  meetingId: 'm1',
  userId: `u-${id}`,
  externalName: null,
  externalEmail: null,
  role: 'REQUIRED',
  attendance: 'INVITED',
  response: 'PENDING',
  respondedAt: null,
  department: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const clients: QueryClient[] = [];
afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
});

function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  clients.push(qc);
  return qc;
}

const PEOPLE = ['meeting', 'm1', 'attendees'];
const invalidated = (qc: QueryClient, key: string[]) => qc.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated ?? false;

describe('a refused or unanswered answer to the invitation', () => {
  it('puts my old answer back and loads the people again', () => {
    const qc = client();
    qc.setQueryData(['meeting', 'm1'], { id: 'm1' });
    qc.setQueryData(PEOPLE, [person('me', { response: 'ACCEPTED', respondedAt: '2026-10-21T08:00:00.000Z' }), person('b')]);
    answerFailed(qc, { meetingId: 'm1', previous: person('me'), error: new ApiError(400, 'VALIDATION', 'No') });
    expect(qc.getQueryData<ApiMeetingAttendee[]>(PEOPLE)?.[0]).toMatchObject({ id: 'me', response: 'PENDING', respondedAt: null });
    expect(invalidated(qc, PEOPLE)).toBe(true);
    expect(invalidated(qc, ['meeting', 'm1'])).toBe(false);
  });

  it('keeps a newer list that arrived while the answer was on its way (only my row goes back)', () => {
    const qc = client();
    // The list loaded again (a live event) while my answer was being sent: someone else declined.
    qc.setQueryData(PEOPLE, [person('me', { response: 'ACCEPTED' }), person('b', { response: 'DECLINED' }), person('c')]);
    answerFailed(qc, { meetingId: 'm1', previous: person('me', { response: 'TENTATIVE', respondedAt: '2026-10-20T08:00:00.000Z' }), error: new NetworkError('offline') });
    const list = qc.getQueryData<ApiMeetingAttendee[]>(PEOPLE)!;
    expect(list.map((a) => [a.id, a.response])).toEqual([
      ['me', 'TENTATIVE'],
      ['b', 'DECLINED'],
      ['c', 'PENDING'],
    ]);
    expect(list[0]!.respondedAt).toBe('2026-10-20T08:00:00.000Z');
  });

  it('a meeting that is gone or no longer mine loads the meeting again too, so the screen says so', () => {
    for (const status of [403, 404]) {
      const qc = client();
      qc.setQueryData(['meeting', 'm1'], { id: 'm1' });
      qc.setQueryData(PEOPLE, [person('me')]);
      answerFailed(qc, { meetingId: 'm1', previous: person('me'), error: new ApiError(status, 'X', 'gone') });
      expect(invalidated(qc, ['meeting', 'm1'])).toBe(true);
      expect(invalidated(qc, PEOPLE)).toBe(true);
    }
  });

  it('leaves an empty cache alone', () => {
    const qc = client();
    answerFailed(qc, { meetingId: 'm1', previous: null, error: new NetworkError('offline') });
    expect(qc.getQueryData(PEOPLE)).toBeUndefined();
  });

  it('one meeting’s answers go one after another (a quick second tap waits for the first)', async () => {
    const qc = client();
    const order: string[] = [];
    let release!: () => void;
    const first = qc.getMutationCache().build(qc, {
      scope: answerScope('m1'),
      mutationFn: () => new Promise<void>((done) => (release = () => (order.push('first'), done()))),
    });
    const second = qc.getMutationCache().build(qc, { scope: answerScope('m1'), mutationFn: async () => void order.push('second') });
    const other = qc.getMutationCache().build(qc, { scope: answerScope('m2'), mutationFn: async () => void order.push('other meeting') });
    const runs = [first.execute(undefined), second.execute(undefined), other.execute(undefined)];
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['other meeting']);
    release();
    await Promise.all(runs);
    expect(order).toEqual(['other meeting', 'first', 'second']);
  });
});

const meetingRow = (id: string, over: Partial<ApiMeeting> = {}): ApiMeeting => ({
  id,
  title: id,
  description: null,
  status: 'SCHEDULED',
  projectId: 'p1',
  organizerId: 'u1',
  location: null,
  onlineLink: null,
  startAt: '2026-10-22T06:00:00.000Z',
  endAt: null,
  timeZone: null,
  recurrenceRule: null,
  recurrenceParentId: null,
  ...over,
});

/** Was the query marked out of date (true), and is it still in the cache (else 'gone')? */
const state = (qc: QueryClient, key: string[]) => {
  const q = qc.getQueryCache().find({ queryKey: key, exact: true });
  return q ? q.state.isInvalidated : 'gone';
};

describe('after my own change to a meeting (the server’s answer shows at once; only what else shows it is refreshed)', () => {
  function seeded(): QueryClient {
    const qc = client();
    qc.setQueryData(['meeting', 'm1'], meetingRow('m1', { series: null, canEdit: true }));
    qc.setQueryData(['meeting', 'm1', 'notes'], [{ id: 'n1', body: 'a' }]);
    qc.setQueryData(['meeting', 'm2'], meetingRow('m2'));
    qc.setQueryData(['meetings', 'list', 'all'], [meetingRow('m1'), meetingRow('m2')]);
    qc.setQueryData(['meetings', 'calendar'], [meetingRow('m1')]);
    qc.setQueryData(['project', 'p1', 'meetings'], { meetings: [] });
    qc.setQueryData(['project', 'p2', 'meetings'], { meetings: [] });
    qc.setQueryData(['action-items', 'mine', 'open'], []);
    return qc;
  }

  it('puts a row the server answered with into its list (replacing it, or adding it), and takes one out', () => {
    const qc = seeded();
    putRow(qc, ['meeting', 'm1', 'notes'], { id: 'n2', body: 'b' });
    putRow(qc, ['meeting', 'm1', 'notes'], { id: 'n1', body: 'a, edited' });
    expect(qc.getQueryData(['meeting', 'm1', 'notes'])).toEqual([{ id: 'n1', body: 'a, edited' }, { id: 'n2', body: 'b' }]);
    dropRow(qc, ['meeting', 'm1', 'notes'], 'n1');
    expect(qc.getQueryData(['meeting', 'm1', 'notes'])).toEqual([{ id: 'n2', body: 'b' }]);
    // A change shown before the server answers (a tick, a status), and what it was before.
    const before = patchRow<{ id: string; body: string }>(qc, ['meeting', 'm1', 'notes'], 'n2', { body: 'B' });
    expect(qc.getQueryData(['meeting', 'm1', 'notes'])).toEqual([{ id: 'n2', body: 'B' }]);
    expect(before).toEqual({ id: 'n2', body: 'b' });
    expect(patchRow<{ id: string; body: string }>(qc, ['meeting', 'm1', 'notes'], 'nope', { body: 'x' })).toBeNull();
    // A list not loaded yet stays unloaded (it is fetched as it is).
    putRow(qc, ['meeting', 'm1', 'agenda'], { id: 'g1' });
    expect(qc.getQueryData(['meeting', 'm1', 'agenda'])).toBeUndefined();
  });

  it('a part changed: the lists’ cards and the project’s meetings go out of date — not the part itself', () => {
    const qc = seeded();
    afterPartChanged(qc, 'm1', 'notes');
    expect(state(qc, ['meeting', 'm1', 'notes'])).toBe(false);
    expect(state(qc, ['meetings', 'list', 'all'])).toBe(true);
    expect(state(qc, ['project', 'p1', 'meetings'])).toBe(true);
    expect(state(qc, ['project', 'p2', 'meetings'])).toBe(false);
    expect(state(qc, ['action-items', 'mine', 'open'])).toBe(false);
    afterPartChanged(qc, 'm1', 'action-items');
    expect(state(qc, ['action-items', 'mine', 'open'])).toBe(true);
  });

  it('a saved meeting shows at once (keeping what only its own read gives) and its lists load again', () => {
    const qc = seeded();
    afterMeetingSaved(qc, meetingRow('m1', { title: 'Renamed', status: 'CANCELLED' }), {});
    expect(qc.getQueryData<ApiMeeting>(['meeting', 'm1'])).toMatchObject({ title: 'Renamed', status: 'CANCELLED', canEdit: true, series: null });
    expect(state(qc, ['meetings', 'list', 'all'])).toBe(true);
    expect(state(qc, ['meetings', 'calendar'])).toBe(true);
    expect(state(qc, ['project', 'p1', 'meetings'])).toBe(true);
    expect(state(qc, ['meeting', 'm2'])).toBe(false);
    // A whole series changed: the other meetings of it are out of date too.
    afterMeetingSaved(qc, meetingRow('m1'), { scope: 'series' });
    expect(state(qc, ['meeting', 'm2'])).toBe(true);
  });

  it('a series change answered with another meeting (the new schedule had no place for this one) loads the edited one again at once', async () => {
    const qc = seeded();
    const queryFn = vi.fn(async () => meetingRow('m1'));
    const stop = new QueryObserver(qc, { queryKey: ['meeting', 'm1'], queryFn, staleTime: 60_000 }).subscribe(() => {});
    await new Promise((r) => setTimeout(r, 0));
    const before = queryFn.mock.calls.length;
    afterMeetingSaved(qc, meetingRow('m3', { title: 'Next of the series' }), { scope: 'series', editedId: 'm1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(queryFn.mock.calls.length).toBe(before + 1);
    expect(qc.getQueryData<ApiMeeting>(['meeting', 'm3'])?.title).toBe('Next of the series');
    stop();
  });

  it('a meeting moved to another project refreshes both projects’ meetings', () => {
    const qc = seeded();
    afterMeetingSaved(qc, meetingRow('m1', { projectId: 'p2' }), {});
    expect(state(qc, ['project', 'p1', 'meetings'])).toBe(true);
    expect(state(qc, ['project', 'p2', 'meetings'])).toBe(true);
  });

  it('a new meeting (or a copy) is there to open at once', () => {
    const qc = seeded();
    afterMeetingSaved(qc, meetingRow('m9', { title: 'New' }), {});
    expect(qc.getQueryData<ApiMeeting>(['meeting', 'm9'])?.title).toBe('New');
    expect(state(qc, ['meetings', 'list', 'all'])).toBe(true);
  });

  it('a new meeting saved with its people and agenda (2c): its screen opens with them, and the meeting keeps only its own fields', () => {
    const qc = seeded();
    const people = [person('a1', { meetingId: 'm9', userId: 'u3' })];
    const agenda = [{ id: 'g1', meetingId: 'm9', title: 'Budget', ownerId: 'u3', expectedMinutes: 20, completed: false, position: 0 }];
    afterMeetingSaved(qc, { ...meetingRow('m9', { title: 'New' }), attendees: people, agendaItems: agenda } as unknown as ApiMeeting, {});
    const saved = qc.getQueryData<ApiMeeting & { agendaItems?: unknown }>(['meeting', 'm9']);
    expect(saved?.title).toBe('New');
    // A list card's `attendees` are names: the reply's attendee rows must not land there.
    expect(saved?.attendees).toBeUndefined();
    expect(saved?.agendaItems).toBeUndefined();
    expect(qc.getQueryData(['meeting', 'm9', 'attendees'])).toEqual(people);
    expect(qc.getQueryData(['meeting', 'm9', 'agenda'])).toEqual(agenda);
  });

  it('a deleted meeting’s data goes; the lists, its project’s meetings and My Action Items load again', () => {
    const qc = seeded();
    afterMeetingDeleted(qc, 'm1', 'one');
    expect(state(qc, ['meeting', 'm1'])).toBe('gone');
    expect(state(qc, ['meeting', 'm1', 'notes'])).toBe('gone');
    expect(state(qc, ['meetings', 'list', 'all'])).toBe(true);
    expect(state(qc, ['project', 'p1', 'meetings'])).toBe(true);
    expect(state(qc, ['action-items', 'mine', 'open'])).toBe(true);
    expect(state(qc, ['meeting', 'm2'])).toBe(false);
    afterMeetingDeleted(qc, 'm2', 'series');
    expect(state(qc, ['meeting', 'm2'])).toBe('gone');
  });
});

describe('a task made from a meeting note', () => {
  it('marks its board, My Tasks, its project’s progress and the calendar out of date (fetched when next shown)', () => {
    expect(noteTaskRefreshes('p1')).toEqual([
      { queryKey: ['tasks', 'project', 'p1'], later: true },
      { queryKey: ['tasks', 'mine'], later: true },
      { queryKey: ['project', 'p1', 'progress'], later: true },
      { queryKey: ['tasks', 'calendar'], later: true },
    ]);
  });
});
