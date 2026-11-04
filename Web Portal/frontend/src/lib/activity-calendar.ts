/**
 * The Activity page's calendar (1.22): which days a month or a week shows, how busy each day looks,
 * and its words. Days are 'YYYY-MM-DD' keys of the site's time zone (the server counts in it too).
 */
import { monthOf, monthWeeks, shiftMonth, weekDays, type DayCell, type WeekStart } from './calendar';
import { shiftDayKey } from './due-date';
import { dayText } from './day-words';

export type ActivityCalendarMode = 'month' | 'week';

/** Per-person names (lib/user-storage): List or Calendar, and Month or Week. */
export const ACTIVITY_VIEW_PREF = 'activity.view';
export const ACTIVITY_PERIOD_PREF = 'activity.calendar';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The days a month (its whole weeks) or a week shows, as rows of seven, and the first and last of them. */
export function calendarPeriod(mode: ActivityCalendarMode, cursor: string, weekStart: WeekStart): { from: string; to: string; weeks: DayCell[][] } {
  const weeks =
    mode === 'week'
      ? [weekDays(cursor, weekStart).map((key) => ({ key, day: Number(key.slice(8, 10)), inMonth: true }))]
      : (() => {
          const { year, month0 } = monthOf(cursor);
          return monthWeeks(year, month0, weekStart);
        })();
  const flat = weeks.flat();
  return { from: flat[0]!.key, to: flat[flat.length - 1]!.key, weeks };
}

/** Previous (-1) or Next (1): a month away (its first day), or a week away. */
export function stepCursor(mode: ActivityCalendarMode, cursor: string, dir: 1 | -1): string {
  return mode === 'week' ? shiftDayKey(cursor, 7 * dir) : shiftMonth(cursor, dir);
}

/**
 * How busy a day looks: 0 with no changes, then four steps from quiet (1) to busy (4) against the
 * busiest day shown, so a small team's busy day and a large one's both read as busy.
 */
export function shadeStep(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * count) / max))) as 1 | 2 | 3 | 4;
}

/** "November 2026"; a week: "2 – 8 Nov 2026", "30 Nov – 6 Dec 2026", "28 Dec 2026 – 3 Jan 2027". */
export function periodText(mode: ActivityCalendarMode, cursor: string, weekStart: WeekStart): string {
  if (mode === 'month') {
    const { year, month0 } = monthOf(cursor);
    return `${MONTHS[month0]} ${year}`;
  }
  const days = weekDays(cursor, weekStart);
  const first = days[0]!;
  const last = days[6]!;
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${dayText(first)} – ${dayText(last)}`;
  if (first.slice(0, 7) !== last.slice(0, 7)) return `${dayText(first, { year: false })} – ${dayText(last)}`;
  return `${Number(first.slice(8, 10))} – ${dayText(last)}`;
}

/** "No changes", "1 change", "12 changes". */
export function changesText(n: number): string {
  return n === 0 ? 'No changes' : n === 1 ? '1 change' : `${n} changes`;
}
