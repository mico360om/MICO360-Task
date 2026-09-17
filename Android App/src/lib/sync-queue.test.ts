import { describe, it, expect, vi } from 'vitest';
import { createSyncQueue, type QueuedMutation } from './sync-queue';
import { createMemoryStore } from './storage';

const opts = (overrides: Partial<Parameters<typeof createSyncQueue>[0]> = {}) => {
  let n = 0;
  return {
    store: createMemoryStore(),
    perform: vi.fn(async () => {}),
    now: () => 1000,
    genId: () => `m${++n}`,
    ...overrides,
  };
};

describe('createSyncQueue (offline mutation queue, A8)', () => {
  it('enqueues with an id + timestamp and persists to storage', async () => {
    const o = opts();
    const q = createSyncQueue(o);
    const m = await q.enqueue('task.move', { id: 't1', columnId: 'c2' });
    expect(m).toMatchObject({ id: 'm1', kind: 'task.move', payload: { id: 't1', columnId: 'c2' }, createdAt: 1000 });
    expect(q.pending()).toHaveLength(1);
    expect(await o.store.getItem('mico360.mutations')).toContain('task.move');
  });

  it('flushes all mutations in FIFO order and empties the queue', async () => {
    const o = opts();
    const q = createSyncQueue(o);
    await q.enqueue('a', 1);
    await q.enqueue('b', 2);
    const res = await q.flush();
    expect(res).toEqual({ synced: 2, dropped: [], remaining: 0 });
    expect((o.perform as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as QueuedMutation).kind)).toEqual(['a', 'b']);
    expect(q.pending()).toHaveLength(0);
  });

  it('stops on a transient failure, preserving the failed mutation and those after it', async () => {
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'b') throw new Error('network down');
    });
    const q = createSyncQueue(opts({ perform, shouldDrop: () => false }));
    await q.enqueue('a', 1);
    await q.enqueue('b', 2);
    await q.enqueue('c', 3);
    const res = await q.flush();
    expect(res).toEqual({ synced: 1, dropped: [], remaining: 2 });
    expect(q.pending().map((m) => m.kind)).toEqual(['b', 'c']); // order intact, retried next reconnect
  });

  it('drops a permanently-failing mutation and continues with the rest', async () => {
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'bad') throw new Error('422');
    });
    const q = createSyncQueue(opts({ perform, shouldDrop: () => true }));
    await q.enqueue('bad', 1);
    await q.enqueue('good', 2);
    const res = await q.flush();
    expect(res.synced).toBe(1);
    expect(res.dropped.map((m) => m.kind)).toEqual(['bad']);
    expect(res.remaining).toBe(0);
  });

  it('rehydrates a persisted queue on load', async () => {
    const store = createMemoryStore({
      'mico360.mutations': JSON.stringify([{ id: 'm9', kind: 'task.create', payload: {}, createdAt: 5 }]),
    });
    const q = createSyncQueue(opts({ store }));
    await q.load();
    expect(q.pending().map((m) => m.id)).toEqual(['m9']);
  });

  it('flush on an empty queue is a no-op', async () => {
    const o = opts();
    const q = createSyncQueue(o);
    const res = await q.flush();
    expect(res).toEqual({ synced: 0, dropped: [], remaining: 0 });
    expect(o.perform).not.toHaveBeenCalled();
  });
});
