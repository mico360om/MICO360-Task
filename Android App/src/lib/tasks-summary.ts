import type { ApiTask } from './types';
import { daysUntilDue } from './due-date';

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

const dueTime = (t: ApiTask): number => new Date(t.dueDate as string).getTime();

/**
 * Bucket a user's tasks for the Dashboard / My Tasks screens (A3, XP-03). "Today" is the company
 * time-zone date and a due date is its own calendar day, so a task due today is "Due today" all
 * day long (not overdue from 04:00), matching the web portal and the API.
 */
export function summarizeTasks(tasks: ApiTask[], now: Date): TaskSummary {
  const overdue: ApiTask[] = [];
  const dueToday: ApiTask[] = [];
  const upcoming: ApiTask[] = [];
  let completed = 0;

  for (const task of tasks) {
    if (task.completedAt) {
      completed += 1;
      continue;
    }
    const days = daysUntilDue(task.dueDate, now);
    if (days === null) continue;
    if (days < 0) overdue.push(task);
    else if (days === 0) dueToday.push(task);
    else upcoming.push(task);
  }

  const byDueAsc = (a: ApiTask, b: ApiTask) => dueTime(a) - dueTime(b);
  overdue.sort(byDueAsc);
  upcoming.sort(byDueAsc);

  return { total: tasks.length, completed, overdue, dueToday, upcoming };
}
