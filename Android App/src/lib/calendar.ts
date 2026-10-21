/**
 * The calendar's days (5a): the month's grid, a week, the range each view shows and asks the
 * server for, stepping back and forward, and the days' names. The layout is the website's
 * (Web Portal/frontend/src/lib/calendar.ts; calendar.test.ts checks they agree). Days are
 * 'YYYY-MM-DD' keys worked out in UTC, so the phone's own time zone never shifts them, and they are
 * named without Intl (Hermes' date formatting differs between phones) in the website's English.
 */

export interface DayCell {
  /** 'YYYY-MM-DD'. */
  key: string;
  day: number;
  /** True when this day belongs to the grid's month (vs. leading/trailing days). */
  inMonth: boolean;
}

/** The first day of the week: 0 = Sunday, 1 = Monday, 6 = Saturday. */
export type WeekStart = 0 | 1 | 6;

export type CalendarView = 'month' | 'week' | 'agenda';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Your week start (Settings → Calendar on the website): Monday or Saturday when chosen, else Sunday. */
export function weekStartOf(prefs: { weekStart?: number | null } | null | undefined): WeekStart {
  const w = prefs?.weekStart;
  return w === 1 || w === 6 ? w : 0;
}

/** The seven weekday names in the order the week starts. */
export function weekdayLabels(weekStart: WeekStart = 0): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAY_SHORT[(weekStart + i) % 7]!);
}

/** The full name of the weekday in column `index` of a week starting on `weekStart`. */
export function weekdayName(index: number, weekStart: WeekStart = 0): string {
  return WEEKDAY_LONG[(weekStart + index) % 7]!;
}

/**
 * A 6-week × 7-day month grid for `month0` (0 = January) of `year`, starting on `weekStart`,
 * including the leading/trailing days of the months either side so every week is full.
 */
export function monthGrid(year: number, month0: number, weekStart: WeekStart = 0): DayCell[][] {
  const first = new Date(Date.UTC(year, month0, 1));
  const cur = new Date(first);
  cur.setUTCDate(1 - ((first.getUTCDay() - weekStart + 7) % 7)); // back up to the week's first day
  const weeks: DayCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({ key: cur.toISOString().slice(0, 10), day: cur.getUTCDate(), inMonth: cur.getUTCMonth() === month0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Only the weeks of the grid that touch the month (4 to 6): no rows of next month's days. */
export function monthWeeks(year: number, month0: number, weekStart: WeekStart = 0): DayCell[][] {
  return monthGrid(year, month0, weekStart).filter((week) => week.some((c) => c.inMonth));
}

/** The 7 day keys of the week containing `dateKey`, starting on `weekStart`. */
export function weekDays(dateKey: string, weekStart: WeekStart = 0): string[] {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - weekStart + 7) % 7));
  return Array.from({ length: 7 }, () => {
    const key = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return key;
  });
}

/** A day key moved by whole days (noon-UTC arithmetic, so no clock change can skip a day). */
export function shiftDayKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The first day ('YYYY-MM-01') of the month `months` away from the month containing `dateKey`. */
export function shiftMonth(dateKey: string, months: number): string {
  const [y, m] = dateKey.split('-').map(Number) as [number, number];
  // Anchor on day 1 so stepping from the 29th–31st never overflows into the month after.
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

/** Year and 0-based month of a day key. */
export function monthOf(dateKey: string): { year: number; month0: number } {
  const [y, m] = dateKey.split('-').map(Number) as [number, number];
  return { year: y, month0: m - 1 };
}

/** Previous / next: a week in the week view, otherwise a month. */
export function stepCursor(view: CalendarView, cursor: string, dir: 1 | -1): string {
  return view === 'week' ? shiftDayKey(cursor, 7 * dir) : shiftMonth(cursor, dir);
}

/** The days a view shows — and asks the server for: the month's weeks, the week, or the month as a list. */
export function visibleRange(view: CalendarView, cursor: string, weekStart: WeekStart = 0): { from: string; to: string } {
  if (view === 'week') {
    const days = weekDays(cursor, weekStart);
    return { from: days[0]!, to: days[6]! };
  }
  const { year, month0 } = monthOf(cursor);
  if (view === 'agenda') {
    const last = new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
    return { from: `${cursor.slice(0, 7)}-01`, to: last };
  }
  const flat = monthWeeks(year, month0, weekStart).flat();
  return { from: flat[0]!.key, to: flat[flat.length - 1]!.key };
}

export interface DayLabelParts {
  weekday?: 'short' | 'long';
  day?: boolean;
  month?: 'short' | 'long';
  year?: boolean;
}

/**
 * 'Sat 10 Oct' for a day key: the parts asked for, always in the order weekday, day, month, year
 * (the website's dayLabel).
 */
export function dayLabel(key: string, parts: DayLabelParts = { weekday: 'short', day: true, month: 'short' }): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return key;
  const words: string[] = [];
  if (parts.weekday) words.push((parts.weekday === 'long' ? WEEKDAY_LONG : WEEKDAY_SHORT)[d.getUTCDay()]!);
  if (parts.day) words.push(String(d.getUTCDate()));
  if (parts.month) words.push((parts.month === 'long' ? MONTH_LONG : MONTH_SHORT)[d.getUTCMonth()]!);
  if (parts.year) words.push(String(d.getUTCFullYear()));
  return words.join(' ');
}

/** 'Thu 15 Oct 2026' (dayLabel with the year). */
export function fullDayLabel(key: string): string {
  return dayLabel(key, { weekday: 'short', day: true, month: 'short', year: true });
}

/** The period a view shows: 'October 2026', or a week such as '4 – 10 Oct 2026'. */
export function periodLabel(view: CalendarView, cursor: string, weekStart: WeekStart = 0): string {
  if (view !== 'week') return dayLabel(cursor, { month: 'long', year: true });
  const days = weekDays(cursor, weekStart);
  return rangeLabel(days[0]!, days[6]!);
}

/** Days from `a` to `b`, as few words as they need: '4 – 10 Oct 2026', '27 Sep – 3 Oct 2026', '28 Dec 2026 – 3 Jan 2027'. */
export function rangeLabel(a: string, b: string): string {
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  const sameMonth = sameYear && a.slice(0, 7) === b.slice(0, 7);
  const start = dayLabel(a, sameMonth ? { day: true } : sameYear ? { day: true, month: 'short' } : { day: true, month: 'short', year: true });
  return `${start} – ${dayLabel(b, { day: true, month: 'short', year: true })}`;
}
