import { monthDays, monthPlace, type MonthClock, type MonthTask } from './board-month';
import { shiftDayKey } from '../../lib/due-date';

/**
 * Kanban Board: Monthly View on the server. The database is asked for a window around the month (a
 * day wider each side: a stored instant is read in the company time zone, a date-only value is its
 * UTC day), then the exact month rule (board-month.ts) runs on those rows. Plain Prisma filters: no raw
 * SQL, so nothing differs between MySQL and MariaDB.
 */
export interface MonthWindow {
  /** From UTC midnight of the day before the month's first day… */
  from: Date;
  /** …up to (not including) UTC midnight two days after its last day. */
  to: Date;
  /** The current month: open tasks due before it are asked for too (overdue ones carry into it). */
  carry: boolean;
}

export function monthWindow(month: string, clock: MonthClock): MonthWindow {
  const { first, last } = monthDays(month);
  return {
    from: new Date(`${shiftDayKey(first, -1)}T00:00:00.000Z`),
    to: new Date(`${shiftDayKey(last, 2)}T00:00:00.000Z`),
    carry: month === clock.today.slice(0, 7),
  };
}

/**
 * The month's rows, in the order given (with the tasks that have no dates when `withUndated`), and how
 * many of the given rows have no dates (the board's "No date (12)").
 */
export function inMonth<T extends MonthTask>(rows: T[], month: string, clock: MonthClock, withUndated: boolean): { rows: T[]; undated: number } {
  let undated = 0;
  const shown = rows.filter((t) => {
    const place = monthPlace(t, month, clock);
    if (place === 'undated') undated += 1;
    return place === 'month' || place === 'carried' || (place === 'undated' && withUndated);
  });
  return { rows: shown, undated };
}
