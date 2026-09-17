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
