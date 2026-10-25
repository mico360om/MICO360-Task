import { shiftDayKey, zoneOffsetMs } from '../../lib/due-date';

/**
 * The days and times MICO AI's changes use, worked out by the server in the company's calendar —
 * never taken from the model on trust. The model copies the person's words ("Tuesday", "next
 * week", "in 3 days") or gives a YYYY-MM-DD; anything else comes back as a problem to fix, and a
 * real date is still checked (it must exist, and be within a few years of today).
 */

export interface DayContext {
  /** Today, 'YYYY-MM-DD', in the company time zone. */
  today: string;
  /** The company's working days (0 = Sunday … 6 = Saturday); default Sunday to Thursday. */
  workingDays?: number[];
}

export type DayResolution = { day: string } | { problem: string };

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4];
/** How far from today a date may be (a slip of the model, not a plan). */
const MAX_DAYS_BACK = 366;
const MAX_DAYS_AHEAD = 3 * 366;

/** 0 = Sunday … 6 = Saturday, of a 'YYYY-MM-DD' calendar day. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00.000Z`).getUTCDay();
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/** 'YYYY-MM-DD' → 'Tue 27 Oct 2026' (a calendar day, never shifted). */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${WEEKDAY_NAMES[weekdayOf(day)]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** Is this 'YYYY-MM-DD' a day that exists? */
export function isCalendarDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The next `weekday` strictly after `from` (1 to 7 days on). */
const nextWeekday = (from: string, weekday: number) => shiftDayKey(from, ((weekday - weekdayOf(from) + 6) % 7) + 1);

const count = (word: string): number | null => (/^\d{1,4}$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? null));

/** A day from the person's words, or a problem saying what couldn't be read. */
export function resolveDay(said: string, ctx: DayContext): DayResolution {
  const raw = String(said ?? '').trim();
  const words = raw.toLowerCase().replace(/[.,!]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(on|by|due|for|until|before) /, '');
  const unreadable: DayResolution = { problem: raw ? `Couldn’t tell which day “${raw.slice(0, 60)}” is. Pick the date.` : 'Pick the date.' };
  if (!words) return unreadable;
  const { today } = ctx;
  const working = ctx.workingDays?.length ? [...new Set(ctx.workingDays)].sort((a, b) => a - b) : DEFAULT_WORKING_DAYS;

  let day: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(words)) {
    if (!isCalendarDay(words)) return { problem: `${raw} isn’t a date that exists. Pick the date.` };
    day = words;
  } else if (words === 'today') day = today;
  else if (words === 'tomorrow') day = shiftDayKey(today, 1);
  else if (/^(the )?day after tomorrow$/.test(words)) day = shiftDayKey(today, 2);
  else if (/^(the )?next week$/.test(words)) day = nextWeekday(today, working[0]!);
  else if (/^(the )?end of (the |this )?week$/.test(words)) {
    const last = working[working.length - 1]!;
    day = weekdayOf(today) === last ? today : nextWeekday(today, last);
  } else {
    const weekday = /^(this |next |coming )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(words);
    const ahead = /^(?:in (\w+) (day|week)s?|(\w+) (day|week)s? from (?:now|today))$/.exec(words);
    const plus = /^\+(\d{1,4})\s*(d|w|days?|weeks?)?$/.exec(words);
    if (weekday) {
      const n = WEEKDAYS.indexOf(weekday[2]!);
      day = weekday[1] === 'this ' && weekdayOf(today) === n ? today : nextWeekday(today, n);
    } else if (ahead) {
      const n = count(ahead[1] ?? ahead[3]!);
      if (n === null) return unreadable;
      day = shiftDayKey(today, n * ((ahead[2] ?? ahead[4]) === 'week' ? 7 : 1));
    } else if (plus) {
      day = shiftDayKey(today, Number(plus[1]) * (plus[2]?.startsWith('w') ? 7 : 1));
    }
  }
  if (!day) return unreadable;
  const offset = daysBetween(today, day);
  if (offset < -MAX_DAYS_BACK || offset > MAX_DAYS_AHEAD) return { problem: `${dayLabel(day)} is too far from today. Pick the date.` };
  return { day };
}

/** A time of day as 'HH:MM' (24-hour): "10:00", "9", "2pm", "9:30 am", "noon"; null when it isn't one. */
export function parseClock(said: string): string | null {
  const t = String(said ?? '').trim().toLowerCase().replace(/\./g, '');
  if (t === 'noon' || t === 'midday') return '12:00';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** The instant a wall-clock time on a day happens in a time zone (summer time included). */
export function zonedInstant(day: string, clock: string, timeZone: string): Date {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const [h, mi] = clock.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let at = wall - zoneOffsetMs(new Date(wall), timeZone);
  at = wall - zoneOffsetMs(new Date(at), timeZone);
  return new Date(at);
}
