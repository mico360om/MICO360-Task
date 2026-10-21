import { describe, it, expect, vi } from 'vitest';
import {
  enqueue, getQueue, queueSize, queueStats, flushQueue, clearQueue, removeQueued, retryQueued,
  assignOwnerlessItems, makePerformMutation, sendOrQueue, describeMutation, pendingItems, MAX_ATTEMPTS,
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

  it('when the device’s storage is full, saved copies of screens make room for a change waiting to sync', async () => {
    // A full store (no room on the disk): here it is "full" while any copy is kept.
    const copies = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`cache:k${i}`, { data: i, cachedAt: i }]));
    const s = fakeStorage({ ...copies, theme: 'dark' }, { failSet: (obj, data) => 'syncQueue' in obj && Object.keys(data).some((k) => k.startsWith('cache:')) });
    const item = await enqueue(s, { kind: 'comment.add', payload: { id: 't1', body: 'hi' }, userId: A });
    expect((await getQueue(s)).map((i) => i.id)).toEqual([item.id]);
    expect(Object.keys(s.data).sort()).toEqual(['syncQueue', 'theme']); // settings stay
  });

  it('gives way only as far as needed: the newest saved copies stay when dropping the older ones is enough', async () => {
    const copies = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`cache:k${i}`, { data: i, cachedAt: i }]));
    const s = fakeStorage(copies, { failSet: (obj, data) => 'syncQueue' in obj && Object.keys(data).filter((k) => k.startsWith('cache:')).length > 100 });
    await enqueue(s, { kind: 'comment.add', payload: { id: 't1', body: 'hi' }, userId: A });
    const kept = Object.keys(s.data).filter((k) => k.startsWith('cache:'));
    expect(kept).toHaveLength(100);
    expect(kept).toContain('cache:k299');
    expect(kept).not.toContain('cache:k0');
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

  it('H1: an edit or move of a task with changes still waiting to sync goes in line behind them (one at a time)', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.update', payload: { id: 't1', patch: { title: 'A' }, expectedVersion: 5 }, userId: A });
    const doFetch = vi.fn(async () => jsonRes({ data: { id: 't1', version: 6 } }));
    const r = await sendOrQueue({ kind: 'task.update', payload: { id: 't1', patch: { priority: 'HIGH' }, expectedVersion: 5 } }, { doFetch, storage: s, userId: A });
    expect(r.queued).toBe(true);
    const move = await sendOrQueue({ kind: 'task.move', payload: { id: 't1', columnId: 'c2', position: 0 } }, { doFetch, storage: s, userId: A });
    expect(move.queued).toBe(true);
    expect(doFetch).not.toHaveBeenCalled();
    expect((await getQueue(s)).map((i) => i.kind)).toEqual(['task.update', 'task.update', 'task.move']);

    // Another task, another person's waiting change, or a comment is sent at once.
    await sendOrQueue({ kind: 'task.update', payload: { id: 't2', patch: { title: 'C' }, expectedVersion: 1 } }, { doFetch, storage: s, userId: A });
    await sendOrQueue({ kind: 'task.update', payload: { id: 't1', patch: { title: 'D' }, expectedVersion: 5 } }, { doFetch, storage: s, userId: B });
    await sendOrQueue({ kind: 'comment.add', payload: { id: 't1', body: 'hi' } }, { doFetch, storage: s, userId: A });
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  it('H1: an edit put in line continues the waiting edits’ versions (never an older one)', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.update', payload: { id: 't1', patch: { title: 'A' }, expectedVersion: 6 }, userId: A });
    await sendOrQueue({ kind: 'task.update', payload: { id: 't1', patch: { title: 'B' }, expectedVersion: 5 } }, { doFetch: vi.fn(), storage: s, userId: A });
    expect((await getQueue(s))[1].payload.expectedVersion).toBe(6);
  });

  it('H1: a task edit or move sent now hands the server’s task (its new version) on to be kept', async () => {
    const onTask = vi.fn();
    const doFetch = vi.fn(async () => jsonRes({ data: { id: 't1', version: 9 } }));
    await sendOrQueue({ kind: 'task.move', payload: { id: 't1', columnId: 'c2', position: 0 } }, { doFetch, storage: fakeStorage(), userId: A, onTask });
    expect(onTask).toHaveBeenCalledWith({ id: 't1', version: 9 });
    await sendOrQueue({ kind: 'comment.add', payload: { id: 't1', body: 'hi' } }, { doFetch, storage: fakeStorage(), userId: A, onTask });
    expect(onTask).toHaveBeenCalledTimes(1);
  });

  it('a quick run of edits while the server is failing costs the first queued change at most one try', async () => {
    const s = fakeStorage();
    let version = 5;
    const doFetch = vi.fn(async () => jsonRes({}, 502));
    const perform = makePerformMutation(doFetch);
    // As the app does: after a write, sync straight away only when the reply asks for it.
    const write = async (title) => {
      const r = await sendOrQueue({ kind: 'task.update', payload: { id: 't1', patch: { title }, expectedVersion: 5 } }, { doFetch, storage: s, userId: A });
      if (r.syncNow) await flushQueue(s, perform, { userId: A });
      return r;
    };
    const first = await write('A'); // its own send failed: trying it again at once would fail too
    expect(first.queued).toBe(true);
    expect(first.syncNow).toBeFalsy();
    expect((await write('B')).syncNow).toBe(true); // in line behind a change not tried yet
    for (const title of ['C', 'D', 'E']) expect((await write(title)).syncNow).toBeFalsy();
    const [a, ...rest] = await getQueue(s);
    expect(a).toMatchObject({ attempts: 1, status: 'pending' });
    expect(rest.map((i) => i.payload.patch.title)).toEqual(['B', 'C', 'D', 'E']);

    // The server is back (the next alarm): every change syncs, in order, and none is lost.
    doFetch.mockImplementation(async () => jsonRes({ data: { id: 't1', version: (version += 1) } }));
    expect(await flushQueue(s, perform, { userId: A })).toMatchObject({ synced: 5, failed: 0, remaining: 0 });
  });

  it('a failed change (Settings → Sync) does not hold the task’s next edit back', async () => {
    const s = fakeStorage({ syncQueue: [{ id: 'f1', kind: 'task.update', userId: A, status: 'failed', payload: { id: 't1', patch: {}, expectedVersion: 2 } }] });
    const doFetch = vi.fn(async () => jsonRes({ data: { id: 't1', version: 4 } }));
    const r = await sendOrQueue({ kind: 'task.update', payload: { id: 't1', patch: { title: 'B' }, expectedVersion: 3 } }, { doFetch, storage: s, userId: A });
    expect(r).toEqual({ queued: false, data: { id: 't1', version: 4 } });
  });

  it('M6: a 2xx that is not the server’s answer (a Wi-Fi sign-in page) is kept for later, not taken as saved', async () => {
    const s = fakeStorage();
    const portal = { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) }, json: async () => { throw new SyntaxError('<'); } };
    const r = await sendOrQueue({ kind: 'comment.add', payload: { id: 't1', body: 'hi' } }, { doFetch: async () => portal, storage: s, userId: A, newKey: keyed });
    expect(r.queued).toBe(true);
    expect((await getQueue(s))[0]).toMatchObject({ kind: 'comment.add', idempotencyKey: 'idem-1' });
  });

  it('M7: "Mark all read" is kept for later like other changes', async () => {
    const s = fakeStorage();
    const r = await sendOrQueue({ kind: 'notification.readAll', payload: {} }, { doFetch: async () => { throw new TypeError('Failed to fetch'); }, storage: s, userId: A });
    expect(r.queued).toBe(true);
    expect(describeMutation((await getQueue(s))[0])).toBe('Mark all notifications read');
  });
});

describe('pendingItems (what reads layer on top, H3)', () => {
  it('is the signed-in person’s changes still waiting to sync, oldest first — not failed ones or anyone else’s', async () => {
    const s = fakeStorage();
    const a1 = await enqueue(s, { kind: 'comment.add', payload: { id: 't1', body: '1' }, userId: A });
    await enqueue(s, { kind: 'comment.add', payload: { id: 't1', body: 'b' }, userId: B });
    const a2 = await enqueue(s, { kind: 'comment.add', payload: { id: 't1', body: '2' }, userId: A });
    s.data.syncQueue = s.data.syncQueue.map((i) => (i.id === a2.id ? { ...i, status: 'failed' } : i));
    expect((await pendingItems(s, A)).map((i) => i.id)).toEqual([a1.id]);
    expect(await pendingItems(s, null)).toEqual([]);
  });
});

describe('flushQueue — task versions (H1)', () => {
  it('after a replayed edit, this device’s next queued edit of that task is sent against the version it made', async () => {
    const s = fakeStorage();
    await enqueue(s, { kind: 'task.update', payload: { id: 't1', patch: { priority: 'HIGH' }, expectedVersion: 5 }, userId: A });
    await enqueue(s, { kind: 'task.move', payload: { id: 't1', columnId: 'c2', position: 0 }, userId: A });
    await enqueue(s, { kind: 'task.update', payload: { id: 't1', patch: { title: 'B' }, expectedVersion: 5 }, userId: A });
    let version = 5;
    const sent = [];
    const perform = makePerformMutation(async (path, init) => {
      const body = JSON.parse(init.body);
      sent.push(body.expectedVersion);
      if (body.expectedVersion !== undefined && body.expectedVersion !== version) return jsonRes({ error: { code: 'VERSION_CONFLICT', message: 'changed' } }, 409);
      version += 1;
      return jsonRes({ data: { id: 't1', version } });
    });
    const r = await flushQueue(s, perform, { userId: A });
    expect(r).toMatchObject({ synced: 3, failed: 0, remaining: 0 });
    expect(sent).toEqual([5, undefined, 7]);
  });
});
