import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { filterCalendarMeetings, groupMeetingsByDay, meetingItems, meetingRange, type CalMeeting } from './calendar-meetings';
import { DEFAULT_FILTERS, type CalendarFilters } from './calendar-model';
import type { ApiMeeting } from './types';

const TZ = 'Asia/Muscat';

function meeting(over: Partial<ApiMeeting>): ApiMeeting {
  return {
    id: 'm', title: 'Weekly sync', description: null, category: null, status: 'SCHEDULED', projectId: 'p1', organizerId: 'u1',
    location: null, onlineLink: null, startAt: '2026-10-20T06:00:00.000Z', endAt: '2026-10-20T07:00:00.000Z', timeZone: TZ,
    recurrenceRule: null, recurrenceParentId: null, ...over,
  };
}

describe('meetings on the calendar', () => {
  it('puts each meeting on its day in the calendar’s zone, with its times, keeping the meeting itself', () => {
    const late = meeting({ id: 'late', startAt: '2026-10-20T21:30:00.000Z', endAt: null });
    const items = meetingItems([late, meeting({ id: 'a' })], TZ);
    expect(items.map((i) => [i.id, i.date, i.time])).toEqual([
      ['a', '2026-10-20', '10:00 – 11:00'],
      ['late', '2026-10-21', '01:30'], // 01:30 on the 21st in Muscat
    ]);
    expect(items[1]!.meeting).toBe(late);
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
    const ids = (f: Partial<CalendarFilters>) => filterCalendarMeetings(items, { ...DEFAULT_FILTERS, ...f }, { myId: 'u1' }).map((i) => i.id);
    expect(ids({})).toEqual(['mine', 'other', 'held']);
    expect(ids({ projectId: 'p2' })).toEqual(['other']);
    expect(ids({ q: 'budget' })).toEqual(['other']);
    expect(ids({ mine: true })).toEqual(['mine', 'held']);
    expect(ids({ showCompleted: false })).toEqual(['mine', 'other']);
    expect(ids({ showMeetings: false })).toEqual([]);
    // Task-only filters (status, priority, person) leave meetings out.
    expect(ids({ priorities: ['HIGH'] })).toEqual([]);
    expect(ids({ statuses: ['overdue'] })).toEqual([]);
    expect(ids({ assigneeId: 'u2' })).toEqual([]);
  });

  it('groups by day and asks the server for the whole visible range in the calendar’s zone', () => {
    const byDay = groupMeetingsByDay(meetingItems([meeting({ id: 'a' }), meeting({ id: 'b', startAt: '2026-10-20T04:00:00.000Z' })], TZ));
    expect(byDay.get('2026-10-20')!.map((i) => i.id)).toEqual(['b', 'a']);
    expect(meetingRange('2026-10-01', '2026-10-31', TZ)).toEqual({ from: '2026-09-30T20:00:00.000Z', to: '2026-10-31T20:00:00.000Z' });
    expect(meetingRange('2026-03-28', '2026-03-29', 'Europe/London')).toEqual({ from: '2026-03-28T00:00:00.000Z', to: '2026-03-29T23:00:00.000Z' });
  });
});

/**
 * The website's calendar meetings (Web Portal/frontend/src/lib/calendar-meetings.ts) and these
 * must place, filter and order meetings alike, and ask for the same instants.
 */
const webMeetings = resolve(__dirname, '../../../Web Portal/frontend/src/lib/calendar-meetings.ts');
describe.skipIf(!existsSync(webMeetings))('the same as the website', () => {
  type Fn = (...args: unknown[]) => unknown;
  const load = async () => (await import(/* @vite-ignore */ webMeetings)) as Record<string, Fn>;
  const list = [
    meeting({ id: 'a' }),
    meeting({ id: 'b', startAt: '2026-10-20T21:30:00.000Z', endAt: null, projectId: null, organizerId: 'u2' }),
    meeting({ id: 'c', status: 'CANCELLED', recurrenceParentId: 'r', title: 'Site walk' }),
    meeting({ id: 'd', status: 'COMPLETED', recurrenceRule: { freq: 'DAILY', interval: 1 }, location: 'Room 4' }),
  ];
  const strip = (items: unknown[]) => (items as CalMeeting[]).map(({ meeting: _m, ...rest }) => rest);
  const filters: Partial<CalendarFilters>[] = [{}, { projectId: 'p1' }, { mine: true }, { q: 'SITE' }, { showCompleted: false }, { showMeetings: false }, { statuses: ['todo'] }, { assigneeId: 'u1' }];

  it('alike, in several zones', async () => {
    const web = await load();
    for (const tz of [TZ, 'UTC', 'America/New_York', 'Asia/Kolkata']) {
      const mine = meetingItems(list, tz);
      const theirs = web.meetingItems!(list, tz) as unknown[];
      expect(strip(mine)).toEqual(theirs);
      for (const f of filters) {
        const all = { ...DEFAULT_FILTERS, ...f };
        expect(strip(filterCalendarMeetings(mine, all, { myId: 'u1' }))).toEqual(web.filterCalendarMeetings!(theirs, all, { myId: 'u1' }));
      }
      const order = (m: Map<string, unknown[]>) => [...m.entries()].map(([d, l]) => [d, (l as { id: string }[]).map((x) => x.id)]);
      expect(order(groupMeetingsByDay(mine))).toEqual(order(web.groupMeetingsByDay!(theirs) as Map<string, unknown[]>));
      for (const [from, to] of [['2026-10-01', '2026-10-31'], ['2026-03-01', '2026-04-04'], ['2026-10-25', '2026-11-07']]) {
        expect(meetingRange(from!, to!, tz)).toEqual(web.meetingRange!(from, to, tz));
      }
    }
  });
});
