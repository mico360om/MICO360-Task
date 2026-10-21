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

  it('L21: a 403 (no permission) is marked failed at once, as on the web — not retried five times', async () => {
    const err = await makePerformMutation(async () => res(403, { error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } }))({ kind: 'task.update', payload: { id: 't1', patch: {} } }).catch((e) => e);
    expect(err.outcome).toBe('fail');
    expect(err.message).toBe('You do not have permission to do that.');
    expect(outcomeForStatus(403)).toBe('fail');
  });

  it('408 / 5xx are retried (counted); 401 / 429 pause', async () => {
    for (const status of [408, 500, 503]) {
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

  it('H1: resolves with the server’s task for an edit or a move, and hands it on to be kept', async () => {
    const onTask = vi.fn();
    const perform = makePerformMutation(async () => res(200, { data: { id: 't1', version: 8 } }), { onTask });
    expect(await perform({ kind: 'task.update', payload: { id: 't1', patch: { title: 'B' }, expectedVersion: 7 } })).toEqual({ id: 't1', version: 8 });
    expect(await perform({ kind: 'task.move', payload: { id: 't1', columnId: 'c2', position: 0 } })).toEqual({ id: 't1', version: 8 });
    expect(onTask).toHaveBeenCalledTimes(2);
    expect(onTask).toHaveBeenLastCalledWith({ id: 't1', version: 8 });
  });

  it('M6: a 2xx that is not the server’s JSON (a Wi-Fi sign-in page) is not taken as synced', async () => {
    const portal = { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) }, json: async () => { throw new SyntaxError('<'); } };
    const err = await makePerformMutation(async () => portal)({ kind: 'comment.add', payload: { id: 't1', body: 'hi' } }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.outcome).toBe('pause');
  });

  describe('H1: a replayed edit refused because the task changed (VERSION_CONFLICT)', () => {
    const conflict = res(409, { error: { code: 'VERSION_CONFLICT', message: 'This task was changed by someone else. Reload and try again.' } });
    const edit = { kind: 'task.update', payload: { id: 't1', patch: { title: 'B', dueDate: '2026-10-13' }, expectedVersion: 5 } };

    it('reloads the task; when it already holds the edited values the change counts as done', async () => {
      const onTask = vi.fn();
      const doFetch = vi.fn(async (path, init) => (init.method === 'PUT' ? conflict : res(200, { data: { id: 't1', title: 'B', dueDate: '2026-10-13T00:00:00.000Z', version: 7 } })));
      const out = await makePerformMutation(doFetch, { onTask })(edit);
      expect(doFetch.mock.calls[1]).toEqual(['/tasks/t1', { method: 'GET' }]);
      expect(out).toMatchObject({ id: 't1', version: 7 });
      expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ version: 7 }));
    });

    it('otherwise the stale edit is dropped: marked failed with a plain message, the reloaded task kept', async () => {
      const onTask = vi.fn();
      const doFetch = vi.fn(async (path, init) => (init.method === 'PUT' ? conflict : res(200, { data: { id: 't1', title: 'Someone else’s', version: 7 } })));
      const err = await makePerformMutation(doFetch, { onTask })(edit).catch((e) => e);
      expect(err.outcome).toBe('fail');
      expect(err.status).toBe(409);
      expect(err.code).toBe('VERSION_CONFLICT');
      expect(err.message).toMatch(/^Someone else changed this task/);
      expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Someone else’s' }));
    });

    it('is still marked failed when the task is gone or no longer yours to see (404 / 403)', async () => {
      for (const status of [404, 403]) {
        const doFetch = vi.fn(async (path, init) => (init.method === 'PUT' ? conflict : res(status, { error: { code: 'NOT_FOUND', message: 'Task not found.' } })));
        const err = await makePerformMutation(doFetch)(edit).catch((e) => e);
        expect(err.outcome).toBe('fail');
        expect(err.code).toBe('VERSION_CONFLICT');
      }
    });

    it('a reload that gets no usable answer waits to try again — it is not shown as someone else’s change', async () => {
      const timeout = Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
      const portal = { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) }, json: async () => { throw new SyntaxError('<'); } };
      const reloads = [
        [() => { throw new TypeError('Failed to fetch'); }, 'pause'],
        [() => { throw timeout; }, 'retry'],
        [() => res(503), 'retry'],
        [() => res(401, { error: { code: 'UNAUTHENTICATED' } }), 'pause'],
        [() => portal, 'pause'],
      ];
      for (const [reload, outcome] of reloads) {
        const onTask = vi.fn();
        const doFetch = vi.fn(async (path, init) => (init.method === 'PUT' ? conflict : reload()));
        const err = await makePerformMutation(doFetch, { onTask })(edit).catch((e) => e);
        expect(err.outcome).toBe(outcome);
        expect(err.message).not.toMatch(/^Someone else changed this task/);
        expect(onTask).not.toHaveBeenCalled();
      }
    });
  });
});
