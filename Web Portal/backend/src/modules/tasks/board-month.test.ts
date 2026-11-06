import { describe, it, expect } from 'vitest';
import { dayKeyOf, isMonthKey, monthDays, monthPlace, nearestMonth, shiftMonth, type MonthClock, type MonthTask } from './board-month';

// Kanban Board: Monthly View — the month rule (owner, 6 Nov; design calls, 7 Nov).
const TZ = 'Asia/Muscat'; // UTC+4
const clock: MonthClock = { timeZone: TZ, today: '2026-11-07' };
/** A date-only value as the API stores it: UTC midnight of the day. */
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const open = (t: MonthTask): MonthTask => ({ columnCategory: 'TODO', completedAt: null, ...t });
const places = (t: MonthTask, months: string[], c: MonthClock = clock) => months.map((m) => monthPlace(t, m, c));

describe('month keys', () => {
  it('a month is YYYY-MM', () => {
    expect(isMonthKey('2026-11')).toBe(true);
    expect(isMonthKey('2026-01')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-11', '2026-11-01', '', null, 202611]) expect(isMonthKey(bad), String(bad)).toBe(false);
  });

  it('shifts across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', -13)).toBe('2025-10');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });

  it('knows each month’s first and last day (leap years too)', () => {
    expect(monthDays('2026-11')).toEqual({ first: '2026-11-01', last: '2026-11-30' });
    expect(monthDays('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthDays('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(monthDays('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
  });

  it('a stored date-only value is its own day; any other instant is read in the company time zone', () => {
    expect(dayKeyOf(day('2026-12-01'), 'America/New_York')).toBe('2026-12-01');
    expect(dayKeyOf('2026-12-01', TZ)).toBe('2026-12-01');
    expect(dayKeyOf(new Date('2026-10-31T21:30:00Z'), TZ)).toBe('2026-11-01');
    expect(dayKeyOf('2026-10-31T21:30:00.000Z', TZ)).toBe('2026-11-01');
    expect(dayKeyOf(null, TZ)).toBeNull();
    expect(dayKeyOf('not a date', TZ)).toBeNull();
  });
});

describe('which months an open task shows in', () => {
  it('a start and a due date: every month from the start’s to the due’s', () => {
    const t = open({ startDate: day('2026-10-05'), dueDate: day('2026-12-20') });
    expect(places(t, ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'])).toEqual([null, 'month', 'month', 'month', null]);
  });

  it('a start and a due date in one month: only that month', () => {
    const t = open({ startDate: day('2026-12-05'), dueDate: day('2026-12-20') });
    expect(places(t, ['2026-11', '2026-12', '2027-01'])).toEqual([null, 'month', null]);
  });

  it('only a due date: its due month', () => {
    const t = open({ startDate: null, dueDate: day('2026-12-18') });
    expect(places(t, ['2026-11', '2026-12', '2027-01'])).toEqual([null, 'month', null]);
  });

  it('only a start date: from its start month onward while open', () => {
    const t = open({ startDate: day('2026-10-05'), dueDate: null });
    expect(places(t, ['2026-09', '2026-10', '2026-11', '2026-12', '2027-05'])).toEqual([null, 'month', 'month', 'month', 'month']);
  });

  it('an automatic start (the moment it was made) counts on the company’s day: 21:30 UTC on 31 Oct is 1 Nov in Muscat', () => {
    const t = open({ startDate: new Date('2026-10-31T21:30:00Z'), dueDate: null });
    expect(places(t, ['2026-10', '2026-11'])).toEqual([null, 'month']);
    // A zone behind UTC reads the same instant as 31 Oct.
    expect(places(t, ['2026-10', '2026-11'], { timeZone: 'America/New_York', today: '2026-11-07' })).toEqual(['month', 'month']);
  });

  it('a due date at a month’s edge stays on its own day, whatever the zone', () => {
    const t = open({ dueDate: day('2026-12-01') });
    expect(places(t, ['2026-11', '2026-12'], { timeZone: 'America/New_York', today: '2026-11-07' })).toEqual([null, 'month']);
    expect(places(t, ['2026-11', '2026-12'], { timeZone: 'Pacific/Kiritimati', today: '2026-11-07' })).toEqual([null, 'month']);
  });

  it('dates the website sends as text are read the same', () => {
    const t = open({ startDate: '2026-10-05T00:00:00.000Z', dueDate: '2026-12-20T00:00:00.000Z' });
    expect(places(t, ['2026-09', '2026-10', '2026-12', '2027-01'])).toEqual([null, 'month', 'month', null]);
  });

  it('a start after its due date (older data): its due month', () => {
    const t = open({ startDate: day('2026-12-10'), dueDate: day('2026-10-20') });
    expect(places(t, ['2026-10', '2026-12'])).toEqual(['month', null]);
  });
});

describe('overdue tasks carry over into the current month only', () => {
  it('open and due in an earlier month: also in this month — not the months between, nor a future one', () => {
    const t = open({ startDate: day('2026-08-01'), dueDate: day('2026-09-15') });
    expect(places(t, ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'])).toEqual([null, 'month', 'month', null, 'carried', null]);
  });

  it('only a due date, last month: in its month, and carried into this one', () => {
    const t = open({ dueDate: day('2026-10-30') });
    expect(places(t, ['2026-10', '2026-11', '2026-12'])).toEqual(['month', 'carried', null]);
  });

  it('overdue earlier this month: simply this month’s', () => {
    expect(monthPlace(open({ dueDate: day('2026-11-02') }), '2026-11', clock)).toBe('month');
  });

  it('“this month” is the company’s: 23:00 UTC on 30 Nov is already December in Muscat', () => {
    const t = open({ dueDate: day('2026-11-15') });
    const muscat: MonthClock = { timeZone: TZ, today: dayKeyOf(new Date('2026-11-30T23:00:00Z'), TZ)! };
    expect(muscat.today).toBe('2026-12-01');
    expect(places(t, ['2026-11', '2026-12'], muscat)).toEqual(['month', 'carried']);
  });

  it('a task waiting for approval is still open: it carries over too', () => {
    const t = open({ columnCategory: 'REVIEW', dueDate: day('2026-10-30'), approvalRequestedAt: new Date('2026-10-29T08:00:00Z') } as MonthTask);
    expect(monthPlace(t, '2026-11', clock)).toBe('carried');
  });

  it('a finished task never carries over', () => {
    const t: MonthTask = { columnCategory: 'DONE', completedAt: new Date('2026-10-02T08:00:00Z'), dueDate: day('2026-09-15') };
    expect(places(t, ['2026-09', '2026-10', '2026-11'])).toEqual([null, 'month', null]);
  });
});

describe('done tasks: the month they were completed only', () => {
  it('whatever its start and due dates', () => {
    const t: MonthTask = { columnCategory: 'DONE', completedAt: new Date('2026-11-03T08:00:00Z'), startDate: day('2026-09-01'), dueDate: day('2026-12-20') };
    expect(places(t, ['2026-09', '2026-10', '2026-11', '2026-12'])).toEqual([null, null, 'month', null]);
  });

  it('completed at 00:30 on 1 Nov in Muscat (20:30 UTC on 31 Oct): November', () => {
    const t: MonthTask = { columnCategory: 'DONE', completedAt: new Date('2026-10-31T20:30:00Z') };
    expect(places(t, ['2026-10', '2026-11'])).toEqual([null, 'month']);
  });

  it('a completion time counts even outside a Done column (it is finished)', () => {
    const t: MonthTask = { columnCategory: 'TODO', completedAt: new Date('2026-10-10T08:00:00Z'), dueDate: day('2026-09-01') };
    expect(places(t, ['2026-09', '2026-10', '2026-11'])).toEqual([null, 'month', null]);
  });

  it('in a Done column with no completion time (older data): the month of its last change', () => {
    const t: MonthTask = { columnCategory: 'DONE', completedAt: null, updatedAt: new Date('2026-10-12T08:00:00Z'), dueDate: day('2026-09-01') };
    expect(places(t, ['2026-09', '2026-10', '2026-11'])).toEqual([null, 'month', null]);
  });

  it('a done task without dates is never “No date”', () => {
    expect(monthPlace({ columnCategory: 'DONE', completedAt: new Date('2026-11-03T08:00:00Z') }, '2026-10', clock)).toBeNull();
  });
});

describe('tasks without dates', () => {
  it('are “undated” whichever month is shown (the No date chip adds them)', () => {
    const t = open({ startDate: null, dueDate: null });
    expect(places(t, ['2025-01', '2026-11', '2030-06'])).toEqual(['undated', 'undated', 'undated']);
  });
});

describe('where to find a task that isn’t in the month shown', () => {
  it('nothing to say when it is there, or has no dates', () => {
    expect(nearestMonth(open({ dueDate: day('2026-11-20') }), '2026-11', clock)).toBeNull();
    expect(nearestMonth(open({}), '2026-11', clock)).toBeNull();
  });

  it('the month of its span nearest the one shown', () => {
    const t = open({ startDate: day('2026-11-05'), dueDate: day('2026-12-20') });
    expect(nearestMonth(t, '2026-10', clock)).toBe('2026-11');
    expect(nearestMonth(t, '2027-03', clock)).toBe('2026-12');
    expect(nearestMonth(open({ startDate: day('2027-02-01') }), '2026-11', clock)).toBe('2027-02');
  });

  it('a finished task: its completion month', () => {
    expect(nearestMonth({ columnCategory: 'DONE', completedAt: new Date('2026-11-03T08:00:00Z') }, '2026-10', clock)).toBe('2026-11');
  });

  it('an overdue one: this month, when that is nearer than its own months', () => {
    const t = open({ dueDate: day('2026-09-15') });
    expect(nearestMonth(t, '2027-01', clock)).toBe('2026-11');
    expect(nearestMonth(t, '2026-08', clock)).toBe('2026-09');
  });

  it('as near as its own month: this month, where it waits overdue (e.g. reopened while looking at October)', () => {
    expect(nearestMonth(open({ dueDate: day('2026-09-15') }), '2026-10', clock)).toBe('2026-11');
  });
});
