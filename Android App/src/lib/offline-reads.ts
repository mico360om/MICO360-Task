import type { QueryKey } from '@tanstack/react-query';
import type { ReadCache, ReadOptions } from './read-cache';
import type { QueuedMutation } from './sync-queue';
import type { ApiTask } from './types';

export interface OfflineReadsDeps {
  cache: Pick<ReadCache, 'read'>;
  /** The signed-in user's queued changes still waiting to be sent. */
  pendingChanges: () => readonly QueuedMutation[];
}

/**
 * A task list with the moves still waiting to be sent laid over it: each task a queued move names
 * is shown in the column it was moved to (the newest move of a task wins). Neither the server nor
 * the offline copy has these moves yet. Tasks no move names are left as they are, and the same list
 * comes back when nothing changes.
 */
export function withPendingMoves<T extends { id: string; columnId: string }>(tasks: T[], pending: readonly Pick<QueuedMutation, 'kind' | 'payload'>[]): T[] {
  const movedTo = new Map<string, string>();
  for (const m of pending) {
    if (m.kind !== 'task.move') continue;
    const p = (m.payload ?? {}) as { id?: unknown; columnId?: unknown };
    if (typeof p.id === 'string' && typeof p.columnId === 'string') movedTo.set(p.id, p.columnId);
  }
  if (movedTo.size === 0 || !Array.isArray(tasks)) return tasks;
  let changed = false;
  const next = tasks.map((t) => {
    const columnId = movedTo.get(t.id);
    if (columnId === undefined || columnId === t.columnId) return t;
    changed = true;
    return { ...t, columnId };
  });
  return changed ? next : tasks;
}

/**
 * The reads the app's lists make (core/queries): through the offline copy (read-cache), so a list
 * still shows without a connection.
 *
 * The board lays this user's moves still waiting to be sent over what it is given, the server's
 * answer or the offline copy (withPendingMoves). A card moved offline lives only in the query
 * cache until its move is replayed, so without this a refresh (coming back to the app, being back
 * online) would put it back in its old column although the move is still queued.
 */
export function createOfflineReads({ cache, pendingChanges }: OfflineReadsDeps) {
  /** A list, from the server or, with no answer, from the offline copy. */
  async function read<T>(_queryKey: QueryKey, key: string, fetcher: () => Promise<T>, opts?: ReadOptions<T>): Promise<T> {
    return (await cache.read(key, fetcher, opts)).data;
  }

  /** A project's tasks for the board, with the moves still waiting laid over them. */
  async function readBoard(queryKey: QueryKey, key: string, fetcher: () => Promise<ApiTask[]>, opts?: ReadOptions<ApiTask[]>): Promise<ApiTask[]> {
    const tasks = await read(queryKey, key, fetcher, opts);
    return withPendingMoves(tasks, pendingChanges());
  }

  return { read, readBoard };
}

export type OfflineReads = ReturnType<typeof createOfflineReads>;
