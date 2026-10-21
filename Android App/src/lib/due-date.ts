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

/** The company's time zone (the server's /config) and your own (the website's settings, or none). */
export interface DateZones {
  company: string;
  own: string | null;
}

let zones: DateZones = { company: COMPANY_TIMEZONE, own: null };
const timeZoneListeners = new Set<() => void>();

/**
 * The time zone the app shows dates in, as the website does: the company's (Asia/Muscat until the
 * server says otherwise; see date-settings). Every function here defaults to it: "today" for
 * boards and overdue checks, due days, meeting times.
 */
export function appTimeZone(): string {
  return zones.company;
}

/** The calendar's time zone, as on the website: your own, else the company's. */
export function calendarTimeZone(): string {
  return zones.own ?? zones.company;
}

/** Both zones; the same object until one changes (a useSyncExternalStore snapshot). */
export function dateZones(): DateZones {
  return zones;
}

/** Set both zones; subscribers (the navigator) re-render when either changed. */
export function setDateZones(next: DateZones): void {
  if (next.company === zones.company && next.own === zones.own) return;
  zones = { company: next.company, own: next.own };
  for (const listener of timeZoneListeners) listener();
}

/** Switch the company's time zone only. */
export function setAppTimeZone(timeZone: string): void {
  setDateZones({ ...zones, company: timeZone });
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

/**
 * Is the task finished? Completed, or sitting in a Done column — a task can be there without a
 * completion time — the server's rule (isTaskDone).
 */
export function isTaskDone(task: { completedAt?: DateInput; columnCategory?: string | null }): boolean {
  return task.columnCategory === 'DONE' || !!task.completedAt;
}

/** True once the due day is before today (company time). Finished tasks are never overdue. */
export function isOverdue(
  task: { dueDate: DateInput; completedAt?: DateInput; columnCategory?: string | null },
  now: Date = new Date(),
  timeZone: string = appTimeZone(),
): boolean {
  if (isTaskDone(task)) return false;
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
