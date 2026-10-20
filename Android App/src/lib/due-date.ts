/**
 * Due-date rules shared by every "overdue / due today / upcoming" decision in the mobile app —
 * the same rules as the web portal and the API (XP-03).
 *
 * Due dates are calendar days. The app sends them as 'YYYY-MM-DD' and the API stores that as UTC
 * midnight, so a due date's calendar day is its UTC date and must never be shifted into another
 * zone: 2026-09-30T00:00Z is 04:00 in Muscat, but the task is still due on the 30th.
 * "Today" is the date in the company time zone. A task is overdue only once its due day is before
 * today, and completed tasks are never overdue.
 */

/** The default company time zone, until the server and your settings say otherwise. */
export const COMPANY_TIMEZONE = 'Asia/Muscat';

let currentTimeZone = COMPANY_TIMEZONE;
const timeZoneListeners = new Set<() => void>();

/**
 * The time zone the app shows dates in: your own (from the website's settings), else the company's
 * (the server's /config), else Asia/Muscat — set once signed in (see date-settings). Every function
 * here defaults to it: "today" for boards, calendars and overdue checks.
 */
export function appTimeZone(): string {
  return currentTimeZone;
}

/** Switch the app's time zone; subscribers (the screens) re-render. */
export function setAppTimeZone(timeZone: string): void {
  if (timeZone === currentTimeZone) return;
  currentTimeZone = timeZone;
  for (const listener of timeZoneListeners) listener();
}

/** Be told when the app's time zone changes; returns the unsubscribe. */
export function subscribeTimeZone(listener: () => void): () => void {
  timeZoneListeners.add(listener);
  return () => {
    timeZoneListeners.delete(listener);
  };
}

export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD' of an instant in an IANA time zone. */
export function zonedDayKey(instant: Date, timeZone: string = appTimeZone()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Today's 'YYYY-MM-DD' in the company time zone. */
export function companyTodayKey(now: Date = new Date(), timeZone: string = appTimeZone()): string {
  return zonedDayKey(now, timeZone);
}

/**
 * Calendar day of a stored due date. Date-only values (a bare 'YYYY-MM-DD', or an instant at
 * exactly UTC midnight) keep their UTC date; any other instant is read in the company zone.
 */
export function dueDayKey(due: DateInput, timeZone: string = appTimeZone()): string | null {
  if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const d = toDate(due);
  if (!d) return null;
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return utcMidnight ? d.toISOString().slice(0, 10) : zonedDayKey(d, timeZone);
}

/** Whole days from today to the due day: 0 = due today, negative = overdue, null = no due date. */
export function daysUntilDue(due: DateInput, now: Date = new Date(), timeZone: string = appTimeZone()): number | null {
  const key = dueDayKey(due, timeZone);
  if (!key) return null;
  const today = companyTodayKey(now, timeZone);
  return Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

/** True once the due day is before today (company time). Completed tasks are never overdue. */
export function isOverdue(
  task: { dueDate: DateInput; completedAt?: DateInput },
  now: Date = new Date(),
  timeZone: string = appTimeZone(),
): boolean {
  if (task.completedAt) return false;
  const days = daysUntilDue(task.dueDate, now, timeZone);
  return days !== null && days < 0;
}

/**
 * A due date formatted for display, without shifting it across a day boundary (e.g. "Sep 30").
 * `locale` undefined → the device locale.
 */
export function formatDueDay(due: DateInput, locale?: string, timeZone: string = appTimeZone()): string | null {
  const key = dueDayKey(due, timeZone);
  if (!key) return null;
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${key}T12:00:00Z`));
}
