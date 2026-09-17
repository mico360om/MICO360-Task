import type { ReportTask } from './report-service';

const DAY_MS = 86_400_000;

/** A single day's snapshot in a report time series. */
export interface TimeSeriesPoint {
  /** Bucket day, YYYY-MM-DD (UTC). */
  date: string;
  /** Tasks created on this day. */
  created: number;
  /** Tasks completed on this day. */
  completed: number;
  /** Tasks overdue as of the end of this day (due date passed, still open). */
  overdue: number;
  /** Open (not-yet-done) tasks that existed as of the end of this day — the burndown actual. */
  remaining: number;
  /** Linear reference burndown from the starting open count down to zero across the window. */
  ideal: number;
}

/** Completed throughput for one calendar week of the window. */
export interface VelocityPoint {
  /** First day of the 7-day bucket, YYYY-MM-DD (UTC). */
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

const dayStartMs = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);
const toDayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Every inclusive UTC day between `from` and `to` (both YYYY-MM-DD), ascending. */
export function enumerateDays(from: string, to: string): string[] {
  const start = dayStartMs(from);
  const end = dayStartMs(to);
  const out: string[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) out.push(toDayKey(ms));
  return out;
}

/** A task is "done as of" a moment iff it carries a completion timestamp before that moment. */
const doneAsOf = (t: ReportTask, boundaryMs: number): boolean => t.completedAt !== null && t.completedAt.getTime() < boundaryMs;
const existedAsOf = (t: ReportTask, boundaryMs: number): boolean => t.createdAt.getTime() < boundaryMs;

/**
 * Turn a flat task list into a daily time series over [from, to]: per-day created/completed
 * counts, plus end-of-day snapshots of overdue and remaining (open) tasks, an ideal burndown
 * line, and weekly velocity. Pure and deterministic — pass a project-filtered list for a
 * per-project burndown.
 */
export function buildTimeSeries(tasks: ReportTask[], from: string, to: string): TimeSeriesResult {
  const days = enumerateDays(from, to);

  const points: TimeSeriesPoint[] = days.map((date) => {
    const start = dayStartMs(date);
    const boundary = start + DAY_MS; // exclusive end-of-day (next midnight)
    let created = 0;
    let completed = 0;
    let overdue = 0;
    let remaining = 0;
    for (const t of tasks) {
      const createdMs = t.createdAt.getTime();
      if (createdMs >= start && createdMs < boundary) created += 1;
      if (t.completedAt) {
        const cMs = t.completedAt.getTime();
        if (cMs >= start && cMs < boundary) completed += 1;
      }
      const open = existedAsOf(t, boundary) && !doneAsOf(t, boundary);
      if (open) {
        remaining += 1;
        if (t.dueDate && t.dueDate.getTime() < boundary) overdue += 1;
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
