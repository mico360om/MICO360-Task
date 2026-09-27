import type { ApiTask } from './types';

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
 * Query keys to refresh when a task event arrives (MOB-04). Realtime payloads are partial and the
 * board caches one list per board date, so events invalidate (refetch) instead of writing the
 * payload into one cache entry: every board date of the project, the task's own detail, "My
 * tasks" and the project progress figures.
 */
export function taskEventInvalidationKeys(projectId: string, payload?: { id?: unknown } | null): string[][] {
  const keys: string[][] = [
    ['tasks', 'project', projectId],
    ['tasks', 'mine'],
    ['project', projectId, 'progress'],
  ];
  if (typeof payload?.id === 'string' && payload.id) keys.push(['task', payload.id]);
  return keys;
}

/** Task events the board listens to. */
export const TASK_EVENTS = ['task:created', 'task:updated', 'task:moved', 'task:deleted'] as const;

/** Sent to a user's own room when they are removed from a project. */
export const PROJECT_REMOVED_EVENT = 'project:removed';

/** Is this `project:removed` payload about the given project? */
export function isProjectRemoval(payload: unknown, projectId: string): boolean {
  return !!projectId && typeof (payload as { projectId?: unknown } | null)?.projectId === 'string' && (payload as { projectId: string }).projectId === projectId;
}
