import { describe, it, expect } from 'vitest';
import { createReadCache } from './read-cache.js';
import { createApi, ApiError } from './api.js';
import { createAuth } from './auth.js';
import { getQueue, queueSize, flushQueue, makePerformMutation, sendOrQueue } from './queue.js';
import { fakeStorage, jsonRes } from './test-helpers.js';

/**
 * End-to-end offline → sync proof, wiring the real auth + read-cache + api + queue together (the
 * same pieces the extension app and service worker use).
 */

const API = 'https://task.mico360.com/api/v1';

/** Controllable backend: flip `net.online=false` to simulate offline; records calls when online. */
function makeFetch(net) {
  return async (url, init = {}) => {
    if (!net.online) throw new TypeError('Failed to fetch');
    net.calls.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    const path = String(url).split('/api/v1')[1] || '';
    // Like Fastify: a body-less request that declares JSON is rejected.
    if (init.headers && init.headers['Content-Type'] === 'application/json' && init.body == null) {
      return jsonRes({ error: { code: 'FST_ERR_CTP_EMPTY_JSON_BODY' } }, 400);
    }
    if (path === '/tasks/mine') return jsonRes({ data: [{ id: 't1', key: 'ENG-1', title: 'A', columnId: 'c1' }] });
    if (/^\/tasks\/[^/]+\/move$/.test(path)) return jsonRes({ data: { id: 't1', columnId: 'c2' } });
    if (/^\/tasks\/[^/]+\/assignees\/[^/]+$/.test(path)) return { ok: true, status: 204, json: async () => ({}) };
    if (path === '/conversations') {
      return jsonRes({ data: [{ conversation: { id: 'cv1', kind: 'PROJECT', projectId: 'p1' }, participants: [], unread: 0, lastMessage: { id: 'm1', body: 'the wifi password is 1234', deletedAt: '2026-09-26T09:00:00Z' } }] });
    }
    if (path === '/conversations/cv1/messages') {
      return jsonRes({ data: [{ id: 'm1', body: 'the wifi password is 1234', deletedAt: '2026-09-26T09:00:00Z', attachments: [{ name: 'x.png' }] }, { id: 'm2', body: 'hi', deletedAt: null }] });
    }
    return jsonRes({ data: [] });
  };
}

function setup() {
  const local = fakeStorage({ refreshToken: 'r', sessionUserId: 'u1', sessionApiBase: API });
  const session = fakeStorage({ accessToken: 'tok' });
  const net = { online: true, calls: [] };
  const fetchImpl = makeFetch(net);
  const auth = createAuth({ local, session, apiBase: API, fetchImpl });
  const cache = createReadCache(local);
  const api = createApi({ auth, cache });
  const doFetch = (path, init) => auth.authedFetch(path, init);
  return { local, session, net, auth, cache, api, doFetch };
}

describe('offline read cache + write queue + sync (integration)', () => {
  it('caches reads online, serves them stale offline, queues writes offline, and replays on reconnect', async () => {
    const { local, net, api, doFetch } = setup();

    // 1. Online read → fresh, and cached.
    const online = await api.tasks.mine();
    expect(online.stale).toBe(false);
    expect(online.data).toHaveLength(1);

    // 2. Go offline → the same read serves the cached value, marked stale.
    net.online = false;
    const offline = await api.tasks.mine();
    expect(offline.stale).toBe(true);
    expect(offline.data).toEqual(online.data);

    // 3. A write while offline is queued for this user, with an Idempotency-Key.
    const w = await sendOrQueue({ kind: 'task.move', payload: { id: 't1', columnId: 'c2', position: 0 } }, { doFetch, storage: local, userId: 'u1' });
    expect(w.queued).toBe(true);
    expect(await queueSize(local, 'u1')).toBe(1);

    // 4. Reconnect → flush replays the queued mutation to the correct endpoint; queue drains.
    net.online = true;
    net.calls = [];
    const result = await flushQueue(local, makePerformMutation(doFetch), { userId: 'u1' });
    expect(result).toMatchObject({ synced: 1, failed: 0, remaining: 0 });
    expect(await getQueue(local)).toEqual([]);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].method).toBe('PATCH');
    expect(net.calls[0].url).toContain('/tasks/t1/move');
    expect(JSON.parse(net.calls[0].body)).toEqual({ columnId: 'c2', position: 0 });
  });

  it('EXT-02: "Unassign me" (DELETE, no body) succeeds live and when replayed from the queue', async () => {
    const { local, net, doFetch } = setup();
    const live = await sendOrQueue({ kind: 'task.unassign', payload: { id: 't1', userId: 'u1' } }, { doFetch, storage: local, userId: 'u1' });
    expect(live.queued).toBe(false);
    expect(net.calls[0].headers['Content-Type']).toBeUndefined();

    net.online = false;
    await sendOrQueue({ kind: 'task.unassign', payload: { id: 't1', userId: 'u1' } }, { doFetch, storage: local, userId: 'u1' });
    await sendOrQueue({ kind: 'notification.read', payload: { id: 'n1' } }, { doFetch, storage: local, userId: 'u1' });
    net.online = true;
    const r = await flushQueue(local, makePerformMutation(doFetch), { userId: 'u1' });
    expect(r).toMatchObject({ synced: 2, failed: 0 });
  });

  it('surfaces an HTTP error (not offline) as ApiError so screens do NOT wrongly queue it', async () => {
    const local = fakeStorage({ refreshToken: 'r', sessionUserId: 'u1', sessionApiBase: API });
    const auth = createAuth({ local, session: fakeStorage({ accessToken: 't' }), apiBase: API, fetchImpl: async () => jsonRes({ error: { message: 'bad' } }, 400) });
    const api = createApi({ auth, cache: createReadCache(local) });
    await expect(api.tasks.list({ projectId: 'p' })).rejects.toBeInstanceOf(ApiError);
    const err = await sendOrQueue({ kind: 'task.create', payload: { title: 'x' } }, { doFetch: (p, i) => auth.authedFetch(p, i), storage: local, userId: 'u1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(await getQueue(local)).toEqual([]);
  });

  it('EXT-03: the board asks for one board day', async () => {
    const { net, api } = setup();
    await api.tasks.list({ projectId: 'p1', boardDate: '2026-09-26' });
    expect(net.calls[0].url).toBe(`${API}/tasks?projectId=p1&boardDate=2026-09-26`);
  });

  it('CHAT-01: a deleted message’s text is never cached or returned', async () => {
    const { local, api } = setup();
    const inbox = await api.chat.conversations();
    const thread = await api.chat.messages('cv1');
    expect(inbox.data[0].lastMessage.body).toBe('');
    expect(thread.data[0]).toMatchObject({ id: 'm1', body: '', attachments: [] });
    expect(thread.data[1].body).toBe('hi');
    expect(JSON.stringify(local.data)).not.toContain('wifi password');
  });
});
