/**
 * The numbers on a project's dashboard, worked out from its tasks: where each task stands,
 * progress, milestones, the deadlines coming up, how far through its dates the project is, and
 * who has how much on. "Today" is a 'YYYY-MM-DD' day in company time; due dates are calendar days.
 */
import type { ApiTask, Priority } from '../api/tasks';
import { dueDayKey } from './due-date';
import { isWaitingForApproval } from './approvals';

export type TaskPhase = 'completed' | 'overdue' | 'ongoing' | 'pending' | 'upcoming';

const ONGOING = new Set(['IN_PROGRESS', 'REVIEW', 'BLOCKED']);
const DAY_MS = 86_400_000;

/** The calendar day of a stored due date: its own day, or — given as a time — its company-time day. */
const dueDay = (iso: string | null | undefined, timeZone: string) => dueDayKey(iso, timeZone);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);

export const isFinished = (t: ApiTask) => t.columnCategory === 'DONE' || !!t.completedAt;

/**
 * Tasks scheduled for the future (owner, 10 Nov): the day an open task waits for — its board day while
 * that is later than today (board days are stored at noon UTC: their UTC date is the day) — else null.
 */
export function upcomingDay(t: ApiTask, today: string): string | null {
  const day = t.boardDate ? t.boardDate.slice(0, 10) : null;
  return day && day > today && !isFinished(t) ? day : null;
}

/**
 * Completed; upcoming (waiting for a later start day); overdue (open and past its due day — never while
 * it waits for approval: owner, 30 Oct); ongoing (being worked on); or pending (not started).
 */
export function taskPhase(t: ApiTask, today: string, timeZone = 'UTC'): TaskPhase {
  if (isFinished(t)) return 'completed';
  if (upcomingDay(t, today)) return 'upcoming';
  const due = dueDay(t.dueDate, timeZone);
  if (due && due < today && !isWaitingForApproval(t)) return 'overdue';
  return ONGOING.has(t.columnCategory ?? '') ? 'ongoing' : 'pending';
}

export function taskStats(tasks: ApiTask[], today: string, timeZone = 'UTC') {
  const count = { completed: 0, overdue: 0, ongoing: 0, pending: 0 };
  const byPriority: Record<Priority, number> = { URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
  for (const t of tasks) {
    const phase = taskPhase(t, today, timeZone);
    // A task waiting for its start day isn't started: the tiles count it with the not-started ones.
    count[phase === 'upcoming' ? 'pending' : phase] += 1;
    if (phase !== 'completed') byPriority[t.priority] += 1;
  }
  const total = tasks.length;
  return {
    total,
    ...count,
    /**
     * Share of tasks finished: the project's one completion figure (the Completion tile, Work done,
     * the client page, Management and Reports all show it). Not the tasks' average progress.
     */
    pct: total ? Math.round((count.completed / total) * 100) : 0,
    /** Open tasks by priority. */
    byPriority,
  };
}

/** `waiting`: finished and waiting for approval — never late while it waits. */
export type MilestoneState = 'done' | 'waiting' | 'overdue' | 'upcoming' | 'undated';

/** The project's milestones by date (undated last), with where each stands. */
export function milestones(tasks: ApiTask[], today: string, timeZone = 'UTC') {
  return tasks
    .filter((t) => t.isMilestone)
    .map((t) => {
      const due = dueDay(t.dueDate, timeZone);
      const state: MilestoneState = isFinished(t) ? 'done' : isWaitingForApproval(t) ? 'waiting' : !due ? 'undated' : due < today ? 'overdue' : 'upcoming';
      return { task: t, due, state, daysLeft: due && state !== 'done' ? daysBetween(today, due) : null };
    })
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999', 'en') || a.task.title.localeCompare(b.task.title, 'en'));
}

/** Open tasks due within `withinDays` (and every overdue one), soonest first; `waiting`: it waits for approval (never late meanwhile). */
export function deadlines(tasks: ApiTask[], today: string, withinDays = 14, timeZone = 'UTC') {
  return tasks
    .filter((t) => !isFinished(t) && dueDay(t.dueDate, timeZone))
    .map((t) => ({ task: t, due: dueDay(t.dueDate, timeZone)!, daysLeft: daysBetween(today, dueDay(t.dueDate, timeZone)!), waiting: isWaitingForApproval(t) }))
    .filter((d) => d.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.task.title.localeCompare(b.task.title, 'en'));
}

/** How far through its start and target dates the project is (null without both). */
export function projectTimeline(startDate: string | null | undefined, targetDate: string | null | undefined, today: string, timeZone = 'UTC') {
  const start = dueDay(startDate, timeZone);
  const end = dueDay(targetDate, timeZone);
  if (!start || !end) return null;
  const span = Math.max(1, daysBetween(start, end));
  const gone = daysBetween(start, today);
  const daysLeft = daysBetween(today, end);
  const state = today < start ? 'not-started' : today > end ? 'late' : 'running';
  return { start, end, elapsedPct: Math.max(0, Math.min(100, Math.round((gone / span) * 100))), daysLeft, state } as const;
}

/** Each assignee's open, overdue and completed tasks — busiest first. */
export function workload(tasks: ApiTask[], today: string, timeZone = 'UTC') {
  const people = new Map<string, { id: string; name: string; open: number; overdue: number; completed: number }>();
  for (const t of tasks) {
    const phase = taskPhase(t, today, timeZone);
    // Waiting for its start day: not on anyone's plate yet.
    if (phase === 'upcoming') continue;
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
  return [...people.values()].sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.name.localeCompare(b.name, 'en'));
}
