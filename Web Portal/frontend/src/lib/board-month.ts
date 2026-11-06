/**
 * Kanban Board: Monthly View (owner, 6 Nov 2026) — which months a task shows in:
 *
 *   - a start and a due date: every month from the start's month to the due's month (a start after
 *     its due date, older data: the due month);
 *   - only a due date: its due month; only a start date: from its start month onward, while open;
 *   - done: only the month it was completed (in a Done column with no completion time, older data:
 *     the month of its last change);
 *   - open and overdue from an earlier month: also the current month, never a future one ("carried");
 *   - no dates at all: "undated" — hidden until the board's "No date" chip adds them.
 *
 * Days are the company's: a date-only value (stored as UTC midnight) is its own day; any other instant
 * (an automatic start, a completion) is read in the company time zone, and so is "this month".
 *
 * Shared word for word: the server's copy (modules/tasks/board-month.ts) decides what GET /tasks?month=
 * returns; the website's (lib/board-month.ts, kept identical by a drift test) marks carried cards and
 * says where a new task went ("Saved — it's in Dec"). No imports, so the one file works in both places.
 */

export type DateLike = Date | string | number | null | undefined;

/** What the rule reads of a task (the API's task rows have all of it). */
export interface MonthTask {
  startDate?: DateLike;
  dueDate?: DateLike;
  completedAt?: DateLike;
  updatedAt?: DateLike;
  /** Its column's kind (status): DONE is finished. */
  columnCategory?: string | null;
}

/** The company time zone and today's day in it ('YYYY-MM-DD'). */
export interface MonthClock {
  timeZone: string;
  today: string;
}

/**
 * Where a task stands for a month: 'month' — it belongs to it; 'carried' — open and overdue from an
 * earlier month, shown in the current one; 'undated' — it has no dates (any month, behind "No date");
 * null — not in this month.
 */
export type MonthPlace = 'month' | 'carried' | 'undated' | null;

/** 'YYYY-MM' (years 1000–2999). */
export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^[12]\d{3}-(0[1-9]|1[0-2])$/.test(value);
}

/** The month n months after (or before, n < 0) a month. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** A month's first and last day, 'YYYY-MM-DD'. */
export function monthDays(month: string): { first: string; last: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(days).padStart(2, '0')}` };
}

const formats = new Map<string, Intl.DateTimeFormat>();
/** 'YYYY-MM-DD' of an instant in a time zone. */
function zonedDay(instant: Date, timeZone: string): string {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formats.set(timeZone, f);
  }
  return f.format(instant);
}

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The day of a start or due date: a bare 'YYYY-MM-DD' or an instant at exactly UTC midnight (a date
 * someone picked) keeps its own day; any other instant is read in the company time zone.
 */
export function dayKeyOf(value: DateLike, timeZone: string): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = toDate(value);
  if (!d) return null;
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return midnight ? d.toISOString().slice(0, 10) : zonedDay(d, timeZone);
}

/** The company day of a moment (a completion, a change). */
function instantDay(value: DateLike, timeZone: string): string | null {
  const d = toDate(value);
  return d ? zonedDay(d, timeZone) : null;
}

const monthOf = (day: string) => day.slice(0, 7);

/** Finished: in a Done column, or completed. */
export function isMonthTaskDone(t: MonthTask): boolean {
  return t.columnCategory === 'DONE' || toDate(t.completedAt) !== null;
}

/** The month a finished task was completed (no completion time: its last change's); null when unknown. */
function doneMonth(t: MonthTask, timeZone: string): string | null {
  const day = instantDay(t.completedAt, timeZone) ?? instantDay(t.updatedAt, timeZone);
  return day ? monthOf(day) : null;
}

/** The months a task belongs to by its own dates: from…to (to null: onward); null when it has no dates. */
function ownMonths(t: MonthTask, timeZone: string): { from: string; to: string | null } | null {
  if (isMonthTaskDone(t)) {
    const m = doneMonth(t, timeZone);
    return m ? { from: m, to: m } : null;
  }
  const start = dayKeyOf(t.startDate, timeZone);
  const due = dayKeyOf(t.dueDate, timeZone);
  if (due) return { from: start && start <= due ? monthOf(start) : monthOf(due), to: monthOf(due) };
  return start ? { from: monthOf(start), to: null } : null;
}

/** The month an open, overdue task is carried into (the current one); null when it isn't carried. */
function carriedInto(t: MonthTask, clock: MonthClock): string | null {
  if (isMonthTaskDone(t)) return null;
  const due = dayKeyOf(t.dueDate, clock.timeZone);
  const current = monthOf(clock.today);
  return due && monthOf(due) < current ? current : null;
}

/** Where a task stands for `month` (see MonthPlace). */
export function monthPlace(t: MonthTask, month: string, clock: MonthClock): MonthPlace {
  const own = ownMonths(t, clock.timeZone);
  if (!own) return isMonthTaskDone(t) ? null : 'undated';
  if (month >= own.from && (own.to === null || month <= own.to)) return 'month';
  return carriedInto(t, clock) === month ? 'carried' : null;
}

/**
 * Where to find a task that isn't in `month`: of the months it shows in, the nearest one ("Saved —
 * it's in Dec"). Null when it is in `month`, or has no dates.
 */
export function nearestMonth(t: MonthTask, month: string, clock: MonthClock): string | null {
  if (monthPlace(t, month, clock) !== null) return null;
  const own = ownMonths(t, clock.timeZone);
  if (!own) return null;
  const clamped = month < own.from ? own.from : own.to !== null && month > own.to ? own.to : month;
  const carried = carriedInto(t, clock);
  if (!carried) return clamped;
  const distance = (m: string) => {
    const [ay, am] = m.split('-').map(Number) as [number, number];
    const [by, bm] = month.split('-').map(Number) as [number, number];
    return Math.abs(ay * 12 + am - (by * 12 + bm));
  };
  return distance(carried) <= distance(clamped) ? carried : clamped;
}
