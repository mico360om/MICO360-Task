import type { ApiTask } from './types';

export interface CalendarDay {
  /** Local calendar day as `YYYY-MM-DD`. */
  date: string;
  tasks: ApiTask[];
}

const dayKey = (iso: string): string => {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

/** Group tasks with a due date into local calendar days for the Calendar screen (A5). */
export function groupTasksByDueDate(tasks: ApiTask[]): CalendarDay[] {
  const byDay = new Map<string, ApiTask[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const key = dayKey(task.dueDate);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(task);
    else byDay.set(key, [task]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, dayTasks]) => ({
      date,
      tasks: dayTasks.sort(
        (a, b) => new Date(a.dueDate as string).getTime() - new Date(b.dueDate as string).getTime(),
      ),
    }));
}
