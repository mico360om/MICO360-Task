import { matchQuery, type Query, type QueryClient } from '@tanstack/react-query';

/** A query key to refresh, with everything under it unless `exact`. */
export interface KeyRefresh {
  queryKey: string[];
  exact?: boolean;
}

/**
 * Something to refresh after a change:
 * - a query key (KeyRefresh);
 * - `listsHolding`: every cached task list (board days, a project's tasks, My Tasks, a search)
 *   that holds this task, and no other;
 * - `progressFor`: the progress figures of this task's project (every project's, when the task
 *   isn't in the cache);
 * - `taskDetails`: every task's own details, without their parts (a change to a whole series).
 */
export type Refresh = KeyRefresh | { listsHolding: string } | { progressFor: string } | { taskDetails: 'all' };

type Task = { id?: unknown; projectId?: unknown };

const holds = (data: unknown, taskId: string): boolean => Array.isArray(data) && data.some((t) => (t as Task | null)?.id === taskId);

/** The project a cached task belongs to: from its details, or from a list that holds it. */
function projectOf(qc: QueryClient, taskId: string): string | undefined {
  const own = (qc.getQueryData(['task', taskId]) as Task | undefined)?.projectId;
  if (typeof own === 'string') return own;
  for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })) {
    const found = Array.isArray(data) ? data.find((t) => t?.id === taskId) : undefined;
    if (typeof found?.projectId === 'string') return found.projectId;
  }
  return undefined;
}

function matcher(qc: QueryClient, target: Refresh): (q: Query) => boolean {
  if ('listsHolding' in target) {
    return (q) => q.queryKey[0] === 'tasks' && holds(q.state.data, target.listsHolding);
  }
  if ('progressFor' in target) {
    const projectId = projectOf(qc, target.progressFor);
    return (q) => q.queryKey[0] === 'project' && q.queryKey[2] === 'progress' && q.queryKey.length === 3 && (!projectId || q.queryKey[1] === projectId);
  }
  if ('taskDetails' in target) return (q) => q.queryKey[0] === 'task' && q.queryKey.length === 2;
  return (q) => matchQuery({ queryKey: target.queryKey, exact: target.exact }, q);
}

/**
 * Refresh what the targets name, in one pass: each matching query is marked out of date once, and
 * the ones on screen are refetched once — two targets naming the same list never fetch it twice
 * (a second invalidation would cancel the first fetch and start another).
 */
export function refresh(qc: QueryClient, targets: Refresh[]): void {
  if (targets.length === 0) return;
  const tests = targets.map((t) => matcher(qc, t));
  const hits = new Set(qc.getQueryCache().getAll().filter((q) => tests.some((test) => test(q))));
  if (hits.size === 0) return;
  void qc.invalidateQueries({ predicate: (q) => hits.has(q) });
}
