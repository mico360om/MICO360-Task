import { describe, it, expect, vi } from 'vitest';
import { createSyncQueue, classifyReplayError, KEY_EXPIRED_TEXT, KEY_SAFE_MS, NO_ANSWER_TEXT, retryDelay, waitingTooLong, type QueuedMutation } from './sync-queue';
import { replayLane } from './write-order';
import { rebaseQueuedVersion } from './task-writes';
import { createMemoryStore } from './storage';
import { ApiError, NetworkError } from './api-client';

const slow = () => new NetworkError('The server took too long to respond.', { timedOut: true });
/** Every change in a lane of its own, named by its payload (the app's lanes are tested in write-order). */
const byPayload = (m: QueuedMutation) => String((m.payload as { lane?: unknown } | null)?.lane ?? m.id);
/** A clock past every retry wait each time it is read (each sync tries an unanswered change again — 4a review). */
const later = () => {
  let t = 1000;
  return () => (t += 11 * 60_000);
};

describe('a change the server keeps not answering (2c review fix 4, 3a review fix 11, 3b review fixes 1, 2 and 4)', () => {
  it('counts each time-out but never marks it failed: it keeps waiting (Discard is offered) and goes once the server answers', async () => {
    let hang = true;
    const perform = vi.fn(async () => {
      if (hang) throw slow();
    });
    const q = createSyncQueue(opts({ perform, now: later() }));
    await q.enqueue('chat.send', { conversationId: 'c1', body: 'hi' }, A);
    expect((await q.flush('userA')).pausedBy).toBe('offline');
    expect(q.pendingFor('userA')[0]).toMatchObject({ timeouts: 1, attempts: 0 });
    for (let i = 0; i < 5; i++) expect((await q.flush('userA')).failed).toEqual([]);
    expect(q.failedFor('userA')).toEqual([]);
    expect(q.pendingFor('userA')[0]).toMatchObject({ status: 'pending', timeouts: 6 });
    expect(waitingTooLong(q.pendingFor('userA')[0]!, 1000)).toBe(true);
    hang = false;
    expect((await q.flush('userA')).synced).toBe(1);
  });

  it('a later change of the same task waits behind one that got no answer, however many tries — and moves on to the version it made', async () => {
    const sent: unknown[] = [];
    let hang = 3;
    const perform = vi.fn(async (m: QueuedMutation) => {
      const p = m.payload as { patch: { title?: string; expectedVersion?: number } };
      if (p.patch.title && hang-- > 0) throw slow();
      sent.push(p.patch);
      return { id: 't1', version: (p.patch.expectedVersion ?? 0) + 1 };
    });
    const q = createSyncQueue(opts({ perform, lane: replayLane, rebase: rebaseQueuedVersion, now: later() }));
    await q.enqueue('task.update', { id: 't1', patch: { title: 'A', expectedVersion: 3 } }, A);
    await q.enqueue('task.update', { id: 't1', patch: { description: 'B', expectedVersion: 3 } }, A);
    for (let i = 0; i < 3; i++) await q.flush('userA');
    expect(sent).toEqual([]); // B never overtakes A
    expect(q.failedFor('userA')).toEqual([]);
    await q.flush('userA');
    expect(sent).toEqual([
      { title: 'A', expectedVersion: 3 },
      { description: 'B', expectedVersion: 4 },
    ]);
  });

  it('a network that only hangs never fails what is waiting: it all goes again when the server answers', async () => {
    const perform = vi.fn(async () => {
      throw slow();
    });
    const q = createSyncQueue(opts({ perform, lane: replayLane }));
    await q.enqueue('meeting.note.add', { meetingId: 'm1', body: 'n1' }, A);
    await q.enqueue('chat.send', { conversationId: 'c1', body: 'hi' }, A);
    await q.enqueue('comment.add', { id: 't1', body: 'c' }, A);
    await q.enqueue('checklist.update', { id: 't1', itemId: 's1', patch: { done: true } }, A);
    for (let i = 0; i < 6; i++) await q.flush('userA');
    expect(q.failedFor('userA')).toHaveLength(0);
    expect(q.pendingFor('userA')).toHaveLength(4);
  });

  it('a change that got no answer last time is tried after the others: a new message doesn’t wait behind it', async () => {
    const order: string[] = [];
    const perform = vi.fn(async (m: QueuedMutation) => {
      const p = m.payload as { lane: string; body: string };
      order.push(p.body);
      if (p.body === 'stuck') throw slow();
    });
    const q = createSyncQueue(opts({ perform, lane: byPayload, now: later() }));
    await q.enqueue('meeting.note.add', { lane: 'notes:m1', body: 'stuck' }, A);
    await q.flush('userA');
    await q.enqueue('chat.send', { lane: 'chat:c1', body: 'new message' }, A);
    await q.flush('userA');
    expect(order).toEqual(['stuck', 'new message', 'stuck']);
  });

  it('a plain "no connection" still pauses everything and counts nothing', async () => {
    const perform = vi.fn(async () => {
      throw new NetworkError('Network request failed.');
    });
    const q = createSyncQueue(opts({ perform, lane: byPayload }));
    await q.enqueue('a', { lane: 'x' }, A);
    await q.enqueue('b', { lane: 'y' }, A);
    expect((await q.flush('userA')).pausedBy).toBe('offline');
    expect(perform).toHaveBeenCalledTimes(1);
    expect(q.pendingFor('userA').map((m) => m.timeouts ?? 0)).toEqual([0, 0]);
  });

  it('one stuck change holds only its own lane: a message in another conversation goes, the next in its own waits', async () => {
    const sent: string[] = [];
    const perform = vi.fn(async (m: QueuedMutation) => {
      const p = m.payload as { lane: string; body: string };
      if (p.body === 'stuck') throw slow();
      sent.push(p.body);
    });
    const q = createSyncQueue(opts({ perform, lane: byPayload }));
    await q.enqueue('chat.send', { lane: 'chat:c1', body: 'stuck' }, A);
    await q.enqueue('chat.send', { lane: 'chat:c1', body: 'after it' }, A);
    await q.enqueue('chat.send', { lane: 'chat:c2', body: 'other conversation' }, A);
    const res = await q.flush('userA');
    expect(sent).toEqual(['other conversation']);
    expect(res.remaining).toBe(2);
    expect(res.pausedBy).toBe('offline');
  });

  it('a second change without an answer in the same sync pauses it: the connection is the problem, not one change', async () => {
    const perform = vi.fn(async () => {
      throw slow();
    });
    const q = createSyncQueue(opts({ perform, lane: byPayload }));
    for (const lane of ['x', 'y', 'z']) await q.enqueue('a', { lane }, A);
    await q.flush('userA');
    expect(perform).toHaveBeenCalledTimes(2);
  });

  it('a server hiccup on one change (a meeting note) doesn’t hold chat messages behind it', async () => {
    const sent: string[] = [];
    const perform = vi.fn(async (m: QueuedMutation) => {
      if (m.kind === 'meeting.note.add') throw new ApiError(503, 'UNAVAILABLE', 'down');
      sent.push(m.kind);
    });
    const q = createSyncQueue(opts({ perform, lane: byPayload }));
    await q.enqueue('meeting.note.add', { lane: 'notes:m1' }, A);
    await q.enqueue('chat.send', { lane: 'chat:c1' }, A);
    const res = await q.flush('userA');
    expect(sent).toEqual(['chat.send']);
    expect(res.pausedBy).toBe('server');
    expect(q.pendingFor('userA')[0]).toMatchObject({ kind: 'meeting.note.add', attempts: 1 });
  });

  it('says which waiting changes have been waiting too long — those can be discarded', () => {
    const base = { id: 'q', kind: 'chat.send', payload: {}, userId: 'u', idempotencyKey: 'k', attempts: 0, status: 'pending' as const };
    const now = 10 * 60 * 60_000;
    expect(waitingTooLong({ ...base, createdAt: now - 60_000 }, now)).toBe(false);
    expect(waitingTooLong({ ...base, createdAt: now - 60_000, timeouts: 1 }, now)).toBe(true);
    expect(waitingTooLong({ ...base, createdAt: now - 16 * 60_000 }, now)).toBe(true);
  });
});

describe('Retry after a refusal (3a review fix 7)', () => {
  it('goes under a new key: the server keeps a refusal under its key and would hand it back for a day', async () => {
    const keys: string[] = [];
    let refuse = true;
    const perform = vi.fn(async (m: QueuedMutation) => {
      keys.push(m.idempotencyKey);
      if (refuse) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this conversation.');
    });
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('chat.send', { conversationId: 'c1', body: 'hi', clientId: 'c-1' }, { ...A, idempotencyKey: 'first' });
    await q.flush('userA');
    refuse = false;
    await q.retry(q.failedFor('userA')[0]!.id);
    await q.flush('userA');
    expect(keys[0]).toBe('first');
    expect(keys[1]).not.toBe('first');
  });

  it('keeps the key after a change that only got no answer or a server hiccup (it may have been saved)', async () => {
    const keys: string[] = [];
    let fail: 'slow' | 'down' | null = 'slow';
    const perform = vi.fn(async (m: QueuedMutation) => {
      keys.push(m.idempotencyKey);
      if (fail === 'slow') throw slow();
      if (fail === 'down') throw new ApiError(503, 'UNAVAILABLE', 'down');
    });
    const q = createSyncQueue(opts({ perform, maxAttempts: 2, now: later() }));
    await q.enqueue('task.create', { title: 'x' }, { ...A, idempotencyKey: 'first' });
    for (let i = 0; i < 3; i++) await q.flush('userA');
    fail = 'down';
    for (let i = 0; i < 2; i++) await q.flush('userA');
    fail = null;
    await q.retry(q.failedFor('userA')[0]!.id);
    await q.flush('userA');
    expect(new Set(keys)).toEqual(new Set(['first']));
  });
});

describe('changes kept by an older version of the app (3b review fix 5)', () => {
  const stored = (items: object[]) => createMemoryStore({ 'mico360.mutations': JSON.stringify(items) });
  const item = (id: string, over: object) => ({ id, kind: 'chat.send', payload: {}, createdAt: 5, userId: 'userA', idempotencyKey: `k-${id}`, attempts: 0, status: 'failed', ...over });

  it('a refusal it kept (no flag then) is known as one: its Retry goes under a new key', async () => {
    const q = createSyncQueue(opts({ store: stored([item('r', { lastError: 'You do not have access to this conversation.' })]) }));
    await q.load();
    expect(q.failedFor('userA')[0]).toMatchObject({ refused: true });
    await q.retry('r');
    expect(q.pendingFor('userA')[0]!.idempotencyKey).not.toBe('k-r');
  });

  it('one that kept failing on the server is not a refusal: its Retry keeps the key (it may be saved)', async () => {
    const q = createSyncQueue(opts({ store: stored([item('h', { lastError: 'boom', attempts: 5 })]) }));
    await q.load();
    expect(q.failedFor('userA')[0]!.refused).toBeUndefined();
    await q.retry('h');
    expect(q.pendingFor('userA')[0]!.idempotencyKey).toBe('k-h');
  });

  it('one it stopped sending for want of an answer waits again, under its key, and is sent by itself', async () => {
    const q = createSyncQueue(opts({ store: stored([item('n', { lastError: NO_ANSWER_TEXT, timeouts: 3 })]) }));
    await q.load();
    expect(q.failedFor('userA')).toEqual([]);
    expect(q.pendingFor('userA')[0]).toMatchObject({ id: 'n', status: 'pending', timeouts: 3, idempotencyKey: 'k-n', lastError: undefined });
  });
});

describe('replayLane — what a waiting change waits behind', () => {
  it('a conversation’s messages share a lane; another conversation, a note or an item change has its own', () => {
    const m = (kind: string, payload: unknown, id = 'q') => ({ id, kind, payload });
    expect(replayLane(m('chat.send', { conversationId: 'c1' }, 'a'))).toBe(replayLane(m('chat.send', { conversationId: 'c1' }, 'b')));
    expect(replayLane(m('chat.send', { conversationId: 'c1' }))).not.toBe(replayLane(m('chat.send', { conversationId: 'c2' })));
    expect(replayLane(m('meeting.note.add', { meetingId: 'm1' }))).not.toBe(replayLane(m('chat.send', { conversationId: 'c1' })));
    expect(replayLane(m('task.move', { id: 't1' }))).toBe(replayLane(m('task.update', { id: 't1' })));
    expect(replayLane(m('checklist.update', { id: 't1', itemId: 'k1' }))).not.toBe(replayLane(m('checklist.update', { id: 't1', itemId: 'k2' })));
    expect(replayLane(m('???', {}, 'x'))).not.toBe(replayLane(m('???', {}, 'y')));
  });
});

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
    expect(res).toEqual({ synced: 2, done: [expect.objectContaining({ kind: 'a' }), expect.objectContaining({ kind: 'b' })], failed: [], remaining: 0 });
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
    expect(res).toEqual({ synced: 1, done: [expect.objectContaining({ kind: 'a' })], failed: [], remaining: 2, pausedBy: 'offline' });
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

  it('after a change replays, rebase() updates the owner’s waiting changes with its result (and persists them)', async () => {
    const store = createMemoryStore();
    const perform = vi.fn(async (_m: QueuedMutation): Promise<unknown> => undefined);
    const seen: unknown[] = [];
    const rebase = vi.fn((done: QueuedMutation, result: unknown, waiting: QueuedMutation) => {
      seen.push(waiting.payload);
      return done.kind === 'a' ? { ...waiting, payload: { follows: (result as { made: number }).made } } : waiting;
    });
    const q = createSyncQueue(opts({ store, perform, rebase }));
    await q.enqueue('a', 1, A);
    await q.enqueue('b', 2, A);
    await q.enqueue('c', 3, B); // another person's change is never touched
    let persisted: unknown;
    perform.mockImplementationOnce(async (m: QueuedMutation) => {
      expect(m.kind).toBe('a');
      return { made: 7 };
    });
    perform.mockImplementationOnce(async (m: QueuedMutation) => {
      persisted = JSON.parse((await store.getItem('mico360.mutations'))!);
      expect(m.payload).toEqual({ follows: 7 });
      return undefined;
    });
    const res = await q.flush('userA');
    expect(res.synced).toBe(2);
    expect(seen).toEqual([2]);
    expect((persisted as QueuedMutation[]).map((m) => m.payload)).toEqual([{ follows: 7 }, 3]);
    expect(q.pending().map((m) => m.payload)).toEqual([3]);
  });

  it('flush on an empty queue is a no-op', async () => {
    const o = opts();
    const q = createSyncQueue(o);
    const res = await q.flush('userA');
    expect(res).toEqual({ synced: 0, done: [], failed: [], remaining: 0 });
    expect(o.perform).not.toHaveBeenCalled();
  });

  it('a create refused with TASK_KEY_CONFLICT is tried again under a new key, and then goes through', async () => {
    // The server keeps that refusal under the key for a day, so the same key would get it back on
    // every retry. No task was made under it, so a new key can't make a duplicate.
    const keys: string[] = [];
    const perform = vi.fn(async (m: QueuedMutation) => {
      keys.push(m.idempotencyKey);
      if (keys.length === 1) throw new ApiError(409, 'TASK_KEY_CONFLICT', 'Another task was created at the same moment. Please try again.');
    });
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('task.create', { title: 'x' }, { ...A, idempotencyKey: 'online-key' });

    const first = await q.flush('userA');
    expect(first.pausedBy).toBe('server');
    expect(q.failedFor('userA')).toHaveLength(0);
    const second = await q.flush('userA');
    expect(second.synced).toBe(1);
    expect(keys[0]).toBe('online-key');
    expect(keys[1]).not.toBe('online-key');
    expect(keys[1]).toMatch(/^key-/);
  });

  it('keeps the key on any other server hiccup (a replay must stay de-duplicated)', async () => {
    const keys: string[] = [];
    const perform = vi.fn(async (m: QueuedMutation) => {
      keys.push(m.idempotencyKey);
      if (keys.length === 1) throw new ApiError(503, 'UNAVAILABLE', 'down');
    });
    const q = createSyncQueue(opts({ perform }));
    await q.enqueue('task.create', { title: 'x' }, { ...A, idempotencyKey: 'online-key' });
    await q.flush('userA');
    await q.flush('userA');
    expect(keys).toEqual(['online-key', 'online-key']);
  });
});

describe('classifyReplayError', () => {
  it('maps failures to pause / retry / fail', () => {
    expect(classifyReplayError(new NetworkError('offline'))).toBe('offline');
    expect(classifyReplayError(new ApiError(401, 'UNAUTHORIZED', ''))).toBe('unauthorized');
    expect(classifyReplayError(new ApiError(429, 'RATE_LIMITED', ''))).toBe('transient');
    expect(classifyReplayError(new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', ''))).toBe('transient');
    expect(classifyReplayError(new ApiError(409, 'CONFLICT', ''))).toBe('permanent');
    // Two tasks were created at the same moment: try again (under a new key, see the queue).
    expect(classifyReplayError(new ApiError(409, 'TASK_KEY_CONFLICT', ''))).toBe('transient');
    expect(classifyReplayError(new ApiError(503, 'UNAVAILABLE', ''))).toBe('transient');
    expect(classifyReplayError(new ApiError(404, 'NOT_FOUND', ''))).toBe('permanent');
    expect(classifyReplayError(new Error('???'))).toBe('transient');
  });
});

describe('a change the server doesn’t answer is tried again later, not on every sync (4a review #1)', () => {
  /** A clock the test moves. */
  function clock(start = 1_000_000) {
    let t = start;
    return { now: () => t, tick: (ms: number) => (t += ms) };
  }

  it('waits longer after each try with no answer (30 s, 1 min, 2 min … at most 10 min), then goes again', async () => {
    const c = clock();
    const perform = vi.fn(async () => {
      throw slow();
    });
    const q = createSyncQueue(opts({ perform, now: c.now }));
    await q.enqueue('meeting.note.add', { meetingId: 'm1', body: 'long note' }, A);
    await q.flush('userA');
    expect(perform).toHaveBeenCalledTimes(1);
    await q.flush('userA'); // the next sync, 15 s later: not yet
    expect(perform).toHaveBeenCalledTimes(1);
    c.tick(29_000);
    await q.flush('userA');
    expect(perform).toHaveBeenCalledTimes(1);
    c.tick(1_000);
    await q.flush('userA');
    expect(perform).toHaveBeenCalledTimes(2);
    c.tick(59_000);
    await q.flush('userA');
    expect(perform).toHaveBeenCalledTimes(2);
    c.tick(1_000);
    await q.flush('userA');
    expect(perform).toHaveBeenCalledTimes(3);
    expect(retryDelay(1)).toBe(30_000);
    expect(retryDelay(2)).toBe(60_000);
    expect(retryDelay(9)).toBe(600_000);
  });

  it('a new message goes at once while a stuck change’s try is still on its way', async () => {
    const c = clock();
    const sent: string[] = [];
    let stuckTry!: () => void;
    const perform = vi.fn((m: QueuedMutation) => {
      const p = m.payload as { lane: string; body: string };
      if (p.body === 'stuck') return new Promise<void>((_r, reject) => (stuckTry = () => reject(slow())));
      sent.push(p.body);
      return Promise.resolve();
    });
    const q = createSyncQueue(opts({ perform, lane: byPayload, now: c.now }));
    // A long note the server didn't answer: its next try, a minute later, hangs again.
    await q.enqueue('meeting.note.add', { lane: 'notes:m1', body: 'stuck' }, { ...A, answerLost: true });
    c.tick(60_000);
    const flushing = q.flush('userA');
    await new Promise((r) => setTimeout(r, 0));
    expect(perform).toHaveBeenCalledTimes(1);
    await q.enqueue('chat.send', { lane: 'chat:c1', body: 'new message' }, A);
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toEqual(['new message']); // not after the stuck note's 20 s
    stuckTry();
    const res = await flushing;
    expect(res.synced).toBe(1);
    expect(q.pendingFor('userA')).toHaveLength(1);
  });

  it('a create the server hasn’t answered for a day isn’t sent again under its key (the server forgets keys after 24 h): it asks you to check', async () => {
    const c = clock();
    const perform = vi.fn(async () => {
      throw slow();
    });
    const keyed = (m: QueuedMutation) => m.kind !== 'chat.send';
    const q = createSyncQueue(opts({ perform, now: c.now, keyLifetime: { ms: KEY_SAFE_MS, applies: keyed } }));
    await q.enqueue('task.create', { title: 'Pump' }, A);
    await q.enqueue('chat.send', { conversationId: 'c1', body: 'hi' }, B);
    await q.flush('userA');
    await q.flush('userB');
    c.tick(KEY_SAFE_MS);
    perform.mockClear();
    const res = await q.flush('userA');
    await q.flush('userB');
    expect(res.failed.map((m) => m.kind)).toEqual(['task.create']);
    expect(q.failedFor('userA')[0]).toMatchObject({ lastError: KEY_EXPIRED_TEXT });
    expect(q.failedFor('userA')[0]!.refused).toBeUndefined();
    expect(perform).toHaveBeenCalledTimes(1); // only the message (its client id keeps it from being stored twice)
    expect(KEY_SAFE_MS).toBe(23 * 60 * 60_000);
  });

  it('a change kept after its live try got no answer starts out waiting (and counted) like one the sync tried', async () => {
    const c = clock();
    const q = createSyncQueue(opts({ now: c.now }));
    const m = await q.enqueue('task.create', { title: 'Pump' }, { ...A, answerLost: true });
    expect(m).toMatchObject({ timeouts: 1, lastTryAt: c.now(), firstUnansweredAt: c.now() });
  });
});
