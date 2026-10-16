import { describe, it, expect } from 'vitest';
import { filterCalendarMeetings, groupMeetingsByDay, meetingItems, meetingRange } from './calendar-meetings';
import { DEFAULT_FILTERS } from './calendar-model';
import type { Meeting } from '../api/meetings';

const TZ = 'Asia/Muscat';

function meeting(over: Partial<Meeting>): Meeting {
  return {
    id: 'm', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: 'p1', organizerId: 'u1',
    location: null, onlineLink: null, startAt: '2026-10-20T06:00:00.000Z', endAt: '2026-10-20T07:00:00.000Z', timeZone: TZ,
    recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null,
    createdById: 'u1', createdAt: '', updatedAt: '', ...over,
  };
}

describe('meetings on the calendar', () => {
  it('puts each meeting on its day in company time, with its times', () => {
    const items = meetingItems([meeting({ id: 'late', startAt: '2026-10-20T21:30:00.000Z', endAt: null }), meeting({ id: 'a' })], TZ);
    expect(items.map((i) => [i.id, i.date, i.time])).toEqual([
      ['a', '2026-10-20', '10:00 – 11:00'],
      ['late', '2026-10-21', '01:30'], // 01:30 on the 21st in Muscat
    ]);
  });

  it('marks a series and a cancelled meeting', () => {
    const [series, child, off] = meetingItems([
      meeting({ id: 'r', recurrenceRule: { freq: 'WEEKLY', interval: 1 } }),
      meeting({ id: 'c', recurrenceParentId: 'r', startAt: '2026-10-27T06:00:00.000Z' }),
      meeting({ id: 'x', status: 'CANCELLED', startAt: '2026-10-28T06:00:00.000Z' }),
    ], TZ);
    expect([series!.recurring, child!.recurring, off!.recurring]).toEqual([true, true, false]);
    expect(off!.cancelled).toBe(true);
  });

  it('follows the calendar filters that apply to meetings', () => {
    const items = meetingItems([
      meeting({ id: 'mine' }),
      meeting({ id: 'other', projectId: 'p2', organizerId: 'u2', title: 'Budget review' }),
      meeting({ id: 'held', status: 'COMPLETED' }),
    ], TZ);
    const ids = (f: Partial<typeof DEFAULT_FILTERS>) => filterCalendarMeetings(items, { ...DEFAULT_FILTERS, ...f }, { myId: 'u1' }).map((i) => i.id);
    expect(ids({})).toEqual(['mine', 'other', 'held']);
    expect(ids({ projectId: 'p2' })).toEqual(['other']);
    expect(ids({ q: 'budget' })).toEqual(['other']);
    expect(ids({ mine: true })).toEqual(['mine', 'held']);
    expect(ids({ showCompleted: false })).toEqual(['mine', 'other']);
    expect(ids({ showMeetings: false })).toEqual([]);
    // Task-only filters (status, priority, assignee) leave meetings out.
    expect(ids({ priorities: ['HIGH'] })).toEqual([]);
    expect(ids({ assigneeId: 'u2' })).toEqual([]);
  });

  it('groups by day and asks the server for the whole visible range', () => {
    const byDay = groupMeetingsByDay(meetingItems([meeting({ id: 'a' }), meeting({ id: 'b', startAt: '2026-10-20T04:00:00.000Z' })], TZ));
    expect(byDay.get('2026-10-20')!.map((i) => i.id)).toEqual(['b', 'a']);
    expect(meetingRange('2026-10-01', '2026-10-31', TZ)).toEqual({ from: '2026-09-30T20:00:00.000Z', to: '2026-10-31T20:00:00.000Z' });
  });
});
