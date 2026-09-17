import { apiClient } from '../api/client';
import { tasksApi, type NewTaskInput } from '../api/tasks';
import { ApiError } from './api-client';
import { enqueue, flushQueue, localStorageQueueStore, queueSize, type QueuedMutation } from './offline-queue';

/** A 4xx (other than 408/429) can never succeed on replay — mark it permanent so it's dropped. */
function isPermanent(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}

/** Replay one queued task mutation through the API. Rethrows with `.permanent` on a hard failure. */
async function replayMutation(m: QueuedMutation): Promise<void> {
  try {
    if (m.kind === 'task.create') {
      await tasksApi(apiClient).create(m.payload as NewTaskInput);
      return;
    }
    if (m.kind === 'task.move') {
      const p = m.payload as { id: string; toColumnId: string };
      await tasksApi(apiClient).move(p.id, p.toColumnId);
      return;
    }
    throw Object.assign(new Error(`unknown mutation ${m.kind}`), { permanent: true });
  } catch (e) {
    if (isPermanent(e)) throw Object.assign(new Error('permanent'), { permanent: true });
    throw e; // transient (still offline) — keep for the next retry
  }
}

/** Queue a task mutation to replay when the connection returns. */
export function enqueueOffline(kind: 'task.create' | 'task.move', payload: unknown): void {
  enqueue(localStorageQueueStore, { kind, payload });
}

/** Replay everything queued, in order. Returns { synced, dropped, remaining }. */
export function flushOfflineQueue() {
  return flushQueue(localStorageQueueStore, replayMutation);
}

/** How many mutations are waiting to sync. */
export function pendingCount(): number {
  return queueSize(localStorageQueueStore);
}
