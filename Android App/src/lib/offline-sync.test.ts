import { describe, it, expect, vi } from 'vitest';
import { createReadCache } from './read-cache';
import { createSyncQueue } from './sync-queue';
import { createSyncController } from './sync-controller';
import { performMutation } from './perform-mutation';
import { rebaseQueuedVersion } from './task-writes';
import { ApiError, NetworkError } from './api-client';
import type { ResourcesApi } from './resources';
import type { KeyValueStore } from './storage';

/** In-memory KeyValueStore (AsyncStorage-shaped) for the offline integration test. */
function fakeStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: async (k: string, v: string) => void m.set(k, v),
    deleteItem: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
  };
}

describe('offline read cache + write queue + reconnect sync (integration)', () => {
  it('serves reads from cache offline, queues offline writes, and replays them on reconnect', async () => {
    const store = fakeStore();
    const getUserId = () => 'u1';
    const cache = createReadCache({ store, getUserId });
    const update = vi.fn(async () => ({ id: 't1' }));
    const resources = { tasks: { update } } as unknown as ResourcesApi;
    const queue = createSyncQueue({ store, perform: (m) => performMutation(resources, m) });
    await queue.load();
    const controller = createSyncController({ queue, getUserId });

    // 1. Online read → fresh + cached.
    const online = await cache.read('tasks.mine', async () => [{ id: 't1', title: 'A' }]);
    expect(online.stale).toBe(false);

    // 2. Offline read (fetch fails with no response) → the last cached value, marked stale.
    const offline = await cache.read('tasks.mine', async () => {
      throw new NetworkError('offline');
    });
    expect(offline.stale).toBe(true);
    expect(offline.data).toEqual([{ id: 't1', title: 'A' }]);

    // 3. A write made offline (the hook's onError path) is queued with its owner, not lost.
    await queue.enqueue('task.update', { id: 't1', patch: { title: 'B' } }, { userId: 'u1' });
    expect(queue.pendingFor('u1')).toHaveLength(1);

    // 4. Reconnect → the controller flushes and replays the write to the API; the queue drains.
    const result = await controller.trigger();
    expect(result).toEqual({ synced: 1, failed: [], remaining: 0 });
    expect(update).toHaveBeenCalledWith('t1', { title: 'B' });
    expect(queue.pending()).toHaveLength(0);
  });

  /** A server that refuses an edit made against an old version, like PUT /tasks/:id. */
  function versionedServer(start: number) {
    let version = start;
    const write = () => ({ id: 't1', version: ++version });
    const tasks = {
      update: vi.fn(async (_id: string, patch: { expectedVersion?: number }) => {
        if (patch.expectedVersion !== undefined && patch.expectedVersion !== version) {
          throw new ApiError(409, 'VERSION_CONFLICT', 'This task was changed by someone else. Reload and try again.');
        }
        return write();
      }),
      move: vi.fn(async () => write()),
    };
    return { resources: { tasks } as unknown as ResourcesApi, tasks };
  }

  it('two edits and a move made offline to one task all sync — each follows the version the one before made', async () => {
    const store = fakeStore();
    const { resources, tasks } = versionedServer(5);
    const queue = createSyncQueue({ store, perform: (m) => performMutation(resources, m), rebase: rebaseQueuedVersion });
    await queue.load();
    // All three were made offline against version 5, the version the phone had loaded.
    await queue.enqueue('task.update', { id: 't1', patch: { priority: 'HIGH', expectedVersion: 5 } }, { userId: 'u1' });
    await queue.enqueue('task.move', { id: 't1', columnId: 'c2' }, { userId: 'u1' });
    await queue.enqueue('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 5 } }, { userId: 'u1' });
    const result = await queue.flush('u1');
    expect(result).toEqual({ synced: 3, failed: [], remaining: 0 });
    expect(tasks.update).toHaveBeenLastCalledWith('t1', { title: 'B', expectedVersion: 7 });
  });

  it('an edit made offline is still refused when someone else changed the task first', async () => {
    const store = fakeStore();
    const { resources } = versionedServer(6); // someone else made version 6 while this phone was offline
    const queue = createSyncQueue({ store, perform: (m) => performMutation(resources, m), rebase: rebaseQueuedVersion });
    await queue.load();
    await queue.enqueue('task.update', { id: 't1', patch: { priority: 'HIGH', expectedVersion: 5 } }, { userId: 'u1' });
    await queue.enqueue('task.update', { id: 't1', patch: { title: 'B', expectedVersion: 5 } }, { userId: 'u1' });
    const result = await queue.flush('u1');
    expect(result.synced).toBe(0);
    expect(queue.failedFor('u1')).toHaveLength(2);
  });

  it('keeps a permanently-rejected (4xx) queued write as a visible failed item instead of retrying forever', async () => {
    const store = fakeStore();
    const resources = {
      tasks: {
        update: vi.fn(async () => {
          throw new ApiError(400, 'BAD_REQUEST', 'rejected');
        }),
      },
    } as unknown as ResourcesApi;
    const queue = createSyncQueue({ store, perform: (m) => performMutation(resources, m) });
    await queue.load();
    await queue.enqueue('task.update', { id: 't1', patch: {} }, { userId: 'u1' });
    const result = await queue.flush('u1');
    expect(result.synced).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(queue.pendingFor('u1')).toHaveLength(0);
    expect(queue.failedFor('u1')).toHaveLength(1);
  });
});
