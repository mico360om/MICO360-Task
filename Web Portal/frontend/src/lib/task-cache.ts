import type { QueryClient } from '@tanstack/react-query';
import { PROJECTS_OVERVIEW_KEY } from '../api/projects';
import { TIMELINE_ROOT } from '../api/planning';

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
  'calendar',
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
  // The Workload page counts open tasks due each day and overdue ones.
  'workload',
] as const;

/** Views under another root that count tasks: the Projects page's card figures (open, overdue, next due…) and the Timeline's. */
export const TASK_FIGURE_KEYS: readonly (readonly string[])[] = [PROJECTS_OVERVIEW_KEY, TIMELINE_ROOT];

/** Refresh every task-related view after any task mutation (create, edit, move, assign, delete…). */
export function invalidateTaskQueries(qc: QueryClient): Promise<void> {
  const keys = [...TASK_QUERY_ROOTS.map((root) => [root]), ...TASK_FIGURE_KEYS.map((k) => [...k])];
  return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))).then(() => undefined);
}
