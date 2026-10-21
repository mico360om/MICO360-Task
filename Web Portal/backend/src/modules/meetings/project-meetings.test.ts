import { describe, it, expect } from 'vitest';
import { buildMeetingListCounts, buildProjectMeetingsOverview, type ProjectMeetingsData } from './project-meetings';

const NOW = new Date('2026-10-20T08:00:00.000Z'); // Tue 12:00 Muscat
const TZ = 'Asia/Muscat';

function meeting(id: string, over: Partial<ProjectMeetingsData['meetings'][number]> = {}): ProjectMeetingsData['meetings'][number] {
  return {
    id, title: `Meeting ${id}`, status: 'SCHEDULED', startAt: new Date('2026-10-22T06:00:00Z'), endAt: new Date('2026-10-22T07:00:00Z'),
    timeZone: TZ, location: null, onlineLink: null, recurrenceRule: null, recurrenceParentId: null, organizerId: 'u1', ...over,
  };
}

function data(over: Partial<ProjectMeetingsData> = {}): ProjectMeetingsData {
  return { meetings: [], seriesRoots: [], attendees: [], decisions: [], noteCounts: {}, minutes: [], actionItems: [], ...over };
}

describe('meeting list summaries', () => {
  const empty = { attendees: [], noteCounts: {}, decisionCounts: {}, minutes: [], openActionItemCounts: {} };

  it('gives a meeting with nothing yet zeros, no names and no minutes', () => {
    expect(buildMeetingListCounts(['a'], empty)).toEqual({ a: { attendeeCount: 0, openActionItemCount: 0, attendees: [], minutes: 'NONE', decisionCount: 0 } });
  });

  it('counts everyone but names only the first four, in the order they were added', () => {
    const attendees = ['Aisha', 'Omar', 'Sara', 'Bilal', 'Zara'].map((name, i) => ({ meetingId: 'a', userId: `u${i}`, name }));
    const out = buildMeetingListCounts(['a'], { ...empty, attendees });
    expect(out.a).toMatchObject({ attendeeCount: 5, attendees: ['Aisha', 'Omar', 'Sara', 'Bilal'] });
  });

  it('says how far the minutes are: approved or sent is final, any other record a draft, notes alone are notes', () => {
    const out = buildMeetingListCounts(['final', 'sent', 'draft', 'notes', 'none'], {
      ...empty,
      minutes: [{ meetingId: 'final', status: 'APPROVED' }, { meetingId: 'sent', status: 'SENT' }, { meetingId: 'draft', status: 'DRAFT' }],
      noteCounts: { notes: 4, draft: 2 },
    });
    expect(Object.fromEntries(Object.entries(out).map(([id, c]) => [id, c.minutes]))).toEqual({ final: 'FINAL', sent: 'FINAL', draft: 'DRAFT', notes: 'NOTES', none: 'NONE' });
  });

  it('carries the decisions and open action items of each meeting', () => {
    const out = buildMeetingListCounts(['a', 'b'], { ...empty, decisionCounts: { a: 3 }, openActionItemCounts: { b: 2 } });
    expect(out.a).toMatchObject({ decisionCount: 3, openActionItemCount: 0 });
    expect(out.b).toMatchObject({ decisionCount: 0, openActionItemCount: 2 });
  });

  it('gives the person asking their own row on each meeting — its id and answer — or null when they aren’t on it', () => {
    const attendees = [
      { meetingId: 'a', userId: 'u2', name: 'Omar', id: 'at1', response: 'DECLINED' },
      { meetingId: 'a', userId: 'me', name: 'Mariam', id: 'at2', response: 'ACCEPTED' },
      { meetingId: 'b', userId: 'u2', name: 'Omar', id: 'at3', response: 'PENDING' },
      { meetingId: 'c', userId: null, name: 'guest@example.com', id: 'at4', response: 'PENDING' },
    ];
    const out = buildMeetingListCounts(['a', 'b', 'c'], { ...empty, attendees }, 'me');
    expect(out.a?.mine).toEqual({ attendeeId: 'at2', response: 'ACCEPTED' });
    expect(out.b?.mine).toBeNull();
    expect(out.c?.mine).toBeNull();
    // Without someone asking, there is no "own row" to give.
    expect(buildMeetingListCounts(['a'], { ...empty, attendees }).a).not.toHaveProperty('mine');
  });
});

describe('project meetings overview', () => {
  it('sorts meetings into upcoming, under way, held and cancelled', () => {
    const o = buildProjectMeetingsOverview(data({
      meetings: [
        meeting('soon'),
        meeting('now', { startAt: new Date('2026-10-20T07:30:00Z'), endAt: new Date('2026-10-20T08:30:00Z') }),
        meeting('live', { status: 'IN_PROGRESS', startAt: new Date('2026-10-20T06:00:00Z'), endAt: new Date('2026-10-20T07:00:00Z') }),
        meeting('held', { status: 'COMPLETED', startAt: new Date('2026-10-13T06:00:00Z'), endAt: new Date('2026-10-13T07:00:00Z') }),
        meeting('past', { startAt: new Date('2026-10-14T06:00:00Z'), endAt: new Date('2026-10-14T07:00:00Z') }),
        meeting('off', { status: 'CANCELLED' }),
      ],
    }), NOW, TZ);
    const phase = Object.fromEntries(o.meetings.map((m) => [m.id, m.phase]));
    expect(phase).toEqual({ soon: 'upcoming', now: 'ongoing', live: 'ongoing', held: 'completed', past: 'completed', off: 'cancelled' });
    expect(o.stats).toMatchObject({ upcoming: 1, ongoing: 2, completed: 2, cancelled: 1 });
    expect(o.stats.nextMeetingId).toBe('soon');
  });

  it('gives each meeting its people, minutes state, decisions and open action items', () => {
    const o = buildProjectMeetingsOverview(data({
      meetings: [meeting('a'), meeting('b'), meeting('c'), meeting('d')],
      attendees: [
        { meetingId: 'a', userId: 'u2', name: 'Khurram' },
        { meetingId: 'a', userId: null, name: 'Sara (guest)' },
      ],
      noteCounts: { a: 3, b: 1 },
      minutes: [{ meetingId: 'a', status: 'APPROVED' }, { meetingId: 'c', status: 'DRAFT' }],
      decisions: [{ id: 'n1', meetingId: 'a', body: 'Go live on 1 Nov', createdAt: new Date('2026-10-13T06:30:00Z') }],
      actionItems: [
        { id: 'x1', meetingId: 'a', description: 'Book the venue', status: 'OPEN', priority: 'HIGH', dueDate: new Date('2026-10-19T00:00:00Z'), assigneeId: 'u2', assigneeName: 'Khurram', completedAt: null },
        { id: 'x2', meetingId: 'a', description: 'Send slides', status: 'COMPLETED', priority: 'NORMAL', dueDate: null, assigneeId: null, assigneeName: null, completedAt: new Date() },
      ],
    }), NOW, TZ);
    const a = o.meetings.find((m) => m.id === 'a')!;
    expect(a).toMatchObject({ attendeeCount: 2, attendees: ['Khurram', 'Sara (guest)'], minutes: 'FINAL', decisionCount: 1, openActionItemCount: 1 });
    expect(o.meetings.find((m) => m.id === 'b')!.minutes).toBe('NOTES');
    expect(o.meetings.find((m) => m.id === 'c')!.minutes).toBe('DRAFT');
    expect(o.meetings.find((m) => m.id === 'd')!.minutes).toBe('NONE');
    expect(o.decisions).toEqual([{ id: 'n1', text: 'Go live on 1 Nov', meetingId: 'a', meetingTitle: 'Meeting a', at: new Date('2026-10-13T06:30:00Z') }]);
    expect(o.actionItems[0]).toMatchObject({ id: 'x1', overdue: true, meetingTitle: 'Meeting a', assignee: { id: 'u2', name: 'Khurram' } });
    expect(o.actionItems[1]).toMatchObject({ id: 'x2', overdue: false, assignee: null });
    expect(o.stats).toMatchObject({ openActionItems: 1, overdueActionItems: 1, decisions: 1 });
  });

  it('lists a formatted decision by its words', () => {
    const o = buildProjectMeetingsOverview(data({
      meetings: [meeting('a')],
      decisions: [{ id: 'n1', meetingId: 'a', body: '<p><strong>Go live</strong> on 1 Nov</p>', bodyFormat: 'RICH', createdAt: new Date('2026-10-13T06:30:00Z') }],
    }), NOW, TZ);
    expect(o.decisions[0]!.text).toBe('Go live on 1 Nov');
  });

  it('marks the meetings of a series and lists each series once', () => {
    const rule = { freq: 'WEEKLY' as const, interval: 1 };
    const o = buildProjectMeetingsOverview(data({
      meetings: [
        meeting('r', { title: 'Weekly sync', recurrenceRule: rule, startAt: new Date('2026-10-13T06:00:00Z'), endAt: new Date('2026-10-13T07:00:00Z'), status: 'COMPLETED' }),
        meeting('r2', { title: 'Weekly sync', recurrenceParentId: 'r' }),
        meeting('r3', { title: 'Weekly sync', recurrenceParentId: 'r', startAt: new Date('2026-10-29T06:00:00Z') }),
      ],
    }), NOW, TZ);
    expect(o.meetings.map((m) => m.seriesId)).toEqual(['r', 'r', 'r']);
    expect(o.series).toEqual([{ id: 'r', title: 'Weekly sync', rule, firstStartAt: new Date('2026-10-13T06:00:00Z'), nextMeetingId: 'r2', nextStartAt: new Date('2026-10-22T06:00:00Z'), upcoming: 2 }]);
  });

  it('lists a series whose first meeting is older than the meetings shown, or was deleted', () => {
    const rule = { freq: 'WEEKLY' as const, interval: 1, weekdays: [2] };
    const o = buildProjectMeetingsOverview(data({
      meetings: [meeting('c1', { title: 'Weekly sync', recurrenceParentId: 'old' })],
      seriesRoots: [{ id: 'old', title: 'Weekly sync (first)', recurrenceRule: rule, recurrenceStart: new Date('2026-03-03T06:00:00Z'), startAt: new Date('2026-03-03T06:00:00Z') }],
    }), NOW, TZ);
    expect(o.series).toEqual([expect.objectContaining({ id: 'old', title: 'Weekly sync', rule, firstStartAt: new Date('2026-03-03T06:00:00Z'), nextMeetingId: 'c1', upcoming: 1 })]);
  });
});
