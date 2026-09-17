import { describe, it, expect } from 'vitest';
import { createReadCache } from './read-cache.js';
import { createApi, ApiError } from './api.js';
import { enqueue, queueSize, flushQueue, makePerformMutation } from './queue.js';
import { authedFetch } from './auth.js';

/**
 * End-to-end offline → sync proof, wiring the real read-cache + api + queue together (the same
 * pieces the extension screens use). Verifies: reads serve cached data offline; writes made offline
 * are queued; and on reconnect the queue replays them to the correct endpoints.
 */

function fakeStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    get: async (keys) => {
      const ks = keys == null ? [] : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of ks) if (k in data) out[k] = data[k];
      return out;
    },
    set: async (obj) => Object.assign(data, obj),
    remove: async (keys) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
  };
}

/** Controllable fetch: flip `net.online=false` to simulate offline; records calls when online. */
function makeFetch(net) {
  return async (url, init = {}) => {
    if (!net.online) throw new TypeError('Failed to fetch');
    net.calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
    const path = String(url).split('/api/v1')[1] || '';
    if (path === '/tasks/mine') return jsonRes({ data: [{ id: 't1', key: 'ENG-1', title: 'A', columnId: 'c1' }] });
    if (/^\/tasks\/[^/]+\/move$/.test(path)) return jsonRes({ data: { id: 't1', columnId: 'c2' } });
    return jsonRes({ data: [] });
  };
}
const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const API = 'http://localhost:4000/api/v1';

describe('offline read cache + write queue + sync (integration)', () => {
  it('caches reads online, serves them stale offline, queues writes offline, and replays on reconnect', async () => {
    const storage = fakeStorage({ accessToken: 'tok' });
    const net = { online: true, calls: [] };
    const fetchImpl = makeFetch(net);
    const cache = createReadCache(storage);
    const api = createApi({ apiBase: API, storage, cache, fetchImpl });

    // 1. Online read → fresh, and cached.
    const online = await api.tasks.mine();
    expect(online.stale).toBe(false);
    expect(online.data).toHaveLength(1);

    // 2. Go offline → the same read serves the cached value, marked stale.
    net.online = false;
    const offline = await api.tasks.mine();
    expect(offline.stale).toBe(true);
    expect(offline.data).toEqual(online.data);

    // 3. A write while offline rejects (network) → the screen enqueues it.
    await expect(api.tasks.move('t1', 'c2', 0)).rejects.toBeInstanceOf(TypeError);
    await enqueue(storage, { kind: 'task.move', payload: { id: 't1', columnId: 'c2', position: 0 } });
    expect(await queueSize(storage)).toBe(1);

    // 4. Reconnect → flush replays the queued mutation to the correct endpoint; queue drains.
    net.online = true;
    net.calls = [];
    const perform = makePerformMutation((path, init) => authedFetch(storage, API, path, init, fetchImpl));
    const result = await flushQueue(storage, perform);
    expect(result).toEqual({ synced: 1, dropped: 0, remaining: 0 });
    expect(await queueSize(storage)).toBe(0);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].method).toBe('PATCH');
    expect(net.calls[0].url).toContain('/tasks/t1/move');
    expect(JSON.parse(net.calls[0].body)).toEqual({ columnId: 'c2', position: 0 });
  });

  it('surfaces an HTTP error (not offline) as ApiError so screens do NOT wrongly queue it', async () => {
    const storage = fakeStorage({ accessToken: 'tok' });
    const cache = createReadCache(storage);
    const api = createApi({ apiBase: API, storage, cache, fetchImpl: async () => jsonRes({ error: { message: 'bad' } }, 400) });
    await expect(api.tasks.create({ title: 'x' })).rejects.toBeInstanceOf(ApiError);
  });
});
