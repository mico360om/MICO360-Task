import { describe, it, expect } from 'vitest';
import { createReadCache } from './read-cache.js';

/** In-memory chrome.storage.local shim: get(key)->{key:val}, set(obj). */
function fakeStorage(init = {}) {
  const data = { ...init };
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (obj) => Object.assign(data, obj),
  };
}

describe('createReadCache', () => {
  it('caches a successful fetch and reports it fresh', async () => {
    const store = fakeStorage();
    const cache = createReadCache(store, { now: () => 1000 });
    const res = await cache.read('tasks', async () => [{ id: 't1' }]);
    expect(res).toEqual({ data: [{ id: 't1' }], stale: false, cachedAt: 1000 });
    expect(store.data['cache:tasks']).toEqual({ data: [{ id: 't1' }], cachedAt: 1000 });
  });

  it('returns the cached value marked stale when the fetch fails', async () => {
    const store = fakeStorage({ 'cache:tasks': { data: [{ id: 'old' }], cachedAt: 500 } });
    const cache = createReadCache(store);
    const res = await cache.read('tasks', async () => {
      throw new Error('offline');
    });
    expect(res.stale).toBe(true);
    expect(res.data).toEqual([{ id: 'old' }]);
    expect(res.cachedAt).toBe(500);
  });

  it('rethrows when the fetch fails and there is no cache', async () => {
    const cache = createReadCache(fakeStorage());
    await expect(cache.read('tasks', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });

  it('peek returns the cached value without fetching', async () => {
    const store = fakeStorage({ 'cache:projects': { data: [{ id: 'p1' }], cachedAt: 1 } });
    const cache = createReadCache(store);
    expect(await cache.peek('projects')).toEqual([{ id: 'p1' }]);
    expect(await cache.peek('missing')).toBeUndefined();
  });
});
