import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  weekdayLabels, monthWeeks, weekDays, shiftMonth, visibleRange, statusOf, buildItems, groupByDay, applyFilters,
  DEFAULT_FILTERS, filtersFromQuery, filtersToQuery, meetingItems, groupMeetingsByDay, meetingRange, filterCalendarMeetings,
  dateSettings, dayLabel, periodLabel, itemName, meetingName, timeNote, seriesIdOf,
} from './calendar.js';
import { zonedStartOfDay } from './due-date.js';

const task = (id, over = {}) => ({
  id, key: `K-${id}`, title: `Task ${id}`, projectId: 'p1', priority: 'NORMAL', columnCategory: 'TODO', completedAt: null,
  dueDate: '2026-10-21T00:00:00.000Z', recurrenceRule: null, recurrenceParentId: null, assignees: [], ...over,
});

describe('calendar days', () => {
  it('a month as whole weeks starting on your week start; a week; the range each view asks for', () => {
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const weeks = monthWeeks(2026, 9, 0); // October 2026, weeks from Sunday
    expect(weeks[0][0].key).toBe('2026-09-27');
    expect(weeks.at(-1).at(-1).key).toBe('2026-10-31');
    expect(weekDays('2026-10-21', 6)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-01');
    expect(visibleRange('month', '2026-10-21', 1)).toEqual({ from: '2026-09-28', to: '2026-11-01' });
    expect(visibleRange('week', '2026-10-21', 0)).toEqual({ from: '2026-10-18', to: '2026-10-24' });
    expect(visibleRange('agenda', '2026-10-21', 0)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('names days and periods as the web does', () => {
    expect(dayLabel('2026-10-21')).toBe('Wed 21 Oct');
    expect(dayLabel('2026-10-21', { weekday: 'long', day: 'numeric', month: 'long' })).toBe('Wednesday 21 October');
    expect(periodLabel('month', '2026-10-21', 0)).toBe('October 2026');
    expect(periodLabel('week', '2026-10-21', 0)).toBe('18 – 24 Oct 2026');
    expect(periodLabel('week', '2026-10-29', 1)).toBe('26 Oct – 1 Nov 2026');
    expect(periodLabel('week', '2026-12-30', 1)).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});

describe('your date settings', () => {
  it('your own time zone and week start when chosen, else the company’s zone and Sunday', () => {
    expect(dateSettings({ timeZone: 'Europe/London', weekStart: 1 }, 'Asia/Muscat')).toEqual({ timeZone: 'Europe/London', ownTimeZone: 'Europe/London', companyTimeZone: 'Asia/Muscat', weekStart: 1 });
    expect(dateSettings({ timeZone: null, weekStart: null }, 'Asia/Muscat')).toEqual({ timeZone: 'Asia/Muscat', ownTimeZone: null, companyTimeZone: 'Asia/Muscat', weekStart: 0 });
    expect(dateSettings({ timeZone: 'Not/AZone', weekStart: 3 }, 'Asia/Muscat')).toMatchObject({ timeZone: 'Asia/Muscat', weekStart: 0 });
    expect(dateSettings(null, 'Asia/Muscat').weekStart).toBe(0);
    expect(dateSettings({ weekStart: 6 }, 'UTC').weekStart).toBe(6);
  });

  it('says which zone the dates are in', () => {
    expect(timeNote(dateSettings({ timeZone: 'Europe/London' }, 'Asia/Muscat'))).toBe('Dates in Europe/London (your setting)');
    expect(timeNote(dateSettings(null, 'Asia/Muscat'))).toBe('Dates in Asia/Muscat (company time)');
  });
});

describe('what the calendar shows', () => {
  const data = {
    tasks: [
      task('a', { dueDate: '2026-10-19T00:00:00.000Z' }),
      task('b', { columnCategory: 'IN_PROGRESS' }),
      task('c', { columnCategory: 'DONE', completedAt: '2026-10-20T08:00:00Z', dueDate: '2026-10-19T00:00:00.000Z' }),
      task('d', { columnCategory: 'BLOCKED', priority: 'URGENT', dueDate: '2026-10-22T00:00:00.000Z', projectId: 'p2' }),
      task('e', { dueDate: null }),
    ],
    occurrences: [{ taskId: 'r1', seriesId: 'r1', date: '2026-10-28' }, { taskId: 'r2', seriesId: 'r2', date: '2026-10-28' }],
    series: [task('r1', { recurrenceRule: { freq: 'WEEKLY', interval: 1 } }), task('r2', { projectId: 'p3', recurrenceRule: { freq: 'DAILY', interval: 1 } })],
  };
  const projectStatus = (id) => ({ p2: 'ARCHIVED', p3: 'COMPLETED' }[id] || 'ACTIVE');
  const items = buildItems(data, { today: '2026-10-21', timeZone: 'Asia/Muscat', projectStatus });

  it('each task on its due day with its status (red only for overdue), and the copies repeats will make', () => {
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by.a.status).toBe('overdue');
    expect(by.b.status).toBe('in-progress');
    expect(by.c.status).toBe('done'); // finished: never overdue
    expect(by.d).toMatchObject({ status: 'blocked', projectArchived: true });
    expect(by.e).toBeUndefined(); // no due date
    expect(by['proj:r1:2026-10-28']).toMatchObject({ kind: 'projected', status: 'projected', date: '2026-10-28', recurring: true });
    expect(by['proj:r2:2026-10-28']).toBeUndefined(); // no copies in a completed project
    expect(statusOf(task('x'), '2026-10-21', '2026-10-21')).toBe('todo');
  });

  it('a busy day lists the most urgent first', () => {
    const day = groupByDay([
      ...items,
      { ...items.find((i) => i.key === 'b'), key: 'b2', date: '2026-10-21', status: 'todo', task: task('b2', { priority: 'HIGH' }) },
    ]).get('2026-10-21');
    expect(day.map((i) => i.key)).toEqual(['b', 'b2']);
  });

  it('filters: only mine, done, repeats — and archived projects stay hidden, as on the web', () => {
    const mine = { ...task('m', { assignees: [{ id: 'me', name: 'Me' }] }) };
    const all = buildItems({ ...data, tasks: [...data.tasks, mine] }, { today: '2026-10-21', timeZone: 'Asia/Muscat', projectStatus });
    expect(applyFilters(all, DEFAULT_FILTERS, { myId: 'me' }).map((i) => i.key)).not.toContain('d');
    expect(applyFilters(all, { ...DEFAULT_FILTERS, mine: true }, { myId: 'me' }).map((i) => i.key)).toEqual(['m']);
    expect(applyFilters(all, { ...DEFAULT_FILTERS, showCompleted: false }, { myId: 'me' }).map((i) => i.key)).not.toContain('c');
    expect(applyFilters(all, { ...DEFAULT_FILTERS, showProjected: false }, { myId: 'me' }).some((i) => i.kind === 'projected')).toBe(false);
  });

  it('the filters live in the address with the web’s names (only what differs from the default)', () => {
    const f = { ...DEFAULT_FILTERS, mine: true, showProjected: false, showMeetings: false };
    expect(filtersToQuery(f)).toEqual({ mine: '1', repeats: '0', meetings: '0' });
    expect(filtersFromQuery({ mine: '1', repeats: '0', meetings: '0', done: '0' })).toEqual({ ...f, showCompleted: false });
    expect(filtersFromQuery({})).toEqual(DEFAULT_FILTERS);
  });

  it('what a screen reader hears for a task and for a copy not made yet', () => {
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(itemName(by.a)).toBe('Task a, overdue');
    expect(itemName(by.d)).toBe('Task d, blocked, urgent priority');
    expect(itemName(by['proj:r1:2026-10-28'])).toBe('Task r1, repeat, not created yet, Wed 28 Oct');
  });
});

describe('meetings on the calendar', () => {
  const meetings = [
    { id: 'm2', title: 'Late', startAt: '2026-10-21T15:00:00.000Z', endAt: null, status: 'SCHEDULED', projectId: 'p1', organizerId: 'me', location: null, recurrenceRule: null, recurrenceParentId: null },
    { id: 'm1', title: 'Rig review', startAt: '2026-10-21T06:00:00.000Z', endAt: '2026-10-21T07:00:00.000Z', status: 'CANCELLED', projectId: null, organizerId: 'u2', location: 'Room 2', recurrenceRule: null, recurrenceParentId: 'm0' },
  ];

  it('each on its day in your zone, with its times, whether it repeats and whether it is cancelled', () => {
    const items = meetingItems(meetings, 'Asia/Muscat');
    expect(items.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(items[0]).toMatchObject({ date: '2026-10-21', time: '10:00 – 11:00', recurring: true, cancelled: true });
    expect(items[1]).toMatchObject({ date: '2026-10-21', time: '19:00' });
    expect(meetingName(items[0])).toBe('Rig review, meeting, 10:00 – 11:00, cancelled, repeats');
    expect(groupMeetingsByDay(items).get('2026-10-21').map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(seriesIdOf({ id: 'x', recurrenceRule: { freq: 'DAILY' }, recurrenceParentId: null })).toBe('x');
  });

  it('asks for the meetings starting in the visible days (your zone)', () => {
    expect(meetingRange('2026-10-01', '2026-10-31', 'Asia/Muscat')).toEqual({ from: '2026-09-30T20:00:00.000Z', to: '2026-10-31T20:00:00.000Z' });
    expect(zonedStartOfDay('2026-10-21', 'Asia/Muscat').toISOString()).toBe('2026-10-20T20:00:00.000Z');
  });

  it('“Only mine” keeps the ones you organize; switched off, none show', () => {
    const items = meetingItems(meetings, 'Asia/Muscat');
    expect(filterCalendarMeetings(items, { ...DEFAULT_FILTERS, mine: true }, { myId: 'me' }).map((m) => m.id)).toEqual(['m2']);
    expect(filterCalendarMeetings(items, { ...DEFAULT_FILTERS, showMeetings: false }, { myId: 'me' })).toEqual([]);
  });
});

// The calendar's rules are copies of the web's (lib/calendar.ts, calendar-model.ts, calendar-meetings.ts):
// run both over the same inputs.
const WEB = resolve(__dirname, '../../Web Portal/frontend/src/lib');
const load = async (name) => (existsSync(resolve(WEB, name)) ? import(pathToFileURL(resolve(WEB, name)).href) : null);
const webCal = await load('calendar.ts');
const webModel = await load('calendar-model.ts');
const webMeet = await load('calendar-meetings.ts');
const webDue = await load('due-date.ts');

describe.skipIf(!webCal || !webModel || !webMeet || !webDue)('the calendar matches the web’s (lib/calendar*.ts)', () => {
  const KEYS = ['2026-01-01', '2026-02-28', '2026-03-31', '2026-10-21', '2026-12-31', '2028-02-29', '2027-06-15'];
  const STARTS = [0, 1, 6];

  it('the same weeks, ranges and month steps', () => {
    for (const key of KEYS) {
      for (const ws of STARTS) {
        const [y, m] = key.split('-').map(Number);
        expect(monthWeeks(y, m - 1, ws), `${key} ${ws}`).toEqual(webCal.monthWeeks(y, m - 1, ws));
        expect(weekDays(key, ws)).toEqual(webCal.weekDays(key, ws));
        for (const view of ['month', 'week', 'agenda']) expect(visibleRange(view, key, ws)).toEqual(webCal.visibleRange(view, key, ws));
      }
      for (const n of [-13, -1, 1, 12]) expect(shiftMonth(key, n)).toEqual(webCal.shiftMonth(key, n));
    }
    for (const ws of STARTS) expect(weekdayLabels(ws)).toEqual(webCal.weekdayLabels(ws));
  });

  it('the same items, statuses, order and filters', () => {
    const tasks = [
      task('a', { dueDate: '2026-10-19T00:00:00.000Z' }), task('b', { columnCategory: 'REVIEW', priority: 'HIGH' }),
      task('c', { completedAt: '2026-10-20T08:00:00Z' }), task('d', { columnCategory: 'BLOCKED', projectId: 'p2', assignees: [{ id: 'me' }] }),
      task('e', { dueDate: '2026-10-21T21:30:00.000Z', priority: 'URGENT' }), task('f', { dueDate: null }),
    ];
    const data = { tasks, occurrences: [{ taskId: 'r1', seriesId: 'r1', date: '2026-10-28' }, { taskId: 'zz', seriesId: 'zz', date: '2026-10-29' }], series: [task('r1', { recurrenceRule: { freq: 'DAILY' } })] };
    for (const timeZone of ['Asia/Muscat', 'UTC', 'America/Los_Angeles']) {
      const ctx = { today: '2026-10-21', timeZone, projectStatus: (id) => (id === 'p2' ? 'ARCHIVED' : 'ACTIVE') };
      const mine = buildItems(data, ctx);
      expect(mine).toEqual(webModel.buildItems(data, ctx));
      expect([...groupByDay(mine)]).toEqual([...webModel.groupByDay(mine)]);
      for (const f of [{}, { mine: true }, { showCompleted: false }, { showProjected: false }, { showArchived: true }, { showMeetings: false }]) {
        const filters = { ...webModel.DEFAULT_FILTERS, ...f };
        expect(applyFilters(mine, filters, { myId: 'me' })).toEqual(webModel.applyFilters(mine, filters, { myId: 'me' }));
      }
    }
    expect(DEFAULT_FILTERS).toEqual(webModel.DEFAULT_FILTERS);
  });

  it('the same meetings, days and ranges', () => {
    const meetings = [
      { id: 'm1', title: 'A', startAt: '2026-10-21T20:30:00.000Z', endAt: '2026-10-21T21:30:00.000Z', status: 'SCHEDULED', projectId: 'p1', organizerId: 'me', location: null, recurrenceRule: { freq: 'WEEKLY' }, recurrenceParentId: null },
      { id: 'm2', title: 'B', startAt: '2026-10-21T05:00:00.000Z', endAt: null, status: 'COMPLETED', projectId: null, organizerId: 'u2', location: 'X', recurrenceRule: null, recurrenceParentId: null },
    ];
    for (const tz of ['Asia/Muscat', 'UTC', 'Pacific/Kiritimati']) {
      expect(meetingItems(meetings, tz)).toEqual(webMeet.meetingItems(meetings, tz));
      expect(meetingRange('2026-10-01', '2026-11-07', tz)).toEqual(webMeet.meetingRange('2026-10-01', '2026-11-07', tz));
      for (const key of KEYS) expect(zonedStartOfDay(key, tz).toISOString()).toBe(webDue.zonedStartOfDay(key, tz).toISOString());
      for (const f of [{}, { mine: true }, { showCompleted: false }, { showMeetings: false }]) {
        const filters = { ...webModel.DEFAULT_FILTERS, ...f };
        const items = meetingItems(meetings, tz);
        expect(filterCalendarMeetings(items, filters, { myId: 'me' })).toEqual(webMeet.filterCalendarMeetings(items, filters, { myId: 'me' }));
      }
    }
  });
});
