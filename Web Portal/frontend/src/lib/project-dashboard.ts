/**
 * The numbers on a project's dashboard, worked out from its tasks: where each task stands,
 * progress, milestones, the deadlines coming up, how far through its dates the project is, and
 * who has how much on. "Today" is a 'YYYY-MM-DD' day in company time; due dates are calendar days.
 */
import type { ApiTask, Priority } from '../api/tasks';

export type TaskPhase = 'completed' | 'overdue' | 'ongoing' | 'pending';

const ONGOING = new Set(['IN_PROGRESS', 'REVIEW', 'BLOCKED']);
const DAY_MS = 86_400_000;

/** The calendar day of a stored due date (they are UTC midnight of their day). */
const dueDay = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);

export const isFinished = (t: ApiTask) => t.columnCategory === 'DONE' || !!t.completedAt;

/** Completed; overdue (open and past its due day); ongoing (being worked on); or pending (not started). */
export function taskPhase(t: ApiTask, today: string): TaskPhase {
  if (isFinished(t)) return 'completed';
  const due = dueDay(t.dueDate);
  if (due && due < today) return 'overdue';
  return ONGOING.has(t.columnCategory ?? '') ? 'ongoing' : 'pending';
}

export function taskStats(tasks: ApiTask[], today: string) {
  const count = { completed: 0, overdue: 0, ongoing: 0, pending: 0 };
  const byPriority: Record<Priority, number> = { URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
  let progress = 0;
  for (const t of tasks) {
    const phase = taskPhase(t, today);
    count[phase] += 1;
    progress += phase === 'completed' ? 100 : Math.max(0, Math.min(100, t.progress ?? 0));
    if (phase !== 'completed') byPriority[t.priority] += 1;
  }
  const total = tasks.length;
  return {
    total,
    ...count,
    /** Share of tasks finished. */
    pct: total ? Math.round((count.completed / total) * 100) : 0,
    /** The tasks' average progress (finished ones count as 100%). */
    avgProgress: total ? Math.round(progress / total) : 0,
    /** Open tasks by priority. */
    byPriority,
  };
}

export type MilestoneState = 'done' | 'overdue' | 'upcoming' | 'undated';

/** The project's milestones by date (undated last), with where each stands. */
export function milestones(tasks: ApiTask[], today: string) {
  return tasks
    .filter((t) => t.isMilestone)
    .map((t) => {
      const due = dueDay(t.dueDate);
      const state: MilestoneState = isFinished(t) ? 'done' : !due ? 'undated' : due < today ? 'overdue' : 'upcoming';
      return { task: t, due, state, daysLeft: due && state !== 'done' ? daysBetween(today, due) : null };
    })
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.task.title.localeCompare(b.task.title));
}

/** Open tasks due within `withinDays` (and every overdue one), soonest first. */
export function deadlines(tasks: ApiTask[], today: string, withinDays = 14) {
  return tasks
    .filter((t) => !isFinished(t) && dueDay(t.dueDate))
    .map((t) => ({ task: t, due: dueDay(t.dueDate)!, daysLeft: daysBetween(today, dueDay(t.dueDate)!) }))
    .filter((d) => d.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.task.title.localeCompare(b.task.title));
}

/** How far through its start and target dates the project is (null without both). */
export function projectTimeline(startDate: string | null | undefined, targetDate: string | null | undefined, today: string) {
  const start = dueDay(startDate);
  const end = dueDay(targetDate);
  if (!start || !end) return null;
  const span = Math.max(1, daysBetween(start, end));
  const gone = daysBetween(start, today);
  const daysLeft = daysBetween(today, end);
  const state = today < start ? 'not-started' : today > end ? 'late' : 'running';
  return { start, end, elapsedPct: Math.max(0, Math.min(100, Math.round((gone / span) * 100))), daysLeft, state } as const;
}

/** Each assignee's open, overdue and completed tasks — busiest first. */
export function workload(tasks: ApiTask[], today: string) {
  const people = new Map<string, { id: string; name: string; open: number; overdue: number; completed: number }>();
  for (const t of tasks) {
    const phase = taskPhase(t, today);
    for (const a of t.assignees ?? []) {
      const p = people.get(a.id) ?? { id: a.id, name: a.name, open: 0, overdue: 0, completed: 0 };
      if (phase === 'completed') p.completed += 1;
      else {
        p.open += 1;
        if (phase === 'overdue') p.overdue += 1;
      }
      people.set(a.id, p);
    }
  }
  return [...people.values()].sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.name.localeCompare(b.name));
}
