import type { RecurrenceRule } from './recurrence';

/**
 * Editing a task's repeat rule, one change at a time (the repeat editor's logic, kept pure so it is
 * unit-tested; the Chrome extension has the same helpers). The server works out every date.
 */

type Nth = NonNullable<RecurrenceRule['nthWeekday']>;
export type Freq = RecurrenceRule['freq'];
export type EndsMode = 'NEVER' | 'COUNT' | 'UNTIL';

export const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
export const FREQ_LABEL: Record<Freq, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' };
export const UNIT_LABEL: Record<Freq, string> = { DAILY: 'day(s)', WEEKLY: 'week(s)', MONTHLY: 'month(s)', QUARTERLY: 'quarter(s)', YEARLY: 'year(s)' };
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The newest copy of a series carries the rule. */
export function isRecurring(task: { recurrenceRule?: RecurrenceRule | null; recurrenceParentId?: string | null } | null | undefined): boolean {
  return Boolean(task?.recurrenceRule);
}

/**
 * An earlier copy of a series — one whose next copy already exists. Its repeat can't be changed
 * (that would start a second, parallel series); the newest copy can always change or restart it.
 */
export function isEarlierCopy(task: { recurrenceNextId?: string | null; recurrenceParentId?: string | null; recurrenceRule?: RecurrenceRule | null } | null | undefined): boolean {
  return Boolean(task?.recurrenceNextId);
}

/** Every copy of a series links to it. */
export function inSeries(task: { recurrenceRule?: RecurrenceRule | null; recurrenceParentId?: string | null } | null | undefined): boolean {
  return Boolean(task?.recurrenceRule || task?.recurrenceParentId);
}

function without(rule: RecurrenceRule, ...keys: (keyof RecurrenceRule)[]): RecurrenceRule {
  const copy = { ...rule };
  for (const k of keys) delete copy[k];
  return copy;
}

/** Start, change or stop ('NONE') repeating — keeping how it ends and when copies are made. */
export function withFreq(rule: RecurrenceRule | null, freq: string): RecurrenceRule | null {
  if (!FREQS.includes(freq as Freq)) return null;
  const next: RecurrenceRule = { freq: freq as Freq, interval: rule?.interval ?? 1 };
  if (rule?.count != null) next.count = rule.count;
  if (rule?.until != null) next.until = rule.until;
  if (rule?.createNext) next.createNext = rule.createNext;
  if (rule?.paused) next.paused = rule.paused;
  return next;
}

export function withInterval(rule: RecurrenceRule, n: number | string): RecurrenceRule {
  const v = Number(n);
  return { ...rule, interval: Number.isInteger(v) && v >= 1 ? v : 1 };
}

export function toggleWeekday(rule: RecurrenceRule, day: number): RecurrenceRule {
  const set = new Set(rule.weekdays ?? []);
  if (set.has(day)) set.delete(day);
  else set.add(day);
  return { ...rule, weekdays: [...set].sort((a, b) => a - b) };
}

/** "The 2nd Tuesday" for a due date ('YYYY-MM-DD'): its weekday, and which one of the month (5th → last). */
export function nthWeekdayOf(dueKey: string | null | undefined): Nth {
  const d = new Date(`${dueKey}T00:00:00.000Z`);
  if (!dueKey || Number.isNaN(d.getTime())) return { week: 1, day: 1 };
  const week = Math.ceil(d.getUTCDate() / 7);
  return { week: week >= 5 ? -1 : (week as 1 | 2 | 3 | 4), day: d.getUTCDay() };
}

/** Monthly/quarterly on a date of the month ('DATE') or on "the 2nd Tuesday" ('WEEKDAY'). */
export function withMonthlyMode(rule: RecurrenceRule, mode: 'DATE' | 'WEEKDAY', dueKey?: string | null): RecurrenceRule {
  if (mode === 'DATE') return without(rule, 'nthWeekday');
  return { ...without(rule, 'dayOfMonth', 'anchorDay'), nthWeekday: rule.nthWeekday ?? nthWeekdayOf(dueKey) };
}

export function withNth(rule: RecurrenceRule, patch: Partial<Nth>): RecurrenceRule {
  return { ...rule, nthWeekday: { ...(rule.nthWeekday ?? { week: 1, day: 1 }), ...patch } };
}

export function withDayOfMonth(rule: RecurrenceRule, n: number | string): RecurrenceRule {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) return without(rule, 'dayOfMonth');
  return { ...rule, dayOfMonth: Math.min(31, v) };
}

/** How the series ends: never, after a number of copies ('COUNT') or on a date ('UNTIL'). */
export function withEnds(rule: RecurrenceRule, mode: EndsMode, until?: string | null): RecurrenceRule {
  if (mode === 'COUNT') return { ...rule, count: rule.count ?? 10, until: null };
  if (mode === 'UNTIL') return { ...rule, until: until || rule.until || null, count: null };
  return { ...rule, count: null, until: null };
}

export function endsMode(rule: RecurrenceRule): EndsMode {
  return rule.count != null ? 'COUNT' : rule.until != null ? 'UNTIL' : 'NEVER';
}

/** When the next copy is made: when this one is done (the default) or on each date ('ON_SCHEDULE'). */
export function withCreateNext(rule: RecurrenceRule, mode: 'ON_COMPLETE' | 'ON_SCHEDULE'): RecurrenceRule {
  return mode === 'ON_SCHEDULE' ? { ...rule, createNext: 'ON_SCHEDULE' } : without(rule, 'createNext');
}

export function togglePaused(rule: RecurrenceRule): RecurrenceRule {
  return { ...rule, paused: !rule.paused };
}
