export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

/** When the next copy of a recurring task is made. */
export type CreateNext = 'ON_COMPLETE' | 'ON_SCHEDULE';

/** "The 2nd Tuesday": week 1–4 of the month, or -1 for the last; day 0 = Sunday … 6 = Saturday. */
export interface NthWeekday {
  week: 1 | 2 | 3 | 4 | -1;
  day: number;
}

export interface RecurrenceRule {
  freq: Frequency;
  /** Weeks/days/months/quarters/years between occurrences (>= 1). */
  interval: number;
  /** Optional cap on the total number of occurrences (including the first). */
  count?: number | null;
  /** Optional ISO end date; no occurrence is generated after it. */
  until?: string | null;
  /** WEEKLY only: days of the week (0 = Sunday … 6 = Saturday). */
  weekdays?: number[];
  /** MONTHLY/QUARTERLY only: day of month (1–31), clamped to the month's length. */
  dayOfMonth?: number;
  /** MONTHLY/QUARTERLY only, instead of `dayOfMonth`: a weekday of the month ("the last Friday"). */
  nthWeekday?: NthWeekday;
  /**
   * The series' original day of month (set by the server for MONTHLY/QUARTERLY/YEARLY rules
   * without `dayOfMonth`), so a 31st or 29 Feb that had to be clamped comes back when it can.
   */
  anchorDay?: number;
  /** When true the series is paused — no new occurrences are generated until resumed. */
  paused?: boolean;
  /**
   * ON_COMPLETE (the default): the next copy is made when this one is completed.
   * ON_SCHEDULE: a copy is made on each due date, whether or not the previous one is done.
   */
  createNext?: CreateNext;
}

const FREQS: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
const CREATE_NEXT: CreateNext[] = ['ON_COMPLETE', 'ON_SCHEDULE'];
/** Safety bound when skipping past occurrences (a daily series ~27 years overdue). */
const MAX_STEPS = 10_000;

/** Validate a recurrence rule's shape (used before persisting or computing). */
export function isValidRule(rule: RecurrenceRule): boolean {
  if (!FREQS.includes(rule.freq)) return false;
  if (!Number.isInteger(rule.interval) || rule.interval < 1) return false;
  if (rule.count != null && (!Number.isInteger(rule.count) || rule.count < 1)) return false;
  if (rule.weekdays && rule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return false;
  if (rule.dayOfMonth != null && (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) return false;
  if (rule.anchorDay != null && (!Number.isInteger(rule.anchorDay) || rule.anchorDay < 1 || rule.anchorDay > 31)) return false;
  if (rule.until != null && Number.isNaN(Date.parse(rule.until))) return false;
  if (rule.createNext != null && !CREATE_NEXT.includes(rule.createNext)) return false;
  if (rule.nthWeekday != null) {
    const { week, day } = rule.nthWeekday;
    if (rule.freq !== 'MONTHLY' && rule.freq !== 'QUARTERLY') return false;
    if (rule.dayOfMonth != null) return false;
    if (![1, 2, 3, 4, -1].includes(week)) return false;
    if (!Number.isInteger(day) || day < 0 || day > 6) return false;
  }
  return true;
}

/**
 * Pin a month-based rule to the day of `start` (its first due date) unless it already names a
 * day, so later occurrences don't drift to the clamped day (31 Jan → 28 Feb → 28 Mar …).
 */
export function withAnchorDay(rule: RecurrenceRule, start: Date | null | undefined): RecurrenceRule {
  if (!start || rule.dayOfMonth != null || rule.anchorDay != null || rule.nthWeekday != null) return rule;
  if (rule.freq !== 'MONTHLY' && rule.freq !== 'QUARTERLY' && rule.freq !== 'YEARLY') return rule;
  return { ...rule, anchorDay: start.getUTCDate() };
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** Add months (or years, monthsPerStep=12), clamping the day to the target month's length. */
function addMonthsClamped(d: Date, months: number, dayOfMonth?: number): Date {
  const targetDay = dayOfMonth ?? d.getUTCDate();
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(targetDay, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/**
 * Month-based step on a day of the month: this month's day when it is still ahead of `from` (a
 * task due the 10th with "monthly on the 20th" is next due the 20th), else `months` on — the day
 * clamped to each month's length.
 */
function nextMonthDay(from: Date, months: number, day: number | undefined): Date {
  if (day != null) {
    const year = from.getUTCFullYear();
    const month = from.getUTCMonth();
    const thisMonth = new Date(Date.UTC(year, month, Math.min(day, daysInMonth(year, month)), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
    if (thisMonth.getTime() > from.getTime()) return thisMonth;
  }
  return addMonthsClamped(from, months, day);
}

/** The date of "the nth weekday" in a month (keeping `timeOf`'s time of day). */
function nthWeekdayOf(year: number, monthIndex: number, { week, day }: NthWeekday, timeOf: Date): Date {
  let date: number;
  if (week === -1) {
    const last = daysInMonth(year, monthIndex);
    const lastDow = new Date(Date.UTC(year, monthIndex, last)).getUTCDay();
    date = last - ((lastDow - day + 7) % 7);
  } else {
    const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    date = 1 + ((day - firstDow + 7) % 7) + 7 * (week - 1);
  }
  return new Date(Date.UTC(year, monthIndex, date, timeOf.getUTCHours(), timeOf.getUTCMinutes(), timeOf.getUTCSeconds(), timeOf.getUTCMilliseconds()));
}

/** Month-based step for a "2nd Tuesday" rule: this month's one if still ahead, else `months` on. */
function nextNthWeekday(from: Date, months: number, nth: NthWeekday): Date {
  const thisMonth = nthWeekdayOf(from.getUTCFullYear(), from.getUTCMonth(), nth, from);
  if (thisMonth.getTime() > from.getTime()) return thisMonth;
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() + months;
  return nthWeekdayOf(Math.floor(total / 12), total % 12, nth, from);
}

/** The next occurrence strictly after `from`, per the rule. */
export function nextOccurrence(from: Date, rule: RecurrenceRule): Date {
  const interval = Math.max(1, rule.interval);
  switch (rule.freq) {
    case 'DAILY':
      return addDays(from, interval);
    case 'WEEKLY': {
      if (rule.weekdays && rule.weekdays.length > 0) {
        const set = new Set(rule.weekdays);
        for (let i = 1; i <= 7; i++) {
          const candidate = addDays(from, i);
          if (!set.has(candidate.getUTCDay())) continue;
          // Weeks run Sunday→Saturday. Still in `from`'s week: take it. Wrapped into the next
          // week: skip (interval − 1) further weeks, so "every 2 weeks on Monday" is fortnightly.
          const wrapped = candidate.getUTCDay() <= from.getUTCDay();
          return wrapped ? addDays(candidate, 7 * (interval - 1)) : candidate;
        }
        return addDays(from, 7 * interval); // unreachable given a non-empty set, but safe
      }
      return addDays(from, 7 * interval);
    }
    case 'MONTHLY':
      if (rule.nthWeekday) return nextNthWeekday(from, interval, rule.nthWeekday);
      return nextMonthDay(from, interval, rule.dayOfMonth ?? rule.anchorDay);
    case 'QUARTERLY':
      if (rule.nthWeekday) return nextNthWeekday(from, 3 * interval, rule.nthWeekday);
      return nextMonthDay(from, 3 * interval, rule.dayOfMonth ?? rule.anchorDay);
    case 'YEARLY':
      return addMonthsClamped(from, 12 * interval, rule.anchorDay);
  }
}

/** The occurrences of a rule, starting AT `start`, bounded by count / until / a hard limit. */
export function generateOccurrences(start: Date, rule: RecurrenceRule, limit: number): Date[] {
  const until = rule.until != null ? new Date(rule.until) : null;
  const max = rule.count != null ? Math.min(rule.count, limit) : limit;
  const out: Date[] = [];
  let current = start;
  while (out.length < max) {
    if (until && current.getTime() > until.getTime()) break;
    out.push(current);
    current = nextOccurrence(current, rule);
  }
  return out;
}

/** The calendar day ('YYYY-MM-DD') of a stored due date (due dates are UTC midnight of their day). */
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** Past the series' end date? (`until` is a day, compared as a day.) */
function pastUntil(d: Date, rule: RecurrenceRule): boolean {
  return rule.until != null && dayOf(d) > dayOf(new Date(rule.until));
}

/**
 * The due date for the copy made when `due`'s task is completed: the first occurrence after `due`
 * that isn't already in the past (`today` is 'YYYY-MM-DD' in company time), so completing an
 * overdue task never creates another overdue one — missed dates are skipped, today's is kept.
 * Null once the series has ended.
 */
export function nextDueDate(due: Date, rule: RecurrenceRule, today: string): Date | null {
  let next = nextOccurrence(due, rule);
  for (let i = 0; dayOf(next) < today && i < MAX_STEPS; i++) next = nextOccurrence(next, rule);
  return pastUntil(next, rule) ? null : next;
}

/**
 * For an on-schedule series whose newest copy is due `due`: the copy owed by `today` — the latest
 * occurrence after `due` that is on or before today (missed days collapse into one copy) — or null
 * while the next date is still ahead or the series has ended.
 */
export function scheduledOccurrence(due: Date, rule: RecurrenceRule, today: string): Date | null {
  let owed: Date | null = null;
  let next = nextOccurrence(due, rule);
  for (let i = 0; dayOf(next) <= today && !pastUntil(next, rule) && i < MAX_STEPS; i++) {
    owed = next;
    next = nextOccurrence(next, rule);
  }
  return owed;
}
