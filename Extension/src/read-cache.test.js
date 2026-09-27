import { describe, it, expect } from 'vitest';
import { createReadCache } from './read-cache.js';
import { ApiError } from './errors.js';
import { fakeStorage } from './test-helpers.js';

describe('createReadCache', () => {
  it('caches a successful fetch and reports it fresh', async () => {
    const store = fakeStorage();
    const cache = createReadCache(store, { now: () => 1000 });
    const res = await cache.read('tasks', async () => [{ id: 't1' }]);
    expect(res).toEqual({ data: [{ id: 't1' }], stale: false, cachedAt: 1000 });
    expect(store.data['cache:tasks']).toEqual({ data: [{ id: 't1' }], cachedAt: 1000 });
  });

  it('returns the cached value marked stale when the server can’t be reached', async () => {
    const store = fakeStorage({ 'cache:tasks': { data: [{ id: 'old' }], cachedAt: 500 } });
    const cache = createReadCache(store);
    const res = await cache.read('tasks', async () => {
      throw new Error('offline');
    });
    expect(res.stale).toBe(true);
    expect(res.data).toEqual([{ id: 'old' }]);
    expect(res.cachedAt).toBe(500);
  });

  it('serves stale data on a 5xx (server down) too', async () => {
    const store = fakeStorage({ 'cache:tasks': { data: [1], cachedAt: 5 } });
    const res = await createReadCache(store).read('tasks', async () => { throw new ApiError(502); });
    expect(res).toMatchObject({ data: [1], stale: true });
  });

  it('XP-01: a 401/403/404 answer is NOT masked with old cached data', async () => {
    for (const status of [401, 403, 404]) {
      const store = fakeStorage({ 'cache:tasks': { data: ['someone else’s'], cachedAt: 5 } });
      await expect(createReadCache(store).read('tasks', async () => { throw new ApiError(status); })).rejects.toMatchObject({ status });
    }
  });

  it('rethrows when the fetch fails and there is no cache', async () => {
    const cache = createReadCache(fakeStorage());
    await expect(cache.read('tasks', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });

  it('EXT-05: returns fresh data even when it can’t be cached (storage full)', async () => {
    const store = fakeStorage({ 'cache:tasks': { data: ['old'], cachedAt: 1 } }, { failSet: () => true });
    const res = await createReadCache(store).read('tasks', async () => ['fresh']);
    expect(res).toMatchObject({ data: ['fresh'], stale: false });
  });

  it('EXT-05: on a failed write it evicts the oldest entries and retries', async () => {
    let failOnce = true;
    const store = fakeStorage(
      { 'cache:a': { data: 1, cachedAt: 1 }, 'cache:b': { data: 2, cachedAt: 2 }, 'cache:c': { data: 3, cachedAt: 3 }, theme: 'dark' },
      { failSet: () => { if (failOnce) { failOnce = false; return true; } return false; } },
    );
    const cache = createReadCache(store, { now: () => 10, maxEntries: 2 });
    await cache.read('new', async () => 'n');
    expect(Object.keys(store.data).sort()).toEqual(['cache:c', 'cache:new', 'theme']);
  });

  it('EXT-05: prune keeps only the most recent entries and never touches other keys', async () => {
    const store = fakeStorage({
      'cache:a': { data: 1, cachedAt: 1 },
      'cache:b': { data: 2, cachedAt: 3 },
      'cache:c': { data: 3, cachedAt: 2 },
      syncQueue: [],
      refreshToken: 'r',
    });
    const removed = await createReadCache(store, { maxEntries: 2 }).prune();
    expect(removed).toBe(1);
    expect(Object.keys(store.data).sort()).toEqual(['cache:b', 'cache:c', 'refreshToken', 'syncQueue']);
  });

  it('peek returns the cached value without fetching', async () => {
    const store = fakeStorage({ 'cache:projects': { data: [{ id: 'p1' }], cachedAt: 1 } });
    const cache = createReadCache(store);
    expect(await cache.peek('projects')).toEqual([{ id: 'p1' }]);
    expect(await cache.peek('missing')).toBeUndefined();
  });
});
