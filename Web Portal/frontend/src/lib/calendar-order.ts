import type { CalItem, CalStatus } from './calendar-model';

const ORDER: Record<CalStatus, number> = { overdue: 0, blocked: 1, 'in-progress': 2, todo: 3, projected: 4, done: 5 };
const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** Each item's place in a busy day, as groupByDay orders a day (status, then priority, then title): key → rank. */
export function calendarOrder(items: readonly CalItem[]): Map<string, number> {
  const sorted = [...items].sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || (PRIORITY_RANK[a.task.priority] ?? 2) - (PRIORITY_RANK[b.task.priority] ?? 2) || a.task.title.localeCompare(b.task.title, 'en'),
  );
  return new Map(sorted.map((i, n) => [i.key, n]));
}
