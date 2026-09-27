/**
 * Due-date rules shared by every "overdue / due today / on time" decision.
 *
 * Due dates are calendar days. Clients send them as 'YYYY-MM-DD' and the API stores that as UTC
 * midnight, so a due date's calendar day is its UTC date and must never be shifted into another
 * zone: 2026-09-30T00:00Z is 04:00 in Muscat, but the task is still due on the 30th.
 * "Today" is the date in the company time zone. A task is overdue only once its due day is
 * before today, and it was completed on time if it finished on or before its due day.
 */

export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD' of an instant in an IANA time zone. */
export function zonedDayKey(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Today's 'YYYY-MM-DD' in the company time zone. */
export function todayKey(timeZone: string, now: Date = new Date()): string {
  return zonedDayKey(now, timeZone);
}

/**
 * Calendar day of a stored due date. Date-only values (a bare 'YYYY-MM-DD', or an instant at
 * exactly UTC midnight) keep their UTC date; any other instant is read in the company zone.
 */
export function dueDayKey(due: DateInput, timeZone: string): string | null {
  if (typeof due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const d = toDate(due);
  if (!d) return null;
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return utcMidnight ? d.toISOString().slice(0, 10) : zonedDayKey(d, timeZone);
}

/** Shift a 'YYYY-MM-DD' key by whole days (noon-UTC arithmetic avoids DST edges). */
export function shiftDayKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from today to the due day: 0 = due today, negative = overdue, null = no due date. */
export function daysUntilDue(due: DateInput, timeZone: string, now: Date = new Date()): number | null {
  const key = dueDayKey(due, timeZone);
  if (!key) return null;
  const today = todayKey(timeZone, now);
  return Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

/** True once the due day is before today (company time). A missing due date is never overdue. */
export function isOverdue(due: DateInput, timeZone: string, now: Date = new Date()): boolean {
  const days = daysUntilDue(due, timeZone, now);
  return days !== null && days < 0;
}

export function isDueToday(due: DateInput, timeZone: string, now: Date = new Date()): boolean {
  return daysUntilDue(due, timeZone, now) === 0;
}

/** Due today or within the next `withinDays` days (not yet overdue). */
export function isDueSoon(due: DateInput, timeZone: string, now: Date = new Date(), withinDays = 1): boolean {
  const days = daysUntilDue(due, timeZone, now);
  return days !== null && days >= 0 && days <= withinDays;
}

/** Finished on or before its due day (company time)? null when either date is missing. */
export function completedOnTime(due: DateInput, completedAt: DateInput, timeZone: string): boolean | null {
  const key = dueDayKey(due, timeZone);
  const done = toDate(completedAt);
  if (!key || !done) return null;
  return zonedDayKey(done, timeZone) <= key;
}

/** Offset (ms) of a time zone from UTC at a given instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a 'YYYY-MM-DD' day starts in a time zone. */
export function zonedStartOfDay(key: string, timeZone: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let start = guess - zoneOffsetMs(new Date(guess), timeZone);
  start = guess - zoneOffsetMs(new Date(start), timeZone);
  return new Date(start);
}

/** First instant the task counts as overdue: the start of the day after its due day, company time. */
export function overdueFrom(due: DateInput, timeZone: string): Date | null {
  const key = dueDayKey(due, timeZone);
  return key ? zonedStartOfDay(shiftDayKey(key, 1), timeZone) : null;
}
