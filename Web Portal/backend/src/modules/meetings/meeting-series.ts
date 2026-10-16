/**
 * Dates of a repeating meeting series. Each meeting of a series is a real meeting row; these
 * helpers work out when they fall. The rule runs on the meeting's local wall clock (the task
 * engine stepped in "fake UTC"), so a 10:00 meeting stays at 10:00 when the clocks change and
 * "every Tuesday" means Tuesday where the meeting is held.
 */
import { zonedDayKey, zoneOffsetMs } from '../../lib/due-date';
import { nextOccurrence, withAnchorDay } from '../tasks/recurrence';
import type { RecurrenceRule } from './meeting-repository';

/** How far ahead a series' meetings are created: about three months, at most 26 meetings. */
export const SERIES_HORIZON_DAYS = 90;
export const SERIES_MAX_UPCOMING = 26;
/** Safety bound on rule steps (a daily series ~27 years long). */
const MAX_STEPS = 10_000;
const DAY_MS = 86_400_000;

/** The wall-clock time of an instant in a zone, written as a UTC date (10:00 Muscat → 10:00Z). */
export function wallOf(instant: Date, timeZone: string): Date {
  return new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
}

/** The instant whose wall-clock time in a zone is `wall` (a time in a spring-forward gap moves on). */
export function instantOf(wall: Date, timeZone: string): Date {
  const guess = new Date(wall.getTime() - zoneOffsetMs(wall, timeZone));
  return new Date(wall.getTime() - zoneOffsetMs(guess, timeZone));
}

/** The rule as a series keeps it: a month-based rule is pinned to the first meeting's local day. */
export function seriesRule(rule: RecurrenceRule, first: Date, timeZone: string): RecurrenceRule {
  return withAnchorDay(rule, wallOf(first, timeZone)) as RecurrenceRule;
}

const dayKey = (wall: Date) => wall.toISOString().slice(0, 10);

/**
 * The starts of a series' meetings: the first meeting, then each date the rule gives, through
 * `through`. The series' count and end date (a local day, inclusive) are respected.
 */
export function seriesStarts(first: Date, rule: RecurrenceRule, timeZone: string, through: Date): Date[] {
  const until = rule.until ? rule.until.slice(0, 10) : null;
  const max = rule.count ?? Number.POSITIVE_INFINITY;
  const out: Date[] = [];
  let wall = wallOf(first, timeZone);
  for (let i = 0; i < MAX_STEPS && out.length < max; i++) {
    if (until && dayKey(wall) > until) break;
    const at = i === 0 ? first : instantOf(wall, timeZone);
    if (at.getTime() > through.getTime()) break;
    out.push(at);
    wall = nextOccurrence(wall, rule);
  }
  return out;
}

const daysInMonth = (wall: Date) => new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 0)).getUTCDate();

/** Does a local date fall on the rule's days (its weekdays, day of the month or "2nd Tuesday")? */
function onRule(wall: Date, rule: RecurrenceRule): boolean {
  if (rule.freq === 'WEEKLY' && rule.weekdays?.length) return rule.weekdays.includes(wall.getUTCDay());
  if (rule.freq !== 'MONTHLY' && rule.freq !== 'QUARTERLY') return true;
  const date = wall.getUTCDate();
  if (rule.nthWeekday) {
    const { week, day } = rule.nthWeekday;
    if (wall.getUTCDay() !== day) return false;
    return week === -1 ? date + 7 > daysInMonth(wall) : Math.ceil(date / 7) === week;
  }
  if (rule.dayOfMonth != null) return date === Math.min(rule.dayOfMonth, daysInMonth(wall));
  return true;
}

/** `start` when it falls on the rule's days, else the rule's next date after it (same local time). */
export function alignToRule(start: Date, rule: RecurrenceRule, timeZone: string): Date {
  const wall = wallOf(start, timeZone);
  return onRule(wall, rule) ? start : instantOf(nextOccurrence(wall, rule), timeZone);
}

/**
 * The rule with its days moved by `days` (a series moved from Tuesday to Thursday repeats on
 * Thursdays): chosen weekdays, "the 2nd Tuesday" and a day of the month move; others need nothing.
 */
export function shiftRuleDays(rule: RecurrenceRule, days: number): RecurrenceRule {
  const weekday = (d: number) => (((d + days) % 7) + 7) % 7;
  const out: RecurrenceRule = { ...rule };
  if (rule.freq === 'WEEKLY' && rule.weekdays?.length) out.weekdays = [...new Set(rule.weekdays.map(weekday))].sort((a, b) => a - b);
  if (rule.nthWeekday) out.nthWeekday = { ...rule.nthWeekday, day: weekday(rule.nthWeekday.day) };
  if (rule.dayOfMonth != null) out.dayOfMonth = Math.min(31, Math.max(1, rule.dayOfMonth + days));
  return out;
}

/** The end date ('YYYY-MM-DD', local) that ends a series just before the meeting at `start`. */
export function untilBefore(start: Date, timeZone: string): string {
  return zonedDayKey(new Date(instantOf(new Date(Date.parse(`${zonedDayKey(start, timeZone)}T00:00:00Z`)), timeZone).getTime() - 1), timeZone);
}

/** What's wrong with a series' rule for its first meeting, or null. */
export function ruleProblem(rule: RecurrenceRule | null | undefined, first: Date, timeZone: string): string | null {
  if (!rule) return null;
  if (rule.until && rule.until.slice(0, 10) < zonedDayKey(first, timeZone)) return 'The repeat can’t end before the first meeting.';
  if (rule.nthWeekday && rule.freq !== 'MONTHLY' && rule.freq !== 'QUARTERLY') return 'Only monthly and quarterly repeats can fall on a weekday of the month.';
  return null;
}

/** The latest start a series should have created by `now`: the horizon's end. */
export function horizonEnd(now: Date): Date {
  return new Date(now.getTime() + SERIES_HORIZON_DAYS * DAY_MS);
}
