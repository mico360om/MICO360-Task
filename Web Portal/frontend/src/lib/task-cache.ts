import type { QueryClient } from '@tanstack/react-query';

/**
 * Every cached query that shows task data somewhere in the app: the board, My Tasks, the calendar,
 * the dashboard (all tasks + activity), project pages (task list, stats), search results, the open
 * drawer and the admin reports. One list so no task change can leave a view stale.
 */
export const TASK_QUERY_ROOTS = [
  'board',
  'my-tasks',
  'tasks',
  'project-tasks',
  'calendar-tasks',
  'task',
  'assignees',
  'task-activity',
  'activity',
  'search',
  'report-status',
  'report-projects',
  'report-workload',
  'report-completion',
  'report-timeseries',
] as const;

/** Refresh every task-related view after any task mutation (create, edit, move, assign, delete…). */
export function invalidateTaskQueries(qc: QueryClient): Promise<void> {
  return Promise.all(TASK_QUERY_ROOTS.map((root) => qc.invalidateQueries({ queryKey: [root] }))).then(() => undefined);
}
