import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueueOffline, flushOfflineQueue, pendingCount } from './offline-replay';
import { clearQueue, localStorageQueueStore } from './offline-queue';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => clearQueue(localStorageQueueStore));
afterEach(() => vi.restoreAllMocks());

describe('offline-replay', () => {
  it('replays a queued task.create through the API and empties the queue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { id: 't1' } }, 201)));
    enqueueOffline('task.create', { title: 'X', projectId: 'p1', columnId: 'c1' });
    expect(pendingCount()).toBe(1);
    const res = await flushOfflineQueue();
    expect(res.synced).toBe(1);
    expect(pendingCount()).toBe(0);
  });

  it('drops a permanently-rejected (400) mutation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'VALIDATION', message: 'bad' } }, 400)));
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    const res = await flushOfflineQueue();
    expect(res.dropped).toBe(1);
    expect(pendingCount()).toBe(0);
  });

  it('keeps a transiently-failed (offline) mutation for a later retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down');
    }));
    enqueueOffline('task.move', { id: 't1', toColumnId: 'c2' });
    const res = await flushOfflineQueue();
    expect(res.remaining).toBe(1);
    expect(pendingCount()).toBe(1);
  });
});
