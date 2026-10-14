import type { ApiTask } from '../api/tasks';
import { dueDayKey } from './due-date';

export interface DateGroup {
  date: string; // YYYY-MM-DD
  tasks: ApiTask[];
}

/**
 * Group tasks that have a due date by their due *calendar day*, sorted chronologically. A date-only
 * due date keeps its day; any other instant is read in `timeZone` (the company zone).
 */
export function groupTasksByDueDate(tasks: ApiTask[], timeZone = 'UTC'): DateGroup[] {
  const map = new Map<string, ApiTask[]>();
  for (const t of tasks) {
    const date = dueDayKey(t.dueDate, timeZone);
    if (!date) continue;
    const arr = map.get(date) ?? [];
    arr.push(t);
    map.set(date, arr);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, dayTasks]) => ({ date, tasks: dayTasks }));
}

export interface DayCell {
  /** YYYY-MM-DD (UTC-anchored, matches a task's `dueDate.slice(0,10)`). */
  key: string;
  day: number;
  /** True when this day belongs to the grid's month (vs. leading/trailing days). */
  inMonth: boolean;
}

/** The first day of the week: 0 = Sunday, 1 = Monday, 6 = Saturday. */
export type WeekStart = 0 | 1 | 6;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The seven weekday names in the order the week starts. */
export function weekdayLabels(weekStart: WeekStart = 0): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart + i) % 7]!);
}

/**
 * A 6-week × 7-day month grid for `month0` (0=January) of `year`, starting on `weekStart`,
 * including the leading/trailing days of adjacent months so every week is full. UTC-anchored so its
 * keys line up with `groupTasksByDueDate` (which slices the task's ISO due date).
 */
export function monthGrid(year: number, month0: number, weekStart: WeekStart = 0): DayCell[][] {
  const first = new Date(Date.UTC(year, month0, 1));
  const cur = new Date(first);
  cur.setUTCDate(1 - ((first.getUTCDay() - weekStart + 7) % 7)); // back up to the week's first day
  const weeks: DayCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ key: cur.toISOString().slice(0, 10), day: cur.getUTCDate(), inMonth: cur.getUTCMonth() === month0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Only the weeks of the grid that touch the month (4 to 6): no rows of next month's days. */
export function monthWeeks(year: number, month0: number, weekStart: WeekStart = 0): DayCell[][] {
  return monthGrid(year, month0, weekStart).filter((week) => week.some((c) => c.inMonth));
}

/** The 7 day-keys of the week containing `dateKey` (YYYY-MM-DD), starting on `weekStart`. */
export function weekDays(dateKey: string, weekStart: WeekStart = 0): string[] {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - weekStart + 7) % 7));
  return Array.from({ length: 7 }, () => {
    const key = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return key;
  });
}

/** The first day ('YYYY-MM-01') of the month `months` away from the month containing `dateKey`. */
export function shiftMonth(dateKey: string, months: number): string {
  const [y, m] = dateKey.split('-').map(Number) as [number, number];
  // Anchor on day 1 so stepping from the 29th–31st never overflows into the month after.
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

/** Year + 0-based month of a 'YYYY-MM-DD' key. */
export function monthOf(dateKey: string): { year: number; month0: number } {
  const [y, m] = dateKey.split('-').map(Number) as [number, number];
  return { year: y, month0: m - 1 };
}

export type CalendarView = 'month' | 'week' | 'agenda';

/** The days a view shows — and asks the server for: the month's grid, the week, or the month as a list. */
export function visibleRange(view: CalendarView, cursor: string, weekStart: WeekStart = 0): { from: string; to: string } {
  if (view === 'week') {
    const days = weekDays(cursor, weekStart);
    return { from: days[0]!, to: days[6]! };
  }
  const { year, month0 } = monthOf(cursor);
  if (view === 'agenda') {
    const last = new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
    return { from: `${cursor.slice(0, 7)}-01`, to: last };
  }
  const flat = monthWeeks(year, month0, weekStart).flat();
  return { from: flat[0]!.key, to: flat[flat.length - 1]!.key };
}
