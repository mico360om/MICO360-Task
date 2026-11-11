/**
 * Working days (Notification & Scheduling centre): which days are worked, how many working days lie
 * between two days, the next working day or morning — the one rule the reminders, escalations,
 * inactivity, the daily email, project health, Management (and later the Calendar and KPIs) count by.
 *
 * Days are 'YYYY-MM-DD' keys (a due date's calendar day, or "today" in the site's time zone). A
 * calendar is the company's working weekdays (0 Sunday … 6 Saturday) and its holidays; a holiday
 * marked `recurring` repeats on its month and day every year from its own year on (29 February only
 * in leap years). Counting is in days; time zones matter only when an instant is read as a day or a
 * time of day (working hours, the next working morning).
 *
 * The server owns this file; the website keeps an identical copy (Web Portal/frontend/src/lib/
 * working-days.ts) and a test fails when the two differ. No imports: it runs in both.
 */

/** A day off: a public holiday or a company day off. */
export interface Holiday {
  day: string;
  name: string;
  /** Every year on the same month and day, from `day`'s year on. */
  recurring?: boolean;
}

/** A company's working week and its holidays. */
export interface WorkCalendar {
  /** The working weekdays, 0 Sunday … 6 Saturday. */
  workingDays: readonly number[];
  holidays: readonly Holiday[];
}

/** Working hours as 'HH:MM' times of day (start inclusive, end exclusive). */
export interface WorkHours {
  start: string;
  end: string;
}

const DAY_MS = 86_400_000;
/** How far any search for a working day looks before giving up (a calendar may have none). */
const SEARCH_LIMIT_DAYS = 3 * 366;

const noon = (key: string): number => Date.parse(`${key}T12:00:00.000Z`);
const keyOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A day key moved by whole days. */
export function shiftDay(key: string, days: number): string {
  return keyOf(noon(key) + days * DAY_MS);
}

/** Whole days from one day to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((noon(to) - noon(from)) / DAY_MS);
}

/** The weekday of a day: 0 Sunday … 6 Saturday. */
export function weekdayOf(key: string): number {
  return new Date(noon(key)).getUTCDay();
}

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Does a holiday fall on this day? */
function holidayFalls(h: Holiday, key: string): boolean {
  if (h.day === key) return true;
  if (!h.recurring || key < h.day) return false;
  return h.day.slice(5) === key.slice(5);
}

/** The holiday on a day, if any (the first listed, when two share it). */
export function holidayOn(key: string, cal: Pick<WorkCalendar, 'holidays'>): Holiday | null {
  return cal.holidays.find((h) => holidayFalls(h, key)) ?? null;
}

/** A working weekday that is no holiday. */
export function isWorkingDay(key: string, cal: WorkCalendar): boolean {
  return cal.workingDays.includes(weekdayOf(key)) && !holidayOn(key, cal);
}

/** Why a day is not worked: a holiday (by name) first, then the weekend; null on a working day. */
export function dayOffReason(key: string, cal: WorkCalendar): { kind: 'holiday'; name: string } | { kind: 'weekend' } | null {
  const h = holidayOn(key, cal);
  if (h) return { kind: 'holiday', name: h.name };
  return cal.workingDays.includes(weekdayOf(key)) ? null : { kind: 'weekend' };
}

/** The holidays from `from` to `to` (both included), yearly ones once per year they fall in, by day. */
export function holidaysInRange(from: string, to: string, cal: Pick<WorkCalendar, 'holidays'>): { day: string; name: string }[] {
  if (to < from) return [];
  const out: { day: string; name: string }[] = [];
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  for (const h of cal.holidays) {
    if (!h.recurring) {
      if (h.day >= from && h.day <= to) out.push({ day: h.day, name: h.name });
      continue;
    }
    const md = h.day.slice(5);
    for (let y = Math.max(firstYear, Number(h.day.slice(0, 4))); y <= lastYear; y++) {
      if (md === '02-29' && !isLeap(y)) continue;
      const day = `${String(y).padStart(4, '0')}-${md}`;
      if (day >= from && day <= to && day >= h.day) out.push({ day, name: h.name });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.name.localeCompare(b.name, 'en')));
}

/** Working weekdays among the `count` days after `from` (not counting holidays). */
function weekdaysAfter(from: string, count: number, working: ReadonlySet<number>): number {
  if (count <= 0 || working.size === 0) return 0;
  const weeks = Math.floor(count / 7);
  let n = weeks * working.size;
  const start = weekdayOf(from);
  for (let i = 1; i <= count % 7; i++) if (working.has((start + i) % 7)) n++;
  return n;
}

/**
 * The working days after `from` up to and including `to` — a task due Thursday is 1 working day late
 * on Sunday in a Sunday-to-Thursday week. Negative when `to` is earlier (the working days after `to`
 * up to and including `from`, as a negative number); 0 for the same day.
 */
export function workingDaysBetween(from: string, to: string, cal: WorkCalendar): number {
  if (from === to) return 0;
  if (to < from) {
    const back = workingDaysBetween(to, from, cal);
    return back === 0 ? 0 : -back;
  }
  const working = new Set(cal.workingDays);
  let n = weekdaysAfter(from, daysBetween(from, to), working);
  // Holidays on working weekdays inside (from, to], each day once.
  const off = new Set(holidaysInRange(shiftDay(from, 1), to, cal).map((h) => h.day));
  for (const day of off) if (working.has(weekdayOf(day))) n--;
  return n;
}

/** Working days late: the working days since the due day, never below 0. */
export function workingDaysLate(dueKey: string, todayKey: string, cal: WorkCalendar): number {
  return Math.max(0, workingDaysBetween(dueKey, todayKey, cal));
}

/** The first working day on or after `key` (strictly after with `after`); `key` itself when there is none. */
export function nextWorkingDay(key: string, cal: WorkCalendar, opts: { after?: boolean } = {}): string {
  let d = opts.after ? shiftDay(key, 1) : key;
  for (let i = 0; i < SEARCH_LIMIT_DAYS; i++, d = shiftDay(d, 1)) if (isWorkingDay(d, cal)) return d;
  return key;
}

/** The last working day on or before `key`; `key` itself when there is none. */
export function previousWorkingDay(key: string, cal: WorkCalendar): string {
  let d = key;
  for (let i = 0; i < SEARCH_LIMIT_DAYS; i++, d = shiftDay(d, -1)) if (isWorkingDay(d, cal)) return d;
  return key;
}

/**
 * The day `n` working days after `key` (before it when `n` is negative); `key` itself for 0 or when
 * the calendar has no working days.
 */
export function addWorkingDays(key: string, n: number, cal: WorkCalendar): string {
  if (n === 0 || cal.workingDays.length === 0) return key;
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  let d = key;
  for (let i = 0; i < SEARCH_LIMIT_DAYS * Math.max(1, Math.ceil(left / 200)); i++) {
    d = shiftDay(d, step);
    if (isWorkingDay(d, cal) && --left === 0) return d;
  }
  return key;
}

// ── Instants, time zones and working hours ──────────────────────────────────

const clockFormats = new Map<string, Intl.DateTimeFormat>();
function clockFormat(timeZone: string): Intl.DateTimeFormat {
  let f = clockFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    clockFormats.set(timeZone, f);
  }
  return f;
}

function partsOf(instant: Date, timeZone: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = clockFormat(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute'), s: get('second') };
}

/** An instant's day and time of day (minutes after midnight) in a time zone. */
export function zonedClock(instant: Date, timeZone: string): { day: string; minutes: number } {
  const p = partsOf(instant, timeZone);
  const day = `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return { day, minutes: p.h * 60 + p.min };
}

/** An instant's day in a time zone. */
export function zonedDay(instant: Date, timeZone: string): string {
  return zonedClock(instant, timeZone).day;
}

/** Minutes after midnight of an 'HH:MM' time. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** The instant a day's 'HH:MM' happens in a time zone. */
export function zonedInstant(day: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d) + minutesOf(hhmm) * 60_000;
  const offsetAt = (ms: number) => {
    const p = partsOf(new Date(ms), timeZone);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
  };
  let at = wall - offsetAt(wall);
  at = wall - offsetAt(at);
  return new Date(at);
}

/** Inside working hours on a working day (start inclusive, end exclusive), in the time zone. */
export function isWorkingTime(instant: Date, timeZone: string, cal: WorkCalendar, hours: WorkHours): boolean {
  const { day, minutes } = zonedClock(instant, timeZone);
  return isWorkingDay(day, cal) && minutes >= minutesOf(hours.start) && minutes < minutesOf(hours.end);
}

/**
 * When working time next starts: `instant` itself when inside working hours, else the start of the
 * next working morning (today's, when it is still to come). Null when the calendar has no working day.
 */
export function nextWorkingStart(instant: Date, timeZone: string, cal: WorkCalendar, hours: WorkHours): Date | null {
  if (isWorkingTime(instant, timeZone, cal, hours)) return instant;
  const { day, minutes } = zonedClock(instant, timeZone);
  const startToday = isWorkingDay(day, cal) && minutes < minutesOf(hours.start);
  const next = startToday ? day : nextWorkingDay(day, cal, { after: true });
  if (!isWorkingDay(next, cal)) return null;
  return zonedInstant(next, hours.start, timeZone);
}
