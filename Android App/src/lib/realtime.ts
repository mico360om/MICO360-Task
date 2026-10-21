import type { ApiTask } from './types';
import type { KeyRefresh, Refresh } from './refresh';
import { ApiError, isNetworkError } from './api-client';
import { MY_ACTION_ITEMS } from './task-cache';

/** Realtime task events broadcast by the API over socket.io (mirrors the server's event names). */
export type TaskEvent =
  | { type: 'task:created'; payload: ApiTask }
  | { type: 'task:updated'; payload: ApiTask }
  | { type: 'task:moved'; payload: ApiTask }
  | { type: 'task:deleted'; payload: { id: string } };

function upsert(tasks: ApiTask[], task: ApiTask): ApiTask[] {
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx === -1) return [...tasks, task];
  const next = tasks.slice();
  next[idx] = task;
  return next;
}

/**
 * Fold a realtime task event into the current task list (A2). Create/update/move
 * are upserts (idempotent under duplicated or out-of-order events); delete removes
 * the task. An unrecognized event returns the same array reference untouched.
 */
export function applyTaskEvent(tasks: ApiTask[], event: TaskEvent): ApiTask[] {
  switch (event.type) {
    case 'task:created':
    case 'task:updated':
    case 'task:moved':
      return upsert(tasks, event.payload);
    case 'task:deleted':
      return tasks.filter((t) => t.id !== event.payload.id);
    default:
      return tasks;
  }
}

/**
 * What to refresh when a task event arrives (MOB-04). Realtime payloads are partial and the board
 * caches one list per board date, so events refresh (refetch) instead of writing the payload into
 * one cache entry: the project's board days (only the one on screen is fetched) and progress, the
 * other lists holding the task (My tasks when it's yours), and the task's own details and
 * activity — never its other parts, which have their own events (taskPartRefreshes). A new task
 * may be yours, so it refreshes My tasks too (being assigned later arrives as `task:assignees`).
 * Any other change refreshes My Action Items: a meeting's action item follows its task into Done
 * and out of it, and loses its task when the task is deleted. Events are gathered and applied
 * together (refresh-batch).
 */
export function taskEventRefreshes(event: string, projectId: string, payload?: unknown): Refresh[] {
  const raw = (payload as { id?: unknown } | null | undefined)?.id;
  const id = typeof raw === 'string' && raw ? raw : null;
  const targets: Refresh[] = [{ queryKey: ['tasks', 'project', projectId] }, { queryKey: ['project', projectId, 'progress'], exact: true }];
  if (!id || event === 'task:created') targets.push({ queryKey: ['tasks', 'mine'] });
  if (id) {
    targets.push({ listsHolding: id }, { queryKey: ['task', id], exact: true });
    if (event !== 'task:deleted') targets.push({ queryKey: ['task', id, 'activity'], exact: true });
  }
  if (event !== 'task:created') targets.push(MY_ACTION_ITEMS);
  return targets;
}

/** After the board's socket reconnects (events may have been missed): the board, My tasks, progress, columns and My Action Items. */
export function boardRefreshes(projectId: string): Refresh[] {
  return [
    { queryKey: ['tasks', 'project', projectId] },
    { queryKey: ['project', projectId, 'progress'], exact: true },
    { queryKey: ['tasks', 'mine'] },
    { queryKey: ['columns', projectId] },
    MY_ACTION_ITEMS,
  ];
}

/** Task events the board listens to. */
export const TASK_EVENTS = ['task:created', 'task:updated', 'task:moved', 'task:deleted'] as const;

/**
 * Changes to one part of a task, sent to its project's room with the task's id (`taskId`): its
 * people, tags, followers, checklist and comments. None of them changes a board card.
 */
export const TASK_PART_EVENTS = [
  'task:assignees',
  'task:tagged',
  'task:watchers',
  'checklist:changed',
  'comment:created',
  'comment:updated',
  'comment:deleted',
] as const;

/** One query to refresh: `exact` keeps a task's key from refreshing every query under it. */
export type RefreshTarget = KeyRefresh;

/**
 * What to refresh for a task part event — that part of that task only, never the task's other
 * parts or the board's lists. New assignees reload "My tasks" only when the signed-in person
 * joined or left them (`inMyTasks`: whether the task is in their list now).
 */
export function taskPartRefreshes(
  event: string,
  payload: unknown,
  ctx: { myId?: string | null; inMyTasks?: boolean } = {},
): RefreshTarget[] {
  const taskId = (payload as { taskId?: unknown } | null)?.taskId;
  if (typeof taskId !== 'string' || !taskId) return [];
  const part = (name?: string): RefreshTarget => ({ queryKey: name ? ['task', taskId, name] : ['task', taskId], exact: true });
  switch (event) {
    case 'task:assignees': {
      const targets = [part('assignees'), part('activity')];
      const people = (payload as { assignees?: unknown }).assignees;
      const assignedNow = Array.isArray(people) && people.some((p) => (p as { id?: unknown } | null)?.id === ctx.myId);
      if (ctx.myId && assignedNow !== !!ctx.inMyTasks) targets.push({ queryKey: ['tasks', 'mine'] });
      return targets;
    }
    case 'task:tagged':
      return [part('tags')];
    case 'task:watchers':
      return [part('watchers'), part('watch')];
    case 'checklist:changed':
      // The task's progress follows its checklist.
      return [part('checklist'), part(), part('activity')];
    case 'comment:created':
      return [part('comments'), part('activity')];
    case 'comment:updated':
    case 'comment:deleted':
      return [part('comments')];
    default:
      return [];
  }
}

/** Sent to a user's own room when they are removed from a project. */
export const PROJECT_REMOVED_EVENT = 'project:removed';

/** Is this `project:removed` payload about the given project? */
export function isProjectRemoval(payload: unknown, projectId: string): boolean {
  return !!projectId && typeof (payload as { projectId?: unknown } | null)?.projectId === 'string' && (payload as { projectId: string }).projectId === projectId;
}

/**
 * After `project:removed` (5b review): the server sends it to anyone taken off the team, but an
 * administrator still sees every project. So the project is read again: 'gone' when it can't be
 * opened any more (404/403 — leave it), 'still-allowed' when it can (stay, and listen again),
 * 'unknown' when there is no answer (stay on what is shown).
 */
export async function afterRemoval(getProject: () => Promise<unknown>): Promise<'gone' | 'still-allowed' | 'unknown'> {
  try {
    await getProject();
    return 'still-allowed';
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return 'gone';
    if (isNetworkError(e)) return 'unknown';
    return 'unknown';
  }
}

/**
 * The projects a screen has listened to while it is open (5b review): a screen that stops
 * listening while something is opened over it (a task) has missed what happened meanwhile, so the
 * first connection when it is back refreshes it, as a reconnect does. The very first one doesn't.
 */
export function createJoinMemory() {
  const seen = new Set<string>();
  return {
    returning(projectId: string): boolean {
      if (seen.has(projectId)) return true;
      seen.add(projectId);
      return false;
    },
  };
}
