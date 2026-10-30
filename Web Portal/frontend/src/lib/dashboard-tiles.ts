import { dueDayKey, todayKey, type DateInput } from './due-date';
import { isTaskDone } from './due-display';
import { weekDays, type WeekStart } from './calendar';

export interface MyDueCounts {
  /** Open tasks whose due day is before today. */
  overdue: number;
  /** Open tasks due from today to the last day of this week. */
  dueThisWeek: number;
  /** Today and this week's last day ('YYYY-MM-DD'), in the company's zone and week. */
  today: string;
  weekEnd: string;
}

/**
 * The employee Dashboard's Overdue and Due this week tiles, from the person's own tasks (the list the
 * page already loads). Days are company calendar days; the week is the company's (its week start,
 * Sunday until an administrator sets one). Finished work never counts.
 */
export function myDueCounts(
  tasks: readonly { dueDate?: DateInput; columnCategory?: string | null; completedAt?: string | null }[],
  { timeZone, weekStart, now = new Date() }: { timeZone: string; weekStart: WeekStart; now?: Date },
): MyDueCounts {
  const today = todayKey(timeZone, now);
  const weekEnd = weekDays(today, weekStart)[6]!;
  let overdue = 0;
  let dueThisWeek = 0;
  for (const t of tasks) {
    if (isTaskDone(t)) continue;
    const day = dueDayKey(t.dueDate, timeZone);
    if (!day) continue;
    if (day < today) overdue += 1;
    else if (day <= weekEnd) dueThisWeek += 1;
  }
  return { overdue, dueThisWeek, today, weekEnd };
}
