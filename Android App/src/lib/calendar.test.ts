import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dayLabel,
  fullDayLabel,
  monthGrid,
  monthOf,
  monthWeeks,
  periodLabel,
  shiftDayKey,
  shiftMonth,
  stepCursor,
  visibleRange,
  weekDays,
  weekStartOf,
  weekdayLabels,
  type CalendarView,
  type WeekStart,
} from './calendar';

const dow = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();

describe('the week start', () => {
  it('is your setting when it is Sunday, Monday or Saturday, else Sunday (as on the website)', () => {
    expect(weekStartOf({ weekStart: 1 })).toBe(1);
    expect(weekStartOf({ weekStart: 6 })).toBe(6);
    expect(weekStartOf({ weekStart: 0 })).toBe(0);
    expect(weekStartOf({ weekStart: null })).toBe(0);
    expect(weekStartOf(null)).toBe(0);
    expect(weekStartOf(undefined)).toBe(0);
    expect(weekStartOf({ weekStart: 3 as unknown as 1 })).toBe(0);
  });

  it('orders the weekday names', () => {
    expect(weekdayLabels(0)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(weekdayLabels(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(6)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  });
});

describe('the month grid', () => {
  it('starts every week on the week start and keeps only the weeks that touch the month', () => {
    // October 2026 starts on a Thursday.
    const sunday = monthWeeks(2026, 9, 0);
    expect(sunday[0]![0]!.key).toBe('2026-09-27');
    expect(sunday.at(-1)!.at(-1)!.key).toBe('2026-10-31');
    expect(sunday).toHaveLength(5);
    const monday = monthWeeks(2026, 9, 1);
    expect(monday[0]![0]!.key).toBe('2026-09-28');
    expect(monday.at(-1)!.at(-1)!.key).toBe('2026-11-01');
    const saturday = monthWeeks(2026, 9, 6);
    expect(saturday[0]![0]!.key).toBe('2026-09-26');
    for (const week of saturday) expect(dow(week[0]!.key)).toBe(6);
    expect(monthGrid(2026, 9, 0)).toHaveLength(6);
    expect(sunday[0]!.map((c) => c.inMonth)).toEqual([false, false, false, false, true, true, true]);
  });

  it('gives each view its days: the month’s weeks, the week, or the month as a list', () => {
    expect(visibleRange('month', '2026-10-21', 0)).toEqual({ from: '2026-09-27', to: '2026-10-31' });
    expect(visibleRange('week', '2026-10-21', 1)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(visibleRange('week', '2026-10-21', 6)).toEqual({ from: '2026-10-17', to: '2026-10-23' });
    expect(visibleRange('agenda', '2026-10-21', 1)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(weekDays('2026-10-21', 0)).toEqual(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  });

  it('steps a week or a month at a time, never overflowing from the 31st', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftDayKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(stepCursor('week', '2026-10-21', 1)).toBe('2026-10-28');
    expect(stepCursor('week', '2026-10-21', -1)).toBe('2026-10-14');
    expect(stepCursor('month', '2026-10-21', 1)).toBe('2026-11-01');
    expect(stepCursor('agenda', '2026-10-21', -1)).toBe('2026-09-01');
    expect(monthOf('2026-10-21')).toEqual({ year: 2026, month0: 9 });
  });
});

describe('day and period names (the website’s words, whatever the phone’s language or zone)', () => {
  it('names a day', () => {
    expect(dayLabel('2026-10-10')).toBe('Sat 10 Oct');
    expect(dayLabel('2026-10-10', { weekday: 'long', day: true, month: 'long' })).toBe('Saturday 10 October');
    expect(dayLabel('2026-10-10', { weekday: 'short' })).toBe('Sat');
    expect(dayLabel('2026-10-10', { day: true, month: 'short' })).toBe('10 Oct');
    expect(dayLabel('2026-10-10', { month: 'long', year: true })).toBe('October 2026');
    expect(fullDayLabel('2026-01-04')).toBe('Sun 4 Jan 2026');
  });

  it('names the period a view shows', () => {
    expect(periodLabel('month', '2026-10-21', 0)).toBe('October 2026');
    expect(periodLabel('agenda', '2026-10-21', 0)).toBe('October 2026');
    expect(periodLabel('week', '2026-10-21', 0)).toBe('18 – 24 Oct 2026');
    expect(periodLabel('week', '2026-09-30', 0)).toBe('27 Sep – 3 Oct 2026');
    expect(periodLabel('week', '2026-12-30', 1)).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});

/**
 * The website's calendar (Web Portal/frontend/src/lib/calendar.ts) and this one must lay out the
 * same days and ask the server for the same ranges. Skipped when the website's code isn't next to
 * the app.
 */
const webCalendar = resolve(__dirname, '../../../Web Portal/frontend/src/lib/calendar.ts');
describe.skipIf(!existsSync(webCalendar))('the same as the website', () => {
  type Fn = (...args: unknown[]) => unknown;
  const load = async () => (await import(/* @vite-ignore */ webCalendar)) as Record<string, Fn>;
  const starts: WeekStart[] = [0, 1, 6];
  const days = ['2026-01-01', '2026-02-28', '2026-03-31', '2026-10-21', '2026-12-31', '2027-02-14', '2028-02-29'];
  const views: CalendarView[] = ['month', 'week', 'agenda'];

  it('lays out the same grids, weeks and ranges', async () => {
    const web = await load();
    for (const ws of starts) {
      expect(weekdayLabels(ws)).toEqual(web.weekdayLabels!(ws));
      for (const day of days) {
        const { year, month0 } = monthOf(day);
        expect(monthOf(day)).toEqual(web.monthOf!(day));
        expect(monthGrid(year, month0, ws), `${day} ${ws}`).toEqual(web.monthGrid!(year, month0, ws));
        expect(monthWeeks(year, month0, ws)).toEqual(web.monthWeeks!(year, month0, ws));
        expect(weekDays(day, ws)).toEqual(web.weekDays!(day, ws));
        for (const v of views) expect(visibleRange(v, day, ws), `${v} ${day} ${ws}`).toEqual(web.visibleRange!(v, day, ws));
        for (const n of [-13, -1, 1, 12]) expect(shiftMonth(day, n)).toEqual(web.shiftMonth!(day, n));
      }
    }
  });
});
