import { describe, it, expect, vi } from 'vitest';
import { createReadCache } from './read-cache';
import { createSyncQueue } from './sync-queue';
import { createSyncController } from './sync-controller';
import { performMutation } from './perform-mutation';
import { ApiError } from './api-client';
import type { ResourcesApi } from './resources';
import type { KeyValueStore } from './storage';

/** In-memory KeyValueStore (AsyncStorage-shaped) for the offline integration test. */
function fakeStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: async (k: string, v: string) => void m.set(k, v),
    deleteItem: async (k: string) => void m.delete(k),
  };
}

describe('offline read cache + write queue + reconnect sync (integration)', () => {
  it('serves reads from cache offline, queues offline writes, and replays them on reconnect', async () => {
    const store = fakeStore();
    const cache = createReadCache({ store });
    const update = vi.fn(async () => ({ id: 't1' }));
    const resources = { tasks: { update } } as unknown as ResourcesApi;
    const queue = createSyncQueue({ store, perform: (m) => performMutation(resources, m) });
    await queue.load();
    const controller = createSyncController({ queue });

    // 1. Online read → fresh + cached.
    const online = await cache.read('tasks.mine', async () => [{ id: 't1', title: 'A' }]);
    expect(online.stale).toBe(false);

    // 2. Offline read (fetch throws) → the last cached value, marked stale.
    const offline = await cache.read('tasks.mine', async () => { throw new Error('offline'); });
    expect(offline.stale).toBe(true);
    expect(offline.data).toEqual([{ id: 't1', title: 'A' }]);

    // 3. A write made offline (the hook's onError path) is queued, not lost.
    await queue.enqueue('task.update', { id: 't1', patch: { title: 'B' } });
    expect(queue.pending()).toHaveLength(1);

    // 4. Reconnect → the controller flushes and replays the write to the API; the queue drains.
    const result = await controller.trigger();
    expect(result).toEqual({ synced: 1, dropped: [], remaining: 0 });
    expect(update).toHaveBeenCalledWith('t1', { title: 'B' });
    expect(queue.pending()).toHaveLength(0);
  });

  it('drops a permanently-rejected (4xx) queued write instead of retrying forever', async () => {
    const store = fakeStore();
    const resources = {
      tasks: { update: vi.fn(async () => { throw new ApiError(400, 'BAD_REQUEST', 'rejected'); }) },
    } as unknown as ResourcesApi;
    const queue = createSyncQueue({ store, perform: (m) => performMutation(resources, m) });
    await queue.load();
    await queue.enqueue('task.update', { id: 't1', patch: {} });
    const result = await queue.flush();
    expect(result.synced).toBe(0);
    expect(result.dropped).toHaveLength(1);
    expect(queue.pending()).toHaveLength(0);
  });
});
