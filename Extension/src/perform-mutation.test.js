import { describe, it, expect, vi } from 'vitest';
import { makePerformMutation, outcomeForStatus } from './queue.js';
import { jsonRes } from './test-helpers.js';

const res = (status, body = {}) => jsonRes(body, status);

describe('makePerformMutation', () => {
  it('replays a task.create as a POST /tasks with the queued payload and its Idempotency-Key', async () => {
    const doFetch = vi.fn(async () => res(201));
    const perform = makePerformMutation(doFetch);
    await perform({ kind: 'task.create', idempotencyKey: 'k1', payload: { title: 'Ship it', projectId: 'p1', columnId: 'c1', boardDate: '2026-09-26' } });
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [path, init] = doFetch.mock.calls[0];
    expect(path).toBe('/tasks');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Idempotency-Key': 'k1' });
    expect(JSON.parse(init.body)).toEqual({ title: 'Ship it', projectId: 'p1', columnId: 'c1', boardDate: '2026-09-26' });
  });

  it('marks a 4xx validation failure as "fail" (kept + shown, never retried blindly)', async () => {
    const perform = makePerformMutation(async () => res(400, { error: { code: 'VALIDATION', message: 'bad' } }));
    const err = await perform({ kind: 'task.create', payload: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.outcome).toBe('fail');
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION');
  });

  it('408 / 403 / 5xx are retried (counted); 401 / 429 pause', async () => {
    for (const status of [408, 403, 500, 503]) {
      const err = await makePerformMutation(async () => res(status))({ kind: 'task.create', payload: {} }).catch((e) => e);
      expect(err.outcome).toBe('retry');
    }
    for (const status of [401, 429]) {
      const err = await makePerformMutation(async () => res(status))({ kind: 'task.create', payload: {} }).catch((e) => e);
      expect(err.outcome).toBe('pause');
    }
  });

  it('outcomeForStatus: 409 pauses only while the first attempt is still in progress', () => {
    expect(outcomeForStatus(409, 'IDEMPOTENCY_IN_PROGRESS')).toBe('pause');
    expect(outcomeForStatus(409, 'VERSION_CONFLICT')).toBe('fail');
    expect(outcomeForStatus(404)).toBe('fail');
  });

  it('marks an unknown mutation kind as failed without calling the server', async () => {
    const doFetch = vi.fn(async () => res(200));
    const perform = makePerformMutation(doFetch);
    const err = await perform({ kind: 'nope', payload: {} }).catch((e) => e);
    expect(err.outcome).toBe('fail');
    expect(doFetch).not.toHaveBeenCalled();
  });
});
