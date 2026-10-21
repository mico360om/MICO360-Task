import { describe, it, expect, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from './api-client';
import { answerFailed, answerScope } from './meeting-cache';
import type { ApiMeetingAttendee } from './types';

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
