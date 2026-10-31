import { companyTodayKey, dueDayKey, isTaskDone } from './due-date';
import { isWaitingForApproval } from './approvals';
import { weekDays, type WeekStart } from './calendar';
import type { ApiTask } from './types';

/**
 * The employee Dashboard's Overdue and Due this week tiles — the website's lib/dashboard-tiles.ts
 * (its myDueCounts; a drift test runs both on the same tasks, and the server's isTaskLate beside it).
 */
export interface MyDueCounts {
  /** Open tasks whose due day is before today (never one waiting for approval). */
  overdue: number;
  /** Open tasks due from today to the last day of this week. */
  dueThisWeek: number;
  /** Today and this week's last day ('YYYY-MM-DD'), in the company's zone and week. */
  today: string;
  weekEnd: string;
}

/**
 * From the person's own tasks (the list the page already loads). Days are company calendar days; the
 * week is the company's (its week start, Sunday until an administrator sets one). Finished work never
 * counts.
 */
export function myDueCounts(
  tasks: readonly Partial<Pick<ApiTask, 'dueDate' | 'columnCategory' | 'completedAt' | 'approvalRequestedAt'>>[],
  { timeZone, weekStart, now = new Date() }: { timeZone: string; weekStart: WeekStart; now?: Date },
): MyDueCounts {
  const today = companyTodayKey(now, timeZone);
  const weekEnd = weekDays(today, weekStart)[6]!;
  let overdue = 0;
  let dueThisWeek = 0;
  for (const t of tasks) {
    if (isTaskDone(t)) continue;
    const day = dueDayKey(t.dueDate, timeZone);
    if (!day) continue;
    // Waiting for approval: handed in, never overdue while it waits (owner, 30 Oct).
    if (day < today) overdue += isWaitingForApproval(t) ? 0 : 1;
    else if (day <= weekEnd) dueThisWeek += 1;
  }
  return { overdue, dueThisWeek, today, weekEnd };
}
