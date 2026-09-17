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
  /** 0–100, share of tasks in a DONE-category column. */
  completionPct: number;
  /** Task counts per column category (BACKLOG/TODO/IN_PROGRESS/BLOCKED/REVIEW/DONE). */
  byCategory: Record<string, number>;
}

/**
 * Compute a project's progress from its tasks. "Done" is membership of a DONE
 * column (the Kanban stage), which is also what marks a task complete on move.
 * Overdue = past the due date and not yet done.
 */
export function computeProjectProgress(tasks: ProgressTask[], now: Date = new Date()): ProjectProgress {
  const byCategory: Record<string, number> = {};
  let completed = 0;
  let inProgress = 0;
  let todo = 0;
  let overdue = 0;
  const nowMs = now.getTime();

  for (const t of tasks) {
    const category = t.columnCategory ?? 'TODO';
    byCategory[category] = (byCategory[category] ?? 0) + 1;

    if (category === 'DONE') {
      completed += 1;
      continue;
    }
    if (category === 'IN_PROGRESS') inProgress += 1;
    else if (category === 'TODO' || category === 'BACKLOG') todo += 1;
    if (t.dueDate && new Date(t.dueDate).getTime() < nowMs) overdue += 1;
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
