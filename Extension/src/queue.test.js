import { describe, it, expect, vi } from 'vitest';
import { enqueue, getQueue, queueSize, flushQueue, clearQueue } from './queue.js';

function fakeStorage(init = {}) {
  let data = { ...init };
  return {
    async get(key) {
      return key in data ? { [key]: data[key] } : {};
    },
    async set(obj) {
      data = { ...data, ...obj };
    },
  };
}

describe('offline queue', () => {
  it('enqueues mutations with an id + timestamp and reports the size', async () => {
    const s = fakeStorage();
    const item = await enqueue(s, { kind: 'task.create', payload: { title: 'x' } });
    expect(item.id).toBeTruthy();
    expect(item.queuedAt).toBeGreaterThan(0);
    expect(item.kind).toBe('task.create');
    expect(await queueSize(s)).toBe(1);
  });

  it('flushes all mutations in FIFO order and empties the queue', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'a' });
    await enqueue(s, { kind: 'b' });
    const perform = vi.fn(async () => {});
    const res = await flushQueue(s, perform);
    expect(res).toEqual({ synced: 2, dropped: 0, remaining: 0 });
    expect(perform.mock.calls.map((c) => c[0].kind)).toEqual(['a', 'b']);
    expect(await queueSize(s)).toBe(0);
  });

  it('keeps mutations that fail transiently (retried later)', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'ok' });
    await enqueue(s, { kind: 'flaky' });
    const perform = vi.fn(async (item) => {
      if (item.kind === 'flaky') throw new Error('network down'); // transient
    });
    const res = await flushQueue(s, perform);
    expect(res.synced).toBe(1);
    expect(res.remaining).toBe(1);
    expect((await getQueue(s)).map((i) => i.kind)).toEqual(['flaky']);
  });

  it('drops mutations that fail permanently (e.permanent) so the queue never wedges', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'bad' });
    await enqueue(s, { kind: 'good' });
    const perform = vi.fn(async (item) => {
      if (item.kind === 'bad') {
        const e = new Error('422');
        e.permanent = true;
        throw e;
      }
    });
    const res = await flushQueue(s, perform);
    expect(res).toEqual({ synced: 1, dropped: 1, remaining: 0 });
  });

  it('clearQueue empties it', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'a' });
    await clearQueue(s);
    expect(await queueSize(s)).toBe(0);
  });
});
