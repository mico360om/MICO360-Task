import { describe, it, expect, vi } from 'vitest';
import { enqueue, queueSize, flushQueue, clearQueue, type QueueStore, type QueuedMutation } from './offline-queue';

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

  it('flushes all items when perform succeeds and empties the queue', async () => {
    const s = memStore();
    enqueue(s, { kind: 'task.create', payload: { title: 'A' } });
    enqueue(s, { kind: 'task.create', payload: { title: 'B' } });
    const perform = vi.fn(async () => {});
    const res = await flushQueue(s, perform);
    expect(res).toEqual({ synced: 2, dropped: 0, remaining: 0 });
    expect(queueSize(s)).toBe(0);
  });

  it('drops a permanently-failing item but keeps a transiently-failing one', async () => {
    const s = memStore();
    enqueue(s, { kind: 'a', payload: 1 }); // will hard-fail (4xx) → dropped
    enqueue(s, { kind: 'b', payload: 2 }); // will soft-fail (offline) → kept
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'a') throw Object.assign(new Error('bad request'), { permanent: true });
      throw new Error('network down');
    });
    const res = await flushQueue(s, perform);
    expect(res).toEqual({ synced: 0, dropped: 1, remaining: 1 });
    expect(s.read().map((m) => m.kind)).toEqual(['b']);
  });

  it('clears the queue', () => {
    const s = memStore();
    enqueue(s, { kind: 'x', payload: null });
    clearQueue(s);
    expect(queueSize(s)).toBe(0);
  });
});
