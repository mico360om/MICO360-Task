import { describe, it, expect, vi } from 'vitest';
import {
  mutationRequest, sendOrQueue, enqueue, getQueue, flushQueue, makePerformMutation, retryQueued,
} from './queue.js';
import { mustFollow, supersede } from './task-writes.js';
import { applyPending } from './pending-overlay.js';
import { fakeStorage } from './test-helpers.js';

// Stage 5 review fixes: chat messages reach the server in the order written (#2), and a message the
// server refused can be sent again (#4).
const res = (status, body = { data: { id: 'srv' } }) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => 'application/json' } });
const message = (conversationId, body, extra = {}) => ({ kind: 'chat.send', userId: 'me', payload: { conversationId, body, ...extra } });

describe('#2 a message kept on this device is never overtaken by a later one', () => {
  it('messages of one conversation keep their order; other conversations don’t wait', () => {
    expect(mustFollow(message('c1', 'B'), message('c1', 'A'))).toBe(true);
    expect(mustFollow(message('c1', 'B'), message('c2', 'A'))).toBe(false);
  });

  it('a message written while an earlier one is kept waits behind it (and asks for a sync), instead of going first', async () => {
    const storage = fakeStorage();
    await enqueue(storage, { ...message('c1', 'A'), idempotencyKey: 'ka' });
    const doFetch = vi.fn(async () => res(201));
    const r = await sendOrQueue(message('c1', 'B'), { doFetch, storage, userId: 'me', newKey: () => 'kb' });
    expect(r).toMatchObject({ queued: true, syncNow: true });
    expect(doFetch).not.toHaveBeenCalled();
    expect((await getQueue(storage)).map((i) => [i.payload.body, i.idempotencyKey])).toEqual([['A', 'ka'], ['B', 'kb']]);

    const sent = [];
    await flushQueue(storage, makePerformMutation(async (path, init) => { sent.push(JSON.parse(init.body).body); return res(201); }), { userId: 'me' });
    expect(sent).toEqual(['A', 'B']);
  });

  it('a later message sent never marks an earlier one that failed as replaced: it can still be sent', () => {
    const older = { id: 'q1', status: 'failed', ...message('c1', 'A') };
    expect(supersede({ id: 'q2', ...message('c1', 'B') }, older)).toBe(older);
  });

  it('with nothing kept, a message goes at once', async () => {
    const storage = fakeStorage();
    const doFetch = vi.fn(async () => res(201));
    expect(await sendOrQueue(message('c1', 'A'), { doFetch, storage, userId: 'me' })).toMatchObject({ queued: false });
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});

describe('#4 the message’s clientId is its own, apart from each try’s Idempotency-Key', () => {
  it('the clientId travels in the change; the request’s key may differ', () => {
    const req = mutationRequest({ ...message('c1', 'Hi', { clientId: 'cid-1' }), idempotencyKey: 'try-2' });
    expect(JSON.parse(req.init.body)).toEqual({ body: 'Hi', clientId: 'cid-1' });
    expect(req.init.headers).toEqual({ 'Idempotency-Key': 'try-2' });
    // Kept before this change: its key was its clientId.
    expect(JSON.parse(mutationRequest({ ...message('c1', 'Hi'), idempotencyKey: 'old' }).init.body).clientId).toBe('old');
  });

  it('Retry (Settings → Sync) after the server refused it sends again with a new key — the server keeps its refusal for a day', async () => {
    const storage = fakeStorage();
    await enqueue(storage, { ...message('c1', 'Hi', { clientId: 'cid-1' }), idempotencyKey: 'k1' });
    await flushQueue(storage, makePerformMutation(async () => res(403, { error: { code: 'FORBIDDEN', message: 'No.' } })), { userId: 'me' });
    const [failed] = await getQueue(storage);
    expect(failed).toMatchObject({ status: 'failed', lastStatus: 403 });
    await retryQueued(storage, failed.id);
    const [again] = await getQueue(storage);
    expect(again.status).toBe('pending');
    expect(again.idempotencyKey).not.toBe('k1');
    expect(again.payload.clientId).toBe('cid-1'); // still the same message: never stored twice
  });

  it('Retry after tries that never got an answer keeps the key (the first may have arrived)', async () => {
    const storage = fakeStorage();
    await enqueue(storage, { kind: 'task.create', userId: 'me', payload: { title: 'T' }, idempotencyKey: 'k1' });
    await flushQueue(storage, makePerformMutation(async () => res(503, {})), { userId: 'me', maxAttempts: 1 });
    const [failed] = await getQueue(storage);
    expect(failed.status).toBe('failed');
    await retryQueued(storage, failed.id);
    expect((await getQueue(storage))[0].idempotencyKey).toBe('k1');
  });

  it('a kept message the server already has (same clientId) isn’t shown twice', () => {
    const kept = [{ id: 'q1', status: 'pending', idempotencyKey: 'try-2', ...message('c1', 'Hi', { clientId: 'cid-1' }) }];
    expect(applyPending('messages:c1', [{ id: 'm1', clientId: 'cid-1', body: 'Hi' }], kept).applied).toBe(0);
    const shown = applyPending('messages:c1', [], kept).data;
    expect(shown[0]).toMatchObject({ clientId: 'cid-1', pending: true });
  });
});

describe('#4 a new key on Retry keeps the popup’s recent task linked to its change', () => {
  it('a refused new task, tried again, still shows as waiting in the recent tasks', async () => {
    const { recentStatus } = await import('./quick-add.js');
    const storage = fakeStorage();
    await enqueue(storage, { kind: 'task.create', userId: 'me', payload: { title: 'T' }, idempotencyKey: 'k1' });
    await flushQueue(storage, makePerformMutation(async () => res(400, { error: { code: 'VALIDATION', message: 'No column.' } })), { userId: 'me' });
    const entry = { queuedKey: 'k1', title: 'T' };
    expect(recentStatus(entry, await getQueue(storage))).toBe('failed');
    await retryQueued(storage, (await getQueue(storage))[0].id);
    const q = await getQueue(storage);
    expect(q[0].idempotencyKey).not.toBe('k1');
    expect(recentStatus(entry, q)).toBe('waiting');
  });
});
