import { isOverdue } from '../../lib/due-date';
import { defaultCompanyTimeZone, isTaskDone } from '../tasks/task-status';

/** The minimal task shape needed to compute a project's progress. */
export interface ProgressTask {
  columnCategory?: string | null;
  completedAt?: Date | null;
  dueDate?: Date | null;
  progress?: number;
}

export interface ProjectProgress {
  total: number;
  completed: number;
  inProgress: number;
  todo: number;
  overdue: number;
  /** 0–100, share of done tasks. */
  completionPct: number;
  /** Task counts per column category (BACKLOG/TODO/IN_PROGRESS/BLOCKED/REVIEW/DONE). */
  byCategory: Record<string, number>;
}

/**
 * Compute a project's progress from its tasks. "Done" is the shared rule (a DONE column or a
 * completion time), and a task is overdue only once its due day is before today in the company
 * time zone — a task due today is not overdue yet.
 */
export function computeProjectProgress(
  tasks: ProgressTask[],
  now: Date = new Date(),
  timeZone: string = defaultCompanyTimeZone(),
): ProjectProgress {
  const byCategory: Record<string, number> = {};
  let completed = 0;
  let inProgress = 0;
  let todo = 0;
  let overdue = 0;

  for (const t of tasks) {
    const category = t.columnCategory ?? 'TODO';
    byCategory[category] = (byCategory[category] ?? 0) + 1;

    if (isTaskDone({ columnCategory: category, completedAt: t.completedAt })) {
      completed += 1;
      continue;
    }
    if (category === 'IN_PROGRESS') inProgress += 1;
    else if (category === 'TODO' || category === 'BACKLOG') todo += 1;
    if (isOverdue(t.dueDate, timeZone, now)) overdue += 1;
  }

  const total = tasks.length;
  return {
    total,
    completed,
    inProgress,
    todo,
    overdue,
    completionPct: total ? Math.round((completed / total) * 100) : 0,
    byCategory,
  };
}
