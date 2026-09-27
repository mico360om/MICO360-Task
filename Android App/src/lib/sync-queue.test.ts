import { describe, it, expect, vi } from 'vitest';
import { createSyncQueue, classifyReplayError, type QueuedMutation } from './sync-queue';
import { createMemoryStore } from './storage';
import { ApiError, NetworkError } from './api-client';

const opts = (overrides: Partial<Parameters<typeof createSyncQueue>[0]> = {}) => {
  let n = 0;
  let k = 0;
  return {
    store: createMemoryStore(),
    perform: vi.fn(async (_m: QueuedMutation) => {}),
    now: () => 1000,
    genId: () => `m${++n}`,
    genKey: () => `key-${++k}`,
    ...overrides,
  };
};

const A = { userId: 'userA' };
const B = { userId: 'userB' };

describe('createSyncQueue (offline mutation queue, A8 / XP-02 / XP-06)', () => {
  it('enqueues with id, owner, idempotency key and timestamp, and persists to storage', async () => {
    const o = opts();
    const q = createSyncQueue(o);
    const m = await q.enqueue('task.move', { id: 't1', columnId: 'c2' }, A);
    expect(m).toMatchObject({
      id: 'm1',
      kind: 'task.move',
      payload: { id: 't1', columnId: 'c2' },
      createdAt: 1000,
      userId: 'userA',
      idempotencyKey: 'key-1',
      attempts: 0,
      status: 'pending',
    });
    expect(q.pendingFor('userA')).toHaveLength(1);
    const stored = await o.store.getItem('mico360.mutations');
    expect(stored).toContain('task.move');
    expect(stored).toContain('userA');
  });

  it('keeps the idempotency key of the online attempt that failed', async () => {
    const q = createSyncQueue(opts());
    const m = await q.enqueue('comment.add', { id: 't1', body: 'hi' }, { userId: 'userA', idempotencyKey: 'from-online-try' });
    expect(m.idempotencyKey).toBe('from-online-try');
  });

  it('refuses an ownerless change', async () => {
    const q = createSyncQueue(opts());
    await expect(q.enqueue('a', 1, { userId: '' })).rejects.toThrow(/owner/);
  });

  it('flushes the owner’s mutations in FIFO order and empties their part of the queue', async () => {
    const perform = vi.fn(async (_m: QueuedMutation) => {});
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('a', 1, A);
    await q.enqueue('b', 2, A);
    const res = await q.flush('userA');
    expect(res).toEqual({ synced: 2, failed: [], remaining: 0 });
    expect(perform.mock.calls.map((c) => c[0].kind)).toEqual(['a', 'b']);
    expect(q.pending()).toHaveLength(0);
  });

  it('never replays another user’s queued changes (shared phone)', async () => {
    const perform = vi.fn(async (_m: QueuedMutation) => {});
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('comment.add', { body: 'from A' }, A);
    await q.enqueue('comment.add', { body: 'from B' }, B);
    const res = await q.flush('userB');
    expect(res.synced).toBe(1);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(perform.mock.calls[0]![0].payload).toEqual({ body: 'from B' });
    // A's change is still waiting for A.
    expect(q.pendingFor('userA').map((m) => m.payload)).toEqual([{ body: 'from A' }]);
  });

  it('pauses on a network failure without counting an attempt (order intact)', async () => {
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'b') throw new NetworkError('offline');
    });
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('a', 1, A);
    await q.enqueue('b', 2, A);
    await q.enqueue('c', 3, A);
    const res = await q.flush('userA');
    expect(res).toEqual({ synced: 1, failed: [], remaining: 2, pausedBy: 'offline' });
    expect(q.pending().map((m) => [m.kind, m.attempts])).toEqual([
      ['b', 0],
      ['c', 0],
    ]);
  });

  it('pauses (never drops) on a 401 — the change waits for the owner to sign back in', async () => {
    const perform = vi.fn(async () => {
      throw new ApiError(401, 'UNAUTHORIZED', 'expired');
    });
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('comment.add', { body: 'keep me' }, A);
    const res = await q.flush('userA');
    expect(res.pausedBy).toBe('unauthorized');
    expect(q.pendingFor('userA')).toHaveLength(1);
    expect(q.failedFor('userA')).toHaveLength(0);
  });

  it('marks a permanently rejected change as failed (visible) and continues with the rest', async () => {
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'bad') throw new ApiError(422, 'VALIDATION', 'Title too long');
    });
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('bad', 1, A);
    await q.enqueue('good', 2, A);
    const res = await q.flush('userA');
    expect(res.synced).toBe(1);
    expect(res.failed.map((m) => m.kind)).toEqual(['bad']);
    expect(res.remaining).toBe(0);
    expect(q.failedFor('userA')).toEqual([expect.objectContaining({ kind: 'bad', status: 'failed', lastError: 'Title too long' })]);
  });

  it('caps retries for an item that keeps getting a 5xx so it cannot block the queue', async () => {
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'poison') throw new ApiError(500, 'INTERNAL', 'boom');
    });
    const q = createSyncQueue(opts({ perform, maxAttempts: 3 }));
    await q.enqueue('poison', 1, A);
    await q.enqueue('next', 2, A);

    expect((await q.flush('userA')).pausedBy).toBe('server'); // attempt 1
    expect((await q.flush('userA')).pausedBy).toBe('server'); // attempt 2
    const third = await q.flush('userA'); // attempt 3 → failed, then "next" goes through
    expect(third.failed.map((m) => m.kind)).toEqual(['poison']);
    expect(third.synced).toBe(1);
    expect(q.failedFor('userA')[0]).toMatchObject({ kind: 'poison', attempts: 3 });
    expect(q.pendingFor('userA')).toHaveLength(0);
  });

  it('retry() puts a failed item back in line; discard() removes it', async () => {
    let fail = true;
    const perform = vi.fn(async () => {
      if (fail) throw new ApiError(403, 'FORBIDDEN', 'no');
    });
    const q = createSyncQueue(opts({ perform }));
    const m = await q.enqueue('a', 1, A);
    await q.flush('userA');
    expect(q.failedFor('userA')).toHaveLength(1);

    fail = false;
    await q.retry(m.id);
    expect(q.pendingFor('userA')).toHaveLength(1);
    expect((await q.flush('userA')).synced).toBe(1);

    const m2 = await q.enqueue('b', 2, A);
    fail = true;
    await q.flush('userA');
    await q.discard(m2.id);
    expect(q.pending()).toHaveLength(0);
  });

  it('removes items by id, so a change enqueued during a flush is not lost', async () => {
    const ref: { q?: ReturnType<typeof createSyncQueue> } = {};
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'first') await ref.q!.enqueue('added-mid-flush', 9, A);
    });
    const q = createSyncQueue(opts({ perform }));
    ref.q = q;
    await q.enqueue('first', 1, A);
    const res = await q.flush('userA');
    expect(res.synced).toBe(2);
    expect(perform.mock.calls.map((c) => c[0].kind)).toEqual(['first', 'added-mid-flush']);
  });

  it('stops when the signed-in user changes mid-flush', async () => {
    let current = 'userA';
    const perform = vi.fn(async () => {
      current = 'nobody';
    });
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('a', 1, A);
    await q.enqueue('b', 2, A);
    const res = await q.flush('userA', { shouldContinue: () => current === 'userA' });
    expect(res).toMatchObject({ synced: 1, pausedBy: 'user-changed', remaining: 1 });
  });

  it('clearForUser removes only that user’s items; clear removes all', async () => {
    const q = createSyncQueue(opts());
    await q.enqueue('a', 1, A);
    await q.enqueue('b', 2, B);
    await q.clearForUser('userA');
    expect(q.pending().map((m) => m.userId)).toEqual(['userB']);
    await q.clear();
    expect(q.pending()).toEqual([]);
  });

  it('rehydrates a persisted queue on load and discards ownerless items from older builds', async () => {
    const store = createMemoryStore({
      'mico360.mutations': JSON.stringify([
        { id: 'legacy', kind: 'task.create', payload: {}, createdAt: 5 },
        { id: 'm9', kind: 'task.create', payload: {}, createdAt: 6, userId: 'userA', idempotencyKey: 'k9', attempts: 1, status: 'pending' },
      ]),
    });
    const q = createSyncQueue(opts({ store }));
    await q.load();
    expect(q.pending().map((m) => m.id)).toEqual(['m9']);
    expect(q.pending()[0]!.idempotencyKey).toBe('k9');
    expect(await store.getItem('mico360.mutations')).not.toContain('legacy');
  });

  it('notifies subscribers and exposes a stable snapshot between changes', async () => {
    const q = createSyncQueue(opts());
    const listener = vi.fn();
    q.subscribe(listener);
    const before = q.snapshot();
    expect(q.snapshot()).toBe(before);
    await q.enqueue('a', 1, A);
    expect(listener).toHaveBeenCalled();
    expect(q.snapshot()).not.toBe(before);
  });

  it('flush on an empty queue is a no-op', async () => {
    const o = opts();
    const q = createSyncQueue(o);
    const res = await q.flush('userA');
    expect(res).toEqual({ synced: 0, failed: [], remaining: 0 });
    expect(o.perform).not.toHaveBeenCalled();
  });
});

describe('classifyReplayError', () => {
  it('maps failures to pause / retry / fail', () => {
    expect(classifyReplayError(new NetworkError('offline'))).toBe('offline');
    expect(classifyReplayError(new ApiError(401, 'UNAUTHORIZED', ''))).toBe('unauthorized');
    expect(classifyReplayError(new ApiError(429, 'RATE_LIMITED', ''))).toBe('transient');
    expect(classifyReplayError(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', ''))).toBe('transient');
    expect(classifyReplayError(new ApiError(409, 'CONFLICT', ''))).toBe('permanent');
    expect(classifyReplayError(new ApiError(503, 'UNAVAILABLE', ''))).toBe('transient');
    expect(classifyReplayError(new ApiError(404, 'NOT_FOUND', ''))).toBe('permanent');
    expect(classifyReplayError(new Error('???'))).toBe('transient');
  });
});
