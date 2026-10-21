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

describe('#3 the next person to sign in starts with their own settings, not the last person’s', async () => {
  const { startSession, signOut } = await import('./session.js');
  const { DESKTOP_ALERTS_KEY, ALERT_TARGET_KEY, NOTIFICATION_ID, clearDesktopAlert } = await import('./notify.js');
  const { LAST_PROJECT_KEY, RECENT_KEY, QUICK_ADD_SESSION_KEYS } = await import('./quick-add.js');
  const API = 'https://task.mico360.com/api/v1';
  // A session that expired: the tokens are gone, this person's settings stay on the device.
  const expired = () => {
    const local = fakeStorage({
      cacheOwner: 'u1', [DESKTOP_ALERTS_KEY]: { on: true, details: true },
      [LAST_PROJECT_KEY]: { userId: 'u1', projectId: 'p1' }, [RECENT_KEY]: { userId: 'u1', items: [{ title: 'A’s task' }] },
    });
    const session = fakeStorage(Object.fromEntries([...QUICK_ADD_SESSION_KEYS, ALERT_TARGET_KEY].map((k) => [k, { userId: 'u1' }])));
    return { local, session };
  };

  it('someone else signing in: "Say what it’s about" and the rest of the last person’s device settings are gone', async () => {
    const { local, session } = expired();
    await startSession({ local, session }, { accessToken: 'a', refreshToken: 'r', userId: 'u2', apiBase: API });
    expect(local.data[DESKTOP_ALERTS_KEY]).toBeUndefined();
    expect(local.data[LAST_PROJECT_KEY]).toBeUndefined();
    expect(local.data[RECENT_KEY]).toBeUndefined();
    for (const k of [...QUICK_ADD_SESSION_KEYS, ALERT_TARGET_KEY]) expect(session.data[k], k).toBeUndefined();
  });

  it('the same person signing in again keeps them', async () => {
    const { local, session } = expired();
    await startSession({ local, session }, { accessToken: 'a', refreshToken: 'r', userId: 'u1', apiBase: API });
    expect(local.data[DESKTOP_ALERTS_KEY]).toEqual({ on: true, details: true });
    expect(local.data[RECENT_KEY]).toBeTruthy();
  });

  describe('#6 the desktop alert goes when the session does', () => {
    it('signing out takes the last alert off the screen (it may say what it was about)', async () => {
      const notifications = { clear: vi.fn() };
      await signOut({ local: fakeStorage({ refreshToken: 'r', sessionApiBase: API }), session: fakeStorage(), fetchImpl: async () => res(204), notifications });
      expect(notifications.clear).toHaveBeenCalledWith(NOTIFICATION_ID);
    });

    it('clearing it never fails a sign-out (no notifications here, or Chrome refuses)', () => {
      expect(() => clearDesktopAlert(undefined)).not.toThrow();
      expect(() => clearDesktopAlert({ clear: () => { throw new Error('no'); } })).not.toThrow();
      const p = { clear: vi.fn(async () => { throw new Error('no'); }) };
      expect(() => clearDesktopAlert(p)).not.toThrow();
    });
  });
});

describe('#5 drafts and unsent messages are kept per conversation, for the person who wrote them', async () => {
  const { createChatDrafts, CHAT_DRAFTS_KEY } = await import('./chat-drafts.js');
  const { signOut, startSession } = await import('./session.js');

  it('keeps what is typed and the refused messages per conversation, and only for that person', async () => {
    const area = fakeStorage();
    const mine = createChatDrafts(area, 'u1');
    await mine.setDraft('c1', 'Half a thought');
    await mine.setFailed('c1', [{ clientId: 'x1', body: 'Refused', createdAt: '2026-10-21T09:00:00Z', error: 'No.' }]);
    await mine.setDraft('c2', 'Other');
    expect(await mine.get('c1')).toEqual({ draft: 'Half a thought', failed: [{ clientId: 'x1', body: 'Refused', createdAt: '2026-10-21T09:00:00Z', error: 'No.' }] });
    expect((await mine.get('c2')).draft).toBe('Other');
    expect(await mine.get('c3')).toEqual({ draft: '', failed: [] });
    expect(await createChatDrafts(area, 'u2').get('c1')).toEqual({ draft: '', failed: [] }); // someone else signed in here
    await mine.setDraft('c1', '');
    expect((await mine.get('c1')).draft).toBe('');
    expect((await mine.get('c1')).failed).toHaveLength(1);
  });

  it('quick writes don’t undo each other', async () => {
    const area = fakeStorage();
    const d = createChatDrafts(area, 'u1');
    await Promise.all([d.setDraft('c1', 'a'), d.setDraft('c2', 'b'), d.setFailed('c1', [{ clientId: 'x', body: 'y' }])]);
    expect(await d.get('c1')).toMatchObject({ draft: 'a', failed: [{ clientId: 'x' }] });
    expect((await d.get('c2')).draft).toBe('b');
  });

  it('go with a sign-out, and when someone else signs in after a session ended', async () => {
    const session = fakeStorage({ [CHAT_DRAFTS_KEY]: { userId: 'u1', conversations: { c1: { draft: 'secret' } } } });
    await signOut({ local: fakeStorage({ refreshToken: 'r' }), session, fetchImpl: async () => res(204) });
    expect(session.data[CHAT_DRAFTS_KEY]).toBeUndefined();
    const s2 = fakeStorage({ [CHAT_DRAFTS_KEY]: { userId: 'u1', conversations: { c1: { draft: 'secret' } } } });
    await startSession({ local: fakeStorage({ cacheOwner: 'u1' }), session: s2 }, { accessToken: 'a', refreshToken: 'r', userId: 'u2', apiBase: 'https://task.mico360.com/api/v1' });
    expect(s2.data[CHAT_DRAFTS_KEY]).toBeUndefined();
  });
});
