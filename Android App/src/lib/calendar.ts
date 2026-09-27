import type { ApiTask } from './types';
import { dueDayKey } from './due-date';

export interface CalendarDay {
  /** Calendar day as `YYYY-MM-DD` (the due date's own day — never shifted by time zone). */
  date: string;
  tasks: ApiTask[];
}

/**
 * Group tasks with a due date into calendar days for the Calendar screen (A5, XP-03). A due date
 * is a calendar day stored as UTC midnight, so its day is the UTC date — reading it in the device
 * zone would move every task to the previous day on a phone set west of UTC.
 */
export function groupTasksByDueDate(tasks: ApiTask[]): CalendarDay[] {
  const byDay = new Map<string, ApiTask[]>();
  for (const task of tasks) {
    const key = dueDayKey(task.dueDate);
    if (!key) continue;
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
