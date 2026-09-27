import { dueDayKey, type DateInput } from './due-date';

/**
 * Display a due date as its calendar day (the day the user picked), never shifted by the device's
 * time zone. E.g. formatDueDay('2026-09-30T00:00:00.000Z', tz) → "Sep 30, 2026".
 */
export function formatDueDay(
  due: DateInput,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const key = dueDayKey(due, timeZone);
  if (!key) return '';
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00.000Z`));
}

/** 'YYYY-MM-DD' for a date `<input type="date">` from a stored due date (its calendar day). */
export function dueInputValue(due: DateInput, timeZone: string): string {
  return dueDayKey(due, timeZone) ?? '';
}

/** A task counts as finished when it sits in a DONE column or has a completion time. */
export function isTaskDone(t: { columnCategory?: string | null; completedAt?: string | null }): boolean {
  return t.columnCategory === 'DONE' || !!t.completedAt;
}
