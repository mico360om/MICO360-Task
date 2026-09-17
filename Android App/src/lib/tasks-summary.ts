import type { ApiTask } from './types';

export interface TaskSummary {
  total: number;
  completed: number;
  /** Open tasks whose due day is before today, oldest first. */
  overdue: ApiTask[];
  /** Open tasks due today. */
  dueToday: ApiTask[];
  /** Open tasks due after today, soonest first. */
  upcoming: ApiTask[];
}

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dueTime = (t: ApiTask): number => new Date(t.dueDate as string).getTime();

/** Bucket a user's tasks for the Dashboard / My Tasks screens (A3). */
export function summarizeTasks(tasks: ApiTask[], now: Date): TaskSummary {
  const today = startOfDay(now);
  const overdue: ApiTask[] = [];
  const dueToday: ApiTask[] = [];
  const upcoming: ApiTask[] = [];
  let completed = 0;

  for (const task of tasks) {
    if (task.completedAt) {
      completed += 1;
      continue;
    }
    if (!task.dueDate) continue;
    const day = startOfDay(new Date(task.dueDate));
    if (day < today) overdue.push(task);
    else if (day === today) dueToday.push(task);
    else upcoming.push(task);
  }

  const byDueAsc = (a: ApiTask, b: ApiTask) => dueTime(a) - dueTime(b);
  overdue.sort(byDueAsc);
  upcoming.sort(byDueAsc);

  return { total: tasks.length, completed, overdue, dueToday, upcoming };
}
