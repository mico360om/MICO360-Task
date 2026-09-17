/**
 * Per-date Kanban boards: each task carries a `boardDate` (the calendar day it appears on).
 * These pure helpers convert between an instant and a company-time-zone date key, and plan the
 * daily carry-forward of still-open tasks onto today's board. All date handling is time-zone aware
 * and anchored at noon UTC so a stored board date maps to a stable calendar day across zones.
 */

/** Calendar-date key 'YYYY-MM-DD' for an instant, in the given IANA time zone (en-CA → ISO order). */
export function boardDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** A stable stored anchor (noon UTC) for a 'YYYY-MM-DD' key — safe across realistic zones (±11h). */
export function boardDateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

export interface CarryForwardConfig {
  /** Master switch for automatic daily carry-forward. */
  enabled: boolean;
  /** Column categories eligible to carry forward (DONE is never carried). */
  statuses: string[];
}

export interface CarryTask {
  id: string;
  columnCategory: string;
  completedAt: Date | null;
  boardDate: Date;
}

/** One entry in a task's carry-forward history. */
export interface CarryLogEntry {
  from: string;
  to: string;
  at: string;
}

export interface CarryPlan {
  id: string;
  toKey: string;
  logEntry: CarryLogEntry;
}

/**
 * Given all candidate tasks and today's key, return the carry-forward moves to apply: every open
 * task (not DONE, no completedAt) of an eligible status whose board date is before today moves to
 * today, with a history log entry. Completed tasks stay on their day; nothing moves when disabled.
 */
export function planCarryForward(
  tasks: CarryTask[],
  todayKey: string,
  config: CarryForwardConfig,
  timeZone: string,
  now: Date = new Date(),
): CarryPlan[] {
  if (!config.enabled) return [];
  const at = now.toISOString();
  const plans: CarryPlan[] = [];
  for (const t of tasks) {
    const done = t.columnCategory === 'DONE' || t.completedAt !== null;
    if (done) continue;
    if (!config.statuses.includes(t.columnCategory)) continue;
    const fromKey = boardDateKey(t.boardDate, timeZone);
    if (fromKey < todayKey) {
      plans.push({ id: t.id, toKey: todayKey, logEntry: { from: fromKey, to: todayKey, at } });
    }
  }
  return plans;
}

/** Default eligible statuses — every non-DONE category carries forward unless config overrides. */
export const DEFAULT_CARRY_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW'];
