/**
 * A project's milestones and deadlines, worked out from its tasks — the same rules as the web
 * dashboard. "Today" is a 'YYYY-MM-DD' day in company time; due dates are calendar days.
 */
import type { ApiTask } from './types';
import { dueDayKey } from './due-date';

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);

export const isTaskFinished = (t: ApiTask) => t.columnCategory === 'DONE' || !!t.completedAt;

export type MilestoneState = 'done' | 'overdue' | 'upcoming' | 'undated';

/** The project's milestones by date (undated last), with where each stands. */
export function projectMilestones(tasks: ApiTask[], today: string) {
  return tasks
    .filter((t) => t.isMilestone)
    .map((t) => {
      const due = dueDayKey(t.dueDate);
      const state: MilestoneState = isTaskFinished(t) ? 'done' : !due ? 'undated' : due < today ? 'overdue' : 'upcoming';
      return { task: t, due, state, daysLeft: due && state !== 'done' ? daysBetween(today, due) : null };
    })
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.task.title.localeCompare(b.task.title));
}

/** Open tasks due within `withinDays` (and every overdue one), soonest first. */
export function projectDeadlines(tasks: ApiTask[], today: string, withinDays = 14) {
  const list: { task: ApiTask; due: string; daysLeft: number }[] = [];
  for (const t of tasks) {
    const due = dueDayKey(t.dueDate);
    if (!due || isTaskFinished(t)) continue;
    const daysLeft = daysBetween(today, due);
    if (daysLeft <= withinDays) list.push({ task: t, due, daysLeft });
  }
  return list.sort((a, b) => a.daysLeft - b.daysLeft || a.task.title.localeCompare(b.task.title));
}

/** "Today", "Tomorrow", "In 5 days", "3 days late". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  if (daysLeft > 1) return `In ${daysLeft} days`;
  return daysLeft === -1 ? '1 day late' : `${-daysLeft} days late`;
}
