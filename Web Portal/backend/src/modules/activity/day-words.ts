/**
 * Dates and times in words, as the minutes PDF and the daily emails write them: the day before the
 * month, three-letter months (Sep, never "Sept"), no commas, and 24-hour times — "5 Oct 2026",
 * "Fri 30 Oct 2026", "Thursday 1 October 2026", "30 Oct", "09:05". Built from fixed English words,
 * so every browser (whatever its own language settings) shows the same.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface DayTextOptions {
  /** With the weekday: "Fri" or "Friday". */
  weekday?: 'short' | 'long';
  /** "Oct" (the default) or "October". */
  month?: 'short' | 'long';
  /** With the year (the default). */
  year?: boolean;
}

/** A calendar day ('YYYY-MM-DD'; anything after it is ignored) in words — the day itself, never moved by a time zone. '' when it isn't one. */
export function dayText(key: string, { weekday, month = 'short', year = true }: DayTextOptions = {}): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key ?? '');
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const monthName = MONTHS[mo - 1];
  if (!monthName || d < 1 || d > 31) return '';
  const weekdayName = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]!;
  return [
    weekday ? (weekday === 'long' ? weekdayName : weekdayName.slice(0, 3)) : null,
    String(d),
    month === 'long' ? monthName : monthName.slice(0, 3),
    year ? m[1] : null,
  ]
    .filter(Boolean)
    .join(' ');
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** A cached formatter in `timeZone` (the device's zone when none is given, or when it is unknown). */
function formatter(kind: 'day' | 'time', timeZone?: string): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone ?? ''}`;
  let f = formatters.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = kind === 'day' ? { year: 'numeric', month: '2-digit', day: '2-digit' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    const locale = kind === 'day' ? 'en-CA' : 'en-GB';
    try {
      f = new Intl.DateTimeFormat(locale, timeZone ? { ...opts, timeZone } : opts);
    } catch {
      f = new Intl.DateTimeFormat(locale, opts);
    }
    formatters.set(key, f);
  }
  return f;
}

const toDate = (at: string | Date): Date | null => {
  if (at === '' || at === null || at === undefined) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The calendar day ('YYYY-MM-DD') of an instant in a time zone (the device's when none). */
export function dayKeyIn(at: Date, timeZone?: string): string {
  return formatter('day', timeZone).format(at);
}

/** "09:05": the 24-hour time of an instant in a time zone (the device's when none). '' for a bad instant. */
export function clockText(at: string | Date, timeZone?: string): string {
  const d = toDate(at);
  if (!d) return '';
  const text = formatter('time', timeZone).format(d);
  return text.startsWith('24') ? `00${text.slice(2)}` : text;
}

/** The day of an instant in words, in a time zone (the device's when none): "Fri 30 Oct 2026". */
export function instantDayText(at: string | Date, timeZone?: string, opts?: DayTextOptions): string {
  const d = toDate(at);
  return d ? dayText(dayKeyIn(d, timeZone), opts) : '';
}

/** "Fri" (or "Friday"): the weekday of an instant in a time zone (the device's when none). */
export function weekdayText(at: string | Date, timeZone?: string, length: 'short' | 'long' = 'short'): string {
  const d = toDate(at);
  return d ? dayText(dayKeyIn(d, timeZone), { weekday: length, year: false }).split(' ')[0]! : '';
}

/** "30 Oct 2026, 09:05": an instant's day and 24-hour time, in a time zone (the device's when none). */
export function dateTimeText(at: string | Date, timeZone?: string, opts?: DayTextOptions): string {
  const d = toDate(at);
  return d ? `${instantDayText(d, timeZone, opts)}, ${clockText(d, timeZone)}` : '';
}
