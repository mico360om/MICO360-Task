/**
 * The Management page's rules, pure: a project's red / amber / green mark and the reasons for it,
 * the order of the project-health table, the Completion share (the project dashboard's), the
 * inspection pass rate, and the company weeks the trends and the period are made of.
 *
 * Weeks are company weeks: days in the company time zone, starting on the company's week start;
 * the current week is the last one (partial). "Today" is the company day.
 */
import { shiftDayKey, todayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';
import { daysBetween, weekOf, type WeekStart } from '../planning/timeline';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export const PROJECT_STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];
/** Projects still going; COMPLETED and ARCHIVED only when chosen. */
export const DEFAULT_STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD'];
/** The trend range (and the inspection statistics' period), in weeks. */
export const PERIOD_WEEKS = [4, 12, 26] as const;
export type PeriodWeeks = (typeof PERIOD_WEEKS)[number];
export const DEFAULT_WEEKS: PeriodWeeks = 12;

/** An ACTIVE project with no change for this many company days is amber. */
export const NO_ACTIVITY_DAYS = 14;
/** Red from this many missing checks. */
export const RED_MISSING_CHECKS = 3;
/** Red when late tasks are at least this share of the open ones… */
export const RED_LATE_SHARE = 0.25;
/** …and at least this many are late. */
export const RED_LATE_MIN = 3;

export type Rag = 'RED' | 'AMBER' | 'GREEN';
export type RagCode = 'MILESTONE_LATE' | 'MANY_LATE' | 'LATE_TASKS' | 'MANY_MISSING_CHECKS' | 'MISSING_CHECKS' | 'NO_ACTIVITY' | 'ON_TRACK';
export interface RagReason {
  code: RagCode;
  level: Rag;
  /** Plain words shown next to the mark (web, PDF, email). */
  text: string;
}

/** What the mark is worked out from: the project's figures right now. */
export interface HealthFacts {
  status: ProjectStatus;
  /** Open (not done) tasks. */
  open: number;
  /** Open tasks whose due day is before today (company time). */
  late: number;
  /** Open milestones past their due day. */
  lateMilestones: { title: string; daysLate: number }[];
  /** Open checks past their due day. */
  missingChecks: number;
  /** The later of the project's own last change and its latest task change. */
  lastActivityAt: Date;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RANK: Record<Rag, number> = { RED: 0, AMBER: 1, GREEN: 2 };

/**
 * Red: a milestone overdue and not done; late tasks ≥ 25% of the open ones with at least 3 late; or
 * 3+ missing checks. Amber, otherwise: any late task, any missing check, or (ACTIVE projects) no
 * activity for 14 days. Green: none of these. Every reason that applies is listed, red ones first.
 */
export function projectRag(f: HealthFacts, ctx: { now: Date; timeZone: string }): { rag: Rag; reasons: RagReason[] } {
  const reasons: RagReason[] = [];
  if (f.lateMilestones.length === 1) {
    const m = f.lateMilestones[0]!;
    reasons.push({ code: 'MILESTONE_LATE', level: 'RED', text: `Milestone “${m.title}” is ${plural(m.daysLate, 'day')} late` });
  } else if (f.lateMilestones.length > 1) {
    reasons.push({ code: 'MILESTONE_LATE', level: 'RED', text: `${f.lateMilestones.length} milestones are late` });
  }
  const manyLate = f.late >= RED_LATE_MIN && f.late >= f.open * RED_LATE_SHARE;
  if (manyLate) reasons.push({ code: 'MANY_LATE', level: 'RED', text: `${f.late} of ${f.open} open tasks are late` });
  if (f.missingChecks >= RED_MISSING_CHECKS) reasons.push({ code: 'MANY_MISSING_CHECKS', level: 'RED', text: plural(f.missingChecks, 'missing check') });
  if (f.late > 0 && !manyLate) reasons.push({ code: 'LATE_TASKS', level: 'AMBER', text: plural(f.late, 'late task') });
  if (f.missingChecks > 0 && f.missingChecks < RED_MISSING_CHECKS) reasons.push({ code: 'MISSING_CHECKS', level: 'AMBER', text: plural(f.missingChecks, 'missing check') });
  if (f.status === 'ACTIVE') {
    const idle = daysBetween(zonedDayKey(f.lastActivityAt, ctx.timeZone), todayKey(ctx.timeZone, ctx.now));
    if (idle >= NO_ACTIVITY_DAYS) reasons.push({ code: 'NO_ACTIVITY', level: 'AMBER', text: `No activity for ${idle} days` });
  }
  if (reasons.length === 0) return { rag: 'GREEN', reasons: [{ code: 'ON_TRACK', level: 'GREEN', text: 'On track' }] };
  return { rag: reasons.some((r) => r.level === 'RED') ? 'RED' : 'AMBER', reasons };
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** Red, amber, green; then the most late tasks first; then by name. */
export function healthOrder(a: { rag: Rag; late: number; name: string }, b: { rag: Rag; late: number; name: string }): number {
  return RANK[a.rag] - RANK[b.rag] || b.late - a.late || collator.compare(a.name, b.name);
}

/**
 * The project page's Completion (frontend lib/project-dashboard `taskStats().pct`): the share of
 * tasks finished — a Done column or a completion time — rounded. Not a second rule: a test checks
 * it gives the page's number.
 */
export function completionPct(done: number, total: number): number {
  return total ? Math.round((done / total) * 100) : 0;
}

/** Passed items ÷ (passed + failed) as a whole percent; null when nothing was passed or failed. */
export function passRate(passed: number, failed: number): number | null {
  const answered = passed + failed;
  return answered ? Math.round((passed / answered) * 100) : null;
}

const weekdayOf = (key: string) => new Date(`${key}T12:00:00.000Z`).getUTCDay();
/** The first working day (0 = Sunday … 6 = Saturday) of the week starting on `weekStartKey`. */
export function firstWorkingDay(weekStartKey: string, workingDays: number[]): string {
  for (let i = 0; i < 7; i++) {
    const day = shiftDayKey(weekStartKey, i);
    if (workingDays.includes(weekdayOf(day))) return day;
  }
  return weekStartKey;
}

/** One company week of the trends. */
export interface TrendWeek {
  /** First and last day ('YYYY-MM-DD', company time). */
  start: string;
  end: string;
  /** "4 Oct": the week's first day. */
  label: string;
  /** Company midnight at its start, and at the next week's start. */
  from: Date;
  to: Date;
  /** Late tasks are counted as of this day (the week's last day; today for the current week)… */
  lateOn: string;
  /** …at this moment (the week's end; now for the current week). */
  lateAt: Date;
  current: boolean;
}

export interface WeekContext {
  now: Date;
  timeZone: string;
  weekStart: WeekStart;
  weeks: number;
}

const labelOf = (key: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00.000Z`));

/** The last `weeks` company weeks, oldest first, ending with the week today is in. */
export function trendWeeks({ now, timeZone, weekStart, weeks }: WeekContext): TrendWeek[] {
  const today = todayKey(timeZone, now);
  const current = weekOf(today, weekStart);
  return Array.from({ length: weeks }, (_, i) => {
    const start = shiftDayKey(current, -7 * (weeks - 1 - i));
    const end = shiftDayKey(start, 6);
    const isCurrent = start === current;
    const to = zonedStartOfDay(shiftDayKey(start, 7), timeZone);
    return {
      start,
      end,
      label: labelOf(start),
      from: zonedStartOfDay(start, timeZone),
      to,
      lateOn: isCurrent ? today : end,
      lateAt: isCurrent ? now : to,
      current: isCurrent,
    };
  });
}

/** The period the inspection statistics cover: from the first trend week's first day to today. */
export function periodOf(ctx: WeekContext): { from: string; to: string; weeks: number } {
  const weeks = trendWeeks(ctx);
  return { from: weeks[0]!.start, to: todayKey(ctx.timeZone, ctx.now), weeks: ctx.weeks };
}
