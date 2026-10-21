import { matchQuery, type Query, type QueryClient } from '@tanstack/react-query';

/**
 * A query key to refresh, with everything under it unless `exact`. `later` only marks it out of
 * date: it is fetched when next shown (a screen coming back into view, the app back in front, a
 * pull) instead of at once — for a change that only touches a count on a long list.
 */
export interface KeyRefresh {
  queryKey: string[];
  exact?: boolean;
  later?: boolean;
}

/**
 * Something to refresh after a change:
 * - a query key (KeyRefresh);
 * - `listsHolding`: every cached task list (board days, a project's tasks, My Tasks, a search)
 *   that holds this task, and no other;
 * - `progressFor`: the progress figures of this task's project (every project's, when the task
 *   isn't in the cache);
 * - `taskDetails`: every task's own details, without their parts (a change to a whole series);
 * - `projectMeetingsOf`: the meetings overview of this meeting's project (none for a standalone
 *   meeting; every project's when the meeting isn't in the cache).
 * - `meetingListsIfNew`: the meeting lists, when none of them — nor a meeting screen — holds this
 *   meeting yet (you were just invited to it); nothing otherwise.
 */
export type Refresh =
  | KeyRefresh
  | { listsHolding: string }
  | { progressFor: string }
  | { taskDetails: 'all' }
  | { projectMeetingsOf: string }
  | { meetingListsIfNew: string };

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

/**
 * The project a cached meeting belongs to: from its details, a meetings list or a project's
 * meetings overview holding it. null for a standalone meeting, undefined when it isn't cached.
 */
function meetingProjectOf(qc: QueryClient, meetingId: string): string | null | undefined {
  if (!meetingId) return undefined;
  const own = qc.getQueryData(['meeting', meetingId]) as Task | undefined;
  if (own && (typeof own.projectId === 'string' || own.projectId === null)) return own.projectId;
  for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: ['meetings'] })) {
    const found = Array.isArray(data) ? data.find((m) => m?.id === meetingId) : undefined;
    if (found && (typeof found.projectId === 'string' || found.projectId === null)) return found.projectId;
  }
  for (const q of qc.getQueryCache().findAll({ queryKey: ['project'] })) {
    const list = (q.state.data as { meetings?: unknown } | null | undefined)?.meetings;
    if (q.queryKey[2] === 'meetings' && holds(list, meetingId) && typeof q.queryKey[1] === 'string') return q.queryKey[1];
  }
  return undefined;
}

/** Does this phone know the meeting: on its own screen, or in a meetings list? */
function meetingKnown(qc: QueryClient, meetingId: string): boolean {
  if (qc.getQueryData(['meeting', meetingId]) !== undefined) return true;
  return qc.getQueriesData({ queryKey: ['meetings'] }).some(([, data]) => holds(data, meetingId));
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
  if ('meetingListsIfNew' in target) {
    if (meetingKnown(qc, target.meetingListsIfNew)) return () => false;
    return (q) => q.queryKey[0] === 'meetings';
  }
  if ('projectMeetingsOf' in target) {
    const projectId = meetingProjectOf(qc, target.projectMeetingsOf);
    if (projectId === null) return () => false;
    return (q) => q.queryKey[0] === 'project' && q.queryKey[2] === 'meetings' && q.queryKey.length === 3 && (!projectId || q.queryKey[1] === projectId);
  }
  return (q) => matchQuery({ queryKey: target.queryKey, exact: target.exact }, q);
}

/**
 * Refresh what the targets name, in one pass: each matching query is marked out of date once, and
 * the ones on screen are refetched once — two targets naming the same list never fetch it twice
 * (a second invalidation would cancel the first fetch and start another). A query only `later`
 * targets name is marked out of date and not fetched now; one any other target names is fetched.
 */
export function refresh(qc: QueryClient, targets: Refresh[]): void {
  if (targets.length === 0) return;
  const isLater = (t: Refresh) => 'queryKey' in t && t.later === true;
  const now = targets.filter((t) => !isLater(t)).map((t) => matcher(qc, t));
  const later = targets.filter(isLater).map((t) => matcher(qc, t));
  const all = qc.getQueryCache().getAll();
  const hits = new Set(all.filter((q) => now.some((test) => test(q))));
  const marks = new Set(all.filter((q) => !hits.has(q) && later.some((test) => test(q))));
  if (hits.size) void qc.invalidateQueries({ predicate: (q) => hits.has(q) });
  if (marks.size) void qc.invalidateQueries({ predicate: (q) => marks.has(q), refetchType: 'none' });
}
