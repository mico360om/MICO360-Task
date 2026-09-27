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

/**
 * A 6-week × 7-day month grid (Sunday-first) for `month0` (0=January) of `year`, including the
 * leading/trailing days of adjacent months so every week is full. UTC-anchored so its keys line up
 * with `groupTasksByDueDate` (which slices the task's ISO due date).
 */
export function monthGrid(year: number, month0: number): DayCell[][] {
  const first = new Date(Date.UTC(year, month0, 1));
  const cur = new Date(first);
  cur.setUTCDate(1 - first.getUTCDay()); // back up to the Sunday on/before the 1st
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

/** The 7 day-keys (Sunday-first) of the week containing `dateKey` (YYYY-MM-DD). */
export function weekDays(dateKey: string): string[] {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
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
