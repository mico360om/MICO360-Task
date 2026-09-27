import { describe, it, expect, vi } from 'vitest';
import {
  enqueue,
  queueSize,
  flushQueue,
  clearQueue,
  failedItems,
  removeOwnerItems,
  removeOrphans,
  retryItem,
  MAX_ATTEMPTS,
  type QueueStore,
  type QueuedMutation,
} from './offline-queue';

function memStore(initial: QueuedMutation[] = []): QueueStore {
  let q = [...initial];
  return {
    read: () => [...q],
    write: (next) => {
      q = [...next];
    },
  };
}

describe('offline-queue', () => {
  it('enqueues mutations in order and reports the size', () => {
    const s = memStore();
    enqueue(s, { kind: 'task.create', payload: { title: 'A' } });
    enqueue(s, { kind: 'task.move', payload: { id: 't1', toColumnId: 'c2' } });
    expect(queueSize(s)).toBe(2);
    const [a, b] = s.read();
    expect(a!.kind).toBe('task.create');
    expect(b!.payload).toEqual({ id: 't1', toColumnId: 'c2' });
  });

  it('gives every item its owner and a stable, unique Idempotency-Key (or keeps the one supplied)', () => {
    const s = memStore();
    const a = enqueue(s, { kind: 'task.create', payload: {}, ownerId: 'u1' });
    const b = enqueue(s, { kind: 'task.create', payload: {}, ownerId: 'u1', idempotencyKey: 'from-online-try' });
    expect(a.ownerId).toBe('u1');
    expect(a.idempotencyKey).toBeTruthy();
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(b.idempotencyKey).toBe('from-online-try');
    // stored as-is, so every replay re-sends the same key
    expect(s.read()[0]!.idempotencyKey).toBe(a.idempotencyKey);
  });

  it('flushes all items when perform succeeds and empties the queue', async () => {
    const s = memStore();
    enqueue(s, { kind: 'task.create', payload: { title: 'A' } });
    enqueue(s, { kind: 'task.create', payload: { title: 'B' } });
    const perform = vi.fn(async () => {});
    const res = await flushQueue(s, perform);
    expect(res).toEqual({ synced: 2, failed: 0, remaining: 0 });
    expect(queueSize(s)).toBe(0);
  });

  it('replays only the given owner’s items', async () => {
    const s = memStore();
    enqueue(s, { kind: 'a', payload: 1, ownerId: 'alice' });
    enqueue(s, { kind: 'b', payload: 2, ownerId: 'bob' });
    const perform = vi.fn(async (_m: QueuedMutation) => {});
    await flushQueue(s, perform, { ownerId: 'bob' });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(perform.mock.calls[0]![0].kind).toBe('b');
    expect(s.read().map((m) => m.ownerId)).toEqual(['alice']);
  });

  it('marks a permanently-rejected item failed (kept for review) and carries on with the rest', async () => {
    const s = memStore();
    enqueue(s, { kind: 'a', payload: 1 }); // hard-fail (4xx)
    enqueue(s, { kind: 'b', payload: 2 }); // fine
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'a') throw Object.assign(new Error('bad request'), { permanent: true });
    });
    const res = await flushQueue(s, perform);
    expect(res).toEqual({ synced: 1, failed: 1, remaining: 0 });
    const failed = failedItems(s);
    expect(failed.map((m) => m.kind)).toEqual(['a']);
    expect(failed[0]!.lastError).toBe('bad request');
  });

  it('pauses on an offline error: stops the flush, keeps everything, counts no attempt', async () => {
    const s = memStore();
    enqueue(s, { kind: 'a', payload: 1 });
    enqueue(s, { kind: 'b', payload: 2 });
    const perform = vi.fn(async () => {
      throw Object.assign(new Error('offline'), { pause: true });
    });
    const res = await flushQueue(s, perform);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ synced: 0, failed: 0, remaining: 2 });
    expect(s.read()[0]!.attempts).toBe(0);
  });

  it('caps retries on repeated server errors, then marks the item failed', async () => {
    const s = memStore();
    enqueue(s, { kind: 'a', payload: 1 });
    const perform = vi.fn(async () => {
      throw new Error('500');
    });
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const r = await flushQueue(s, perform);
      expect(r.failed).toBe(0);
      expect(r.remaining).toBe(1);
    }
    const last = await flushQueue(s, perform);
    expect(last).toEqual({ synced: 0, failed: 1, remaining: 0 });
    expect(failedItems(s)).toHaveLength(1);
    // a failed item isn't replayed again until the user retries it
    await flushQueue(s, perform);
    expect(perform).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    retryItem(s, s.read()[0]!.id);
    expect(queueSize(s)).toBe(1);
  });

  it('removes items by id, so a change queued during a flush is not lost', async () => {
    const s = memStore();
    enqueue(s, { kind: 'a', payload: 1 });
    const perform = vi.fn(async () => {
      enqueue(s, { kind: 'late', payload: 2 }); // queued while the flush is running
    });
    await flushQueue(s, perform);
    expect(s.read().map((m) => m.kind)).toEqual(['late']);
  });

  it('removes one user’s items on sign-out and drops ownerless legacy items', () => {
    const s = memStore([
      { id: 'x', kind: 'legacy', payload: null, queuedAt: 0 },
    ]);
    enqueue(s, { kind: 'a', payload: 1, ownerId: 'alice' });
    enqueue(s, { kind: 'b', payload: 2, ownerId: 'bob' });
    removeOwnerItems(s, 'alice');
    expect(s.read().map((m) => m.kind)).toEqual(['legacy', 'b']);
    expect(removeOrphans(s)).toBe(1);
    expect(s.read().map((m) => m.kind)).toEqual(['b']);
  });

  it('clears the queue', () => {
    const s = memStore();
    enqueue(s, { kind: 'x', payload: null });
    clearQueue(s);
    expect(queueSize(s)).toBe(0);
  });
});
