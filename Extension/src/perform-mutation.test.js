import { describe, it, expect, vi } from 'vitest';
import { makePerformMutation } from './queue.js';

const res = (status) => ({ ok: status >= 200 && status < 300, status });

describe('makePerformMutation', () => {
  it('replays a task.create as a POST /tasks with the queued payload', async () => {
    const doFetch = vi.fn(async () => res(201));
    const perform = makePerformMutation(doFetch);
    await perform({ kind: 'task.create', payload: { title: 'Ship it', projectId: 'p1', columnId: 'c1' } });
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [path, init] = doFetch.mock.calls[0];
    expect(path).toBe('/tasks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ title: 'Ship it', projectId: 'p1', columnId: 'c1' });
  });

  it('marks a 4xx failure permanent so the queue drops it', async () => {
    const perform = makePerformMutation(async () => res(400));
    const err = await perform({ kind: 'task.create', payload: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.permanent).toBe(true);
  });

  it('keeps 408 / 429 / 5xx as transient (retry later)', async () => {
    for (const status of [408, 429, 500, 503]) {
      const perform = makePerformMutation(async () => res(status));
      const err = await perform({ kind: 'task.create', payload: {} }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.permanent).not.toBe(true);
    }
  });

  it('drops an unknown mutation kind permanently', async () => {
    const doFetch = vi.fn(async () => res(200));
    const perform = makePerformMutation(doFetch);
    const err = await perform({ kind: 'nope', payload: {} }).catch((e) => e);
    expect(err.permanent).toBe(true);
    expect(doFetch).not.toHaveBeenCalled();
  });
});
