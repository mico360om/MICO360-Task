import type { ReportTask } from './report-service';
import { dueDayKey, shiftDayKey, zonedStartOfDay } from '../../lib/due-date';
import { defaultCompanyTimeZone } from '../tasks/task-status';

/** A single day's snapshot in a report time series. */
export interface TimeSeriesPoint {
  /** Bucket day, YYYY-MM-DD (company time zone). */
  date: string;
  /** Tasks created on this day. */
  created: number;
  /** Tasks completed on this day. */
  completed: number;
  /** Open tasks whose due day was before this day (overdue during it). */
  overdue: number;
  /** Open (not-yet-done) tasks that existed as of the end of this day — the burndown actual. */
  remaining: number;
  /** Linear reference burndown from the starting open count down to zero across the window. */
  ideal: number;
}

/** Completed throughput for one calendar week of the window. */
export interface VelocityPoint {
  /** First day of the 7-day bucket, YYYY-MM-DD. */
  weekStart: string;
  completed: number;
}

export interface TimeSeriesResult {
  from: string;
  to: string;
  points: TimeSeriesPoint[];
  velocity: VelocityPoint[];
  /** Average completed tasks per week over the window (1 decimal). */
  velocityPerWeek: number;
}

/** Every inclusive calendar day between `from` and `to` (both YYYY-MM-DD), ascending. */
export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  // Hard cap (10 years) so a malformed range can never loop forever.
  for (let day = from; day <= to && out.length < 3660; day = shiftDayKey(day, 1)) out.push(day);
  return out;
}

/**
 * When a task counts as done for the trend: its completion time, or — for a task that sits in a
 * DONE column without one (created straight into Done by older versions) — its creation time,
 * so the trend and the snapshot reports agree on what is done.
 */
const doneAtMs = (t: ReportTask): number | null =>
  t.completedAt ? t.completedAt.getTime() : t.columnCategory === 'DONE' ? t.createdAt.getTime() : null;

/**
 * Turn a flat task list into a daily time series over [from, to]: per-day created/completed
 * counts, plus end-of-day snapshots of overdue and remaining (open) tasks, an ideal burndown
 * line, and weekly velocity. Days are company-time-zone calendar days (00:00–24:00 local), so
 * work done just after local midnight lands on the right day. Pure and deterministic — pass a
 * filtered list for a per-project (or per-person) burndown.
 */
export function buildTimeSeries(tasks: ReportTask[], from: string, to: string, timeZone: string = defaultCompanyTimeZone()): TimeSeriesResult {
  const days = enumerateDays(from, to);
  const dueKeys = new Map(tasks.map((t) => [t.id, dueDayKey(t.dueDate, timeZone)] as const));

  const points: TimeSeriesPoint[] = days.map((date) => {
    const start = zonedStartOfDay(date, timeZone).getTime();
    const boundary = zonedStartOfDay(shiftDayKey(date, 1), timeZone).getTime(); // exclusive end of day
    let created = 0;
    let completed = 0;
    let overdue = 0;
    let remaining = 0;
    for (const t of tasks) {
      const createdMs = t.createdAt.getTime();
      if (createdMs >= start && createdMs < boundary) created += 1;
      const doneMs = doneAtMs(t);
      if (doneMs !== null && doneMs >= start && doneMs < boundary) completed += 1;
      const open = createdMs < boundary && !(doneMs !== null && doneMs < boundary);
      if (open) {
        remaining += 1;
        const due = dueKeys.get(t.id);
        if (due && due < date) overdue += 1;
      }
    }
    return { date, created, completed, overdue, remaining, ideal: 0 };
  });

  // Ideal burndown: straight line from the first day's remaining down to zero on the last day.
  const start = points.length ? points[0]!.remaining : 0;
  const n = points.length;
  points.forEach((p, i) => {
    p.ideal = n <= 1 ? 0 : Math.round((start * (n - 1 - i)) / (n - 1));
  });

  // Weekly velocity — sum completed over consecutive 7-day buckets aligned to `from`.
  const velocity: VelocityPoint[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const week = points.slice(i, i + 7);
    velocity.push({ weekStart: week[0]!.date, completed: week.reduce((s, p) => s + p.completed, 0) });
  }
  const totalCompleted = points.reduce((s, p) => s + p.completed, 0);
  const velocityPerWeek = velocity.length ? Math.round((totalCompleted / velocity.length) * 10) / 10 : 0;

  return { from, to, points, velocity, velocityPerWeek };
}
