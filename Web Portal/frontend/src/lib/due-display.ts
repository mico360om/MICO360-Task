import { dueDayKey, isOverdue, type DateInput } from './due-date';
import { dayText } from './day-words';
import { isWaitingForApproval } from './approvals';

/**
 * Display a due date as its calendar day (the day the user picked), never shifted by the device's
 * time zone, day before month as the minutes PDF and the daily emails write it.
 * E.g. formatDueDay('2026-09-30T00:00:00.000Z', tz) → "30 Sep 2026"; with { weekday: 'short',
 * month: 'short', day: 'numeric' } → "Wed 30 Sep". Of the options, the weekday, the month's length
 * and whether there is a year are used.
 */
export function formatDueDay(
  due: DateInput,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const key = dueDayKey(due, timeZone);
  if (!key) return '';
  const weekday = opts.weekday === 'long' ? 'long' : opts.weekday ? 'short' : undefined;
  return dayText(key, { weekday, month: opts.month === 'long' ? 'long' : 'short', year: opts.year !== undefined });
}

/** 'YYYY-MM-DD' for a date `<input type="date">` from a stored due date (its calendar day). */
export function dueInputValue(due: DateInput, timeZone: string): string {
  return dueDayKey(due, timeZone) ?? '';
}

/** A task counts as finished when it sits in a DONE column or has a completion time. */
export function isTaskDone(t: { columnCategory?: string | null; completedAt?: string | null }): boolean {
  return t.columnCategory === 'DONE' || !!t.completedAt;
}

/**
 * Late (overdue): not done and past its due day in the company time zone — but never while it waits
 * for approval: the work is handed in, and the page shows the "Waiting for approval" badge instead
 * (owner, 30 Oct; approvals ruling 45). Sent back, it no longer waits and is late again. The server's
 * rule is the same (tasks/task-status `isTaskLate`).
 */
export function isTaskLate(
  t: { dueDate?: DateInput; columnCategory?: string | null; completedAt?: string | null; approvalRequestedAt?: string | null },
  timeZone: string,
  now: Date = new Date(),
): boolean {
  return !isTaskDone(t) && !isWaitingForApproval(t) && isOverdue(t.dueDate, timeZone, now);
}
