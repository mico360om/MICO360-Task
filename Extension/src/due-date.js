/**
 * Calendar-day rules for due dates and board days (XP-03 / EXT-03). Same rules as the web app's
 * `lib/due-date.ts`.
 *
 * Due dates are calendar days. Clients send 'YYYY-MM-DD' and the API stores that as UTC midnight,
 * so a due date's calendar day is its UTC date and must never be shifted into another zone:
 * 2026-09-30T00:00Z is 04:00 in Muscat, but the task is still due on the 30th. "Today" is the date in
 * the company time zone. A task is overdue only once its due day is before today; a finished task
 * is never overdue.
 */

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value) {
  return typeof value === 'string' && KEY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD' of an instant in an IANA time zone. */
export function zonedDayKey(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Today's 'YYYY-MM-DD' in the company time zone. */
export function todayKey(timeZone, now = new Date()) {
  return zonedDayKey(now instanceof Date ? now : new Date(now), timeZone);
}

/**
 * Calendar day of a stored due date. Date-only values (a bare 'YYYY-MM-DD', or an instant at exactly
 * UTC midnight) keep their UTC date; any other instant is read in the company zone.
 */
export function dueDayKey(due, timeZone) {
  if (typeof due === 'string' && KEY_RE.test(due)) return due;
  const d = toDate(due);
  if (!d) return null;
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return utcMidnight ? d.toISOString().slice(0, 10) : zonedDayKey(d, timeZone);
}

/** Shift a 'YYYY-MM-DD' key by whole days (noon-UTC arithmetic avoids DST edges). */
export function shiftDayKey(key, days) {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from today to the due day: 0 = due today, negative = overdue, null = no due date. */
export function daysUntilDue(due, timeZone, now = new Date()) {
  const key = dueDayKey(due, timeZone);
  if (!key) return null;
  const today = todayKey(timeZone, now);
  return Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

/** True once the due day is before today (company time). A missing due date is never overdue. */
export function isOverdue(due, timeZone, now = new Date()) {
  const days = daysUntilDue(due, timeZone, now);
  return days !== null && days < 0;
}

export function isDueToday(due, timeZone, now = new Date()) {
  return daysUntilDue(due, timeZone, now) === 0;
}

/** Human label for a day key, e.g. "Wed, Sep 30" (add the year with `{ year: true }`). */
export function formatDayKey(key, { weekday = true, year = false } = {}) {
  if (!isDayKey(key)) return '';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    ...(weekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
  }).format(new Date(`${key}T12:00:00.000Z`));
}

/** "Today" / "Yesterday" / "Tomorrow" relative to `today`, or ''. */
export function relativeDayHint(key, today) {
  if (key === today) return 'Today';
  if (key === shiftDayKey(today, -1)) return 'Yesterday';
  if (key === shiftDayKey(today, 1)) return 'Tomorrow';
  return '';
}
