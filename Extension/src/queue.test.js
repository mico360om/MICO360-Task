import { describe, it, expect, vi } from 'vitest';
import {
  enqueue, getQueue, queueSize, queueStats, flushQueue, clearQueue, removeQueued, retryQueued,
  assignOwnerlessItems, makePerformMutation, sendOrQueue, MAX_ATTEMPTS,
} from './queue.js';
import { ApiError, QueueError } from './errors.js';
import { fakeStorage, jsonRes } from './test-helpers.js';

const A = 'user-a';
const B = 'user-b';

function httpError(status, code) {
  return makePerformMutation(async () => jsonRes({ error: { code, message: 'nope' } }, status));
}

describe('offline queue', () => {
  it('enqueues with an id, owner, idempotency key and timestamp, and reports the size per user', async () => {
    const s = fakeStorage();
    const item = await enqueue(s, { kind: 'task.create', payload: { title: 'x' }, userId: A });
    expect(item.id).toBeTruthy();
    expect(item.userId).toBe(A);
    expect(item.idempotencyKey).toMatch(/\S{8,}/);
    expect(item.status).toBe('pending');
    expect(item.queuedAt).toBeGreaterThan(0);
    expect(await queueSize(s, A)).toBe(1);
    expect(await queueSize(s, B)).toBe(0);
  });

  it('XP-02: refuses an item without an owner', async () => {
    await expect(enqueue(fakeStorage(), { kind: 'task.create', payload: {} })).rejects.toBeInstanceOf(QueueError);
  });

  it('keeps the idempotency key it was given (the one sent on the first attempt)', async () => {
    const s = fakeStorage();
    const item = await enqueue(s, { kind: 'chat.send', payload: {}, userId: A, idempotencyKey: 'k-1' });
    expect(item.idempotencyKey).toBe('k-1');
  });

  it('XP-06: parallel enqueues never overwrite each other', async () => {
    const s = fakeStorage();
    await Promise.all(Array.from({ length: 20 }, (_, i) => enqueue(s, { kind: 'comment.add', payload: { i }, userId: A })));
    expect(await queueSize(s, A)).toBe(20);
  });

  it('flushes the user’s mutations in FIFO order and empties the queue', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'a', userId: A });
    await enqueue(s, { kind: 'b', userId: A });
    const perform = vi.fn(async () => {});
    const res = await flushQueue(s, perform, { userId: A });
    expect(res).toMatchObject({ synced: 2, failed: 0, remaining: 0, paused: false, skipped: false });
    expect(perform.mock.calls.map((c) => c[0].kind)).toEqual(['a', 'b']);
    expect(await getQueue(s)).toEqual([]);
  });

  it('XP-02: replays only the signed-in user’s items; another user’s stay untouched', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'comment.add', payload: { body: 'from A' }, userId: A });
    await enqueue(s, { kind: 'comment.add', payload: { body: 'from B' }, userId: B });
    const perform = vi.fn(async () => {});
    await flushQueue(s, perform, { userId: B });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(perform.mock.calls[0][0].payload.body).toBe('from B');
    expect((await getQueue(s)).map((i) => i.userId)).toEqual([A]);
  });

  it('does nothing when nobody is signed in', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'a', userId: A });
    const perform = vi.fn();
    await flushQueue(s, perform, { userId: null });
    expect(perform).not.toHaveBeenCalled();
    expect(await queueSize(s, A)).toBe(1);
  });

  it('pauses on a network failure: item kept, no attempt counted, later items wait', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'ok', userId: A });
    await enqueue(s, { kind: 'flaky', userId: A });
    await enqueue(s, { kind: 'after', userId: A });
    const perform = vi.fn(async (item) => {
      if (item.kind === 'flaky') throw new TypeError('Failed to fetch');
    });
    const res = await flushQueue(s, perform, { userId: A });
    expect(res).toMatchObject({ synced: 1, paused: true, remaining: 2 });
    const q = await getQueue(s);
    expect(q.map((i) => i.kind)).toEqual(['flaky', 'after']);
    expect(q[0].attempts).toBe(0);
  });

  it('XP-02: a 401 pauses the queue instead of dropping the change', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'comment.add', payload: { id: 't1', body: 'hi' }, userId: A });
    const res = await flushQueue(s, httpError(401), { userId: A });
    expect(res).toMatchObject({ synced: 0, failed: 0, paused: true, remaining: 1 });
    expect((await getQueue(s))[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('a 429 / 409 IDEMPOTENCY_IN_PROGRESS pauses without counting an attempt', async () => {
    for (const [status, code] of [[429, 'RATE_LIMITED'], [409, 'IDEMPOTENCY_IN_PROGRESS']]) {
      const s = fakeStorage();
      await enqueue(s, { kind: 'chat.send', payload: { conversationId: 'c', body: 'x' }, userId: A });
      const res = await flushQueue(s, httpError(status, code), { userId: A });
      expect(res.paused).toBe(true);
      expect((await getQueue(s))[0].attempts).toBe(0);
    }
  });

  it('XP-06: a 5xx counts an attempt and keeps the order; after MAX_ATTEMPTS it is marked failed (kept, visible)', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.update', payload: { id: 't1', patch: { title: 'A' } }, userId: A });
    await enqueue(s, { kind: 'task.update', payload: { id: 't1', patch: { title: 'B' } }, userId: A });
    let serverDown = true;
    const seen = [];
    const perform = makePerformMutation(async (path, init) => {
      seen.push(JSON.parse(init.body).title);
      return serverDown && JSON.parse(init.body).title === 'A' ? jsonRes({}, 500) : jsonRes({ data: {} });
    });
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      const r = await flushQueue(s, perform, { userId: A });
      expect(r).toMatchObject({ synced: 0, paused: true, remaining: 2 });
    }
    expect(seen.every((t) => t === 'A')).toBe(true); // B never overtook A
    const last = await flushQueue(s, perform, { userId: A });
    expect(last).toMatchObject({ synced: 1, failed: 1, remaining: 0 });
    const q = await getQueue(s);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(q[0].lastError).toMatch(/^500/);
    expect(await queueStats(s, A)).toMatchObject({ pending: 0, failed: 1 });

    // Retry puts it back in line; it syncs once the server is fine again.
    serverDown = false;
    await retryQueued(s, q[0].id);
    const again = await flushQueue(s, perform, { userId: A });
    expect(again).toMatchObject({ synced: 1, remaining: 0 });
    expect(await getQueue(s)).toEqual([]);
  });

  it('EXT-02/XP-06: a change that can never succeed is marked failed and shown — not silently dropped — and the rest continue', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'bad', userId: A });
    await enqueue(s, { kind: 'good', userId: A });
    const perform = vi.fn(async (item) => {
      if (item.kind === 'bad') {
        const e = new Error('422');
        e.outcome = 'fail';
        throw e;
      }
    });
    const res = await flushQueue(s, perform, { userId: A });
    expect(res).toMatchObject({ synced: 1, failed: 1, remaining: 0 });
    const q = await getQueue(s);
    expect(q.map((i) => [i.kind, i.status])).toEqual([['bad', 'failed']]);
    // A later flush leaves the failed item alone until the user retries or discards it.
    perform.mockClear();
    await flushQueue(s, perform, { userId: A });
    expect(perform).not.toHaveBeenCalled();
    await removeQueued(s, q[0].id);
    expect(await getQueue(s)).toEqual([]);
  });

  it('XP-06: changes queued while a flush is running are kept (and picked up), never overwritten', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'first', userId: A });
    const perform = vi.fn(async (item) => {
      if (item.kind === 'first') await enqueue(s, { kind: 'during', userId: A });
    });
    const res = await flushQueue(s, perform, { userId: A });
    expect(perform.mock.calls.map((c) => c[0].kind)).toEqual(['first', 'during']);
    expect(res.synced).toBe(2);
    expect(await getQueue(s)).toEqual([]);
  });

  it('XP-06: a change queued during a flush that then goes offline survives', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'first', userId: A });
    const perform = vi.fn(async (item) => {
      if (item.kind === 'first') {
        await enqueue(s, { kind: 'during', userId: A });
        return;
      }
      throw new TypeError('Failed to fetch');
    });
    await flushQueue(s, perform, { userId: A });
    expect((await getQueue(s)).map((i) => i.kind)).toEqual(['during']);
  });

  it('XP-06: only one flush runs at a time — a second one is skipped, nothing is sent twice', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'a', userId: A });
    await enqueue(s, { kind: 'b', userId: A });
    let release;
    const gate = new Promise((r) => { release = r; });
    const perform = vi.fn(async () => { await gate; });
    const first = flushQueue(s, perform, { userId: A });
    await new Promise((r) => setTimeout(r, 5));
    const second = await flushQueue(s, perform, { userId: A });
    expect(second.skipped).toBe(true);
    release();
    await first;
    expect(perform.mock.calls.map((c) => c[0].kind)).toEqual(['a', 'b']);
  });

  it('a discarded item is not replayed by a flush already in progress', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'a', userId: A });
    const b = await enqueue(s, { kind: 'b', userId: A });
    const perform = vi.fn(async (item) => {
      if (item.kind === 'a') await removeQueued(s, b.id);
    });
    await flushQueue(s, perform, { userId: A });
    expect(perform.mock.calls.map((c) => c[0].kind)).toEqual(['a']);
  });

  it('assignOwnerlessItems stamps pre-upgrade items with the signed-in user', async () => {
    const s = fakeStorage({ syncQueue: [{ id: '1', kind: 'a' }, { id: '2', kind: 'b', userId: B }] });
    await assignOwnerlessItems(s, A);
    expect((await getQueue(s)).map((i) => i.userId)).toEqual([A, B]);
  });

  it('clearQueue empties it', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'a', userId: A });
    await clearQueue(s);
    expect(await getQueue(s)).toEqual([]);
  });
});

describe('sendOrQueue (online-first writes)', () => {
  const keyed = () => 'idem-1';

  it('sends now and returns the created data; the POST carries an Idempotency-Key', async () => {
    const s = fakeStorage();
    const doFetch = vi.fn(async () => jsonRes({ data: { id: 't9' } }, 201));
    const r = await sendOrQueue({ kind: 'task.create', payload: { title: 'x' } }, { doFetch, storage: s, userId: A, newKey: keyed });
    expect(r).toEqual({ queued: false, data: { id: 't9' } });
    expect(doFetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('idem-1');
    expect(await getQueue(s)).toEqual([]);
  });

  it('XP-06: when the request fails (offline / timeout) it is queued with the SAME Idempotency-Key', async () => {
    const s = fakeStorage();
    const doFetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const r = await sendOrQueue({ kind: 'chat.send', payload: { conversationId: 'c1', body: 'hi' } }, { doFetch, storage: s, userId: A, newKey: keyed });
    expect(r.queued).toBe(true);
    const [item] = await getQueue(s);
    expect(item).toMatchObject({ kind: 'chat.send', userId: A, idempotencyKey: 'idem-1' });
    expect(doFetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('idem-1');
  });

  it('queues on 429 / 503 (transient) and on 401 (session ended — kept for when the user signs back in)', async () => {
    for (const status of [401, 429, 503]) {
      const s = fakeStorage();
      const r = await sendOrQueue({ kind: 'comment.add', payload: { id: 't', body: 'b' } }, { doFetch: async () => jsonRes({}, status), storage: s, userId: A });
      expect(r.queued).toBe(true);
      expect(await queueSize(s, A)).toBe(1);
    }
  });

  it('throws ApiError for a real HTTP error and queues nothing', async () => {
    const s = fakeStorage();
    const doFetch = async () => jsonRes({ error: { code: 'VALIDATION', message: 'bad' } }, 400);
    const err = await sendOrQueue({ kind: 'task.create', payload: {} }, { doFetch, storage: s, userId: A }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('bad');
    expect(await getQueue(s)).toEqual([]);
  });

  it('EXT-05: when the change can’t be sent AND can’t be stored, the caller is told (QueueError)', async () => {
    const s = fakeStorage({}, { failSet: () => true });
    const doFetch = async () => { throw new TypeError('Failed to fetch'); };
    const err = await sendOrQueue({ kind: 'comment.add', payload: { id: 't', body: 'b' } }, { doFetch, storage: s, userId: A }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueError);
    expect(err.userMessage).toBeTruthy();
  });
});
