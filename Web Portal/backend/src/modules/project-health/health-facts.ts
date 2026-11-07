/**
 * 1.23.5 Project overview & health — the facts behind the new health reasons, pure: a task's hold-up
 * (blocked, design call 2), a milestone at risk (call 1), one person holding too much of the open work
 * (call 3), and how much of the project's time is used. Days are company days ('YYYY-MM-DD').
 */
import { dueDayKey, shiftDayKey, zonedDayKey } from '../../lib/due-date';
import { daysBetween } from '../planning/timeline';

/** A hold-up counts for health once it has lasted over this many days (8 or more). */
export const BLOCKED_OVER_DAYS = 7;
/** Red from this many tasks held up over 7 days. */
export const BLOCKED_RED = 5;
/** A milestone due within this many days… */
export const MILESTONE_RISK_DAYS = 7;
/** …with at least this share of its linked work still open is at risk. */
export const MILESTONE_RISK_SHARE = 0.5;
/** One person holding at least this many open tasks… */
export const WORKLOAD_MIN = 8;
/** …and at least this share of the project's open tasks. */
export const WORKLOAD_SHARE = 0.4;
/** Open work held by this many people or fewer is never "one person holds too much". */
export const WORKLOAD_EXEMPT_PEOPLE = 2;

export interface DayContext {
  /** Today, 'YYYY-MM-DD' in the company time zone. */
  today: string;
  timeZone: string;
}

export interface HoldUpInput {
  /** Its column's stage (BLOCKED: a Blocked column). */
  columnCategory: string | null;
  /** Its latest column change (a MOVED / REOPENED / SENT_BACK history line); null when there is none. */
  movedAt: Date | null;
  updatedAt: Date;
  startDate: Date | null;
  dueDate: Date | null;
  /** The due dates of the open tasks it waits on (same project; null: undated). */
  openBlockerDues: (Date | null)[];
}

export interface HoldUp {
  /** status: a Blocked column; dependency: waiting on a blocker once that became a real hold-up. */
  kind: 'status' | 'dependency';
  /** The day the hold-up started. */
  since: string;
  /** Whole days since then (0 = started today). */
  days: number;
}

/** The day after a stored date's company day (when that date "has passed"). */
const dayAfter = (d: Date | null, timeZone: string): string | null => {
  const key = dueDayKey(d, timeZone);
  return key ? shiftDayKey(key, 1) : null;
};

/**
 * Is the task held up, and since when? A Blocked column always counts, its clock from the move into it
 * (else its last update). A task waiting on an open blocker counts only once that is a real hold-up — the
 * blocker is overdue, or the task's own start or due date has passed — its clock from that moment. A
 * planned sequence (nothing late yet) is no hold-up. Both: the earlier clock.
 */
export function holdUpOf(t: HoldUpInput, ctx: DayContext): HoldUp | null {
  const found: HoldUp[] = [];
  if (t.columnCategory === 'BLOCKED') {
    const since = zonedDayKey(t.movedAt ?? t.updatedAt, ctx.timeZone);
    found.push({ kind: 'status', since, days: Math.max(0, daysBetween(since, ctx.today)) });
  }
  if (t.openBlockerDues.length > 0) {
    const moments = [dayAfter(t.startDate, ctx.timeZone), dayAfter(t.dueDate, ctx.timeZone), ...t.openBlockerDues.map((d) => dayAfter(d, ctx.timeZone))].filter(
      (k): k is string => k !== null && k <= ctx.today,
    );
    if (moments.length) {
      const since = moments.sort()[0]!;
      found.push({ kind: 'dependency', since, days: daysBetween(since, ctx.today) });
    }
  }
  if (found.length === 0) return null;
  return found.sort((a, b) => a.since.localeCompare(b.since))[0]!;
}

/** Held up over 7 days: it counts for the project's health. */
export const isLongHoldUp = (h: HoldUp | null): boolean => !!h && h.days > BLOCKED_OVER_DAYS;

export interface MilestoneInput {
  dueDate: Date | null;
  /** Waiting for approval: handed in, never late or at risk while it waits. */
  waiting: boolean;
  /** Its linked work (call 1): the tasks it waits on, else the project's tasks due on or before its day. */
  linked: { total: number; open: number };
}

/** At risk: due today or within 7 days, with half or more of its linked work still open. */
export function milestoneRisk(m: MilestoneInput, ctx: DayContext): { daysLeft: number; open: number; total: number } | null {
  if (m.waiting) return null;
  const due = dueDayKey(m.dueDate, ctx.timeZone);
  if (!due) return null;
  const daysLeft = daysBetween(ctx.today, due);
  if (daysLeft < 0 || daysLeft > MILESTONE_RISK_DAYS) return null;
  const { total, open } = m.linked;
  if (total < 1 || open < total * MILESTONE_RISK_SHARE) return null;
  return { daysLeft, open, total };
}

/**
 * One person holding too much: 8 or more open tasks and 40%+ of the project's open tasks (in tasks, not
 * weight; a task with several assignees counts for each). Exempt when 2 or fewer people hold open work.
 */
export function workloadOf(openTotal: number, people: { userId: string; count: number }[]): { userId: string; count: number; openTotal: number; pct: number } | null {
  const holding = people.filter((p) => p.count > 0);
  if (holding.length <= WORKLOAD_EXEMPT_PEOPLE || openTotal <= 0) return null;
  const top = [...holding].sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId))[0]!;
  if (top.count < WORKLOAD_MIN || top.count < openTotal * WORKLOAD_SHARE) return null;
  return { userId: top.userId, count: top.count, openTotal, pct: Math.round((top.count / openTotal) * 100) };
}

/** The share of the project's planned days gone (the project page's Time bar), 0–100; null without a usable start and target. */
export function timeUsedPct(start: Date | null, target: Date | null, today: string, timeZone: string): number | null {
  const s = dueDayKey(start, timeZone);
  const e = dueDayKey(target, timeZone);
  if (!s || !e) return null;
  const span = daysBetween(s, e);
  if (span <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((daysBetween(s, today) / span) * 100)));
}
