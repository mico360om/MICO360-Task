import { describe, it, expect } from 'vitest';
import { createReadCache } from './read-cache.js';
import { ApiError } from './errors.js';
import { fakeStorage as plainStorage } from './test-helpers.js';

// Batch 2: copies are stamped with the person and server signed in as they were read (review #6).
const API = 'https://task.mico360.com/api/v1';
const WHO = { owner: 'u1', apiBase: API };
/** A device signed in as u1 on API, holding `init` (cache entries written with `mine`). */
const fakeStorage = (init = {}, opts) => plainStorage({ sessionUserId: 'u1', sessionApiBase: API, ...init }, opts);
const mine = (data, cachedAt) => ({ data, cachedAt, ...WHO });

describe('createReadCache', () => {
  it('caches a successful fetch and reports it fresh', async () => {
    const store = fakeStorage();
    const cache = createReadCache(store, { now: () => 1000 });
    const res = await cache.read('tasks', async () => [{ id: 't1' }]);
    expect(res).toEqual({ data: [{ id: 't1' }], stale: false, cachedAt: 1000 });
    expect(store.data['cache:tasks']).toEqual({ data: [{ id: 't1' }], cachedAt: 1000, owner: 'u1', apiBase: API });
  });

  it('returns the cached value marked stale when the server can’t be reached', async () => {
    const store = fakeStorage({ 'cache:tasks': mine([{ id: 'old' }], 500) });
    const cache = createReadCache(store);
    const res = await cache.read('tasks', async () => {
      throw new Error('offline');
    });
    expect(res.stale).toBe(true);
    expect(res.data).toEqual([{ id: 'old' }]);
    expect(res.cachedAt).toBe(500);
  });

  it('serves stale data on a 5xx (server down) too', async () => {
    const store = fakeStorage({ 'cache:tasks': mine([1], 5) });
    const res = await createReadCache(store).read('tasks', async () => { throw new ApiError(502); });
    expect(res).toMatchObject({ data: [1], stale: true });
  });

  it('XP-01: a 401/403/404 answer is NOT masked with old cached data', async () => {
    for (const status of [401, 403, 404]) {
      const store = fakeStorage({ 'cache:tasks': mine(['someone else’s'], 5) });
      await expect(createReadCache(store).read('tasks', async () => { throw new ApiError(status); })).rejects.toMatchObject({ status });
    }
  });

  it('rethrows when the fetch fails and there is no cache', async () => {
    const cache = createReadCache(fakeStorage());
    await expect(cache.read('tasks', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });

  it('EXT-05: returns fresh data even when it can’t be cached (storage full)', async () => {
    const store = fakeStorage({ 'cache:tasks': mine(['old'], 1) }, { failSet: () => true });
    const res = await createReadCache(store).read('tasks', async () => ['fresh']);
    expect(res).toMatchObject({ data: ['fresh'], stale: false });
  });

  it('EXT-05: on a failed write it evicts the oldest entries and retries', async () => {
    let failOnce = true;
    const store = fakeStorage(
      { 'cache:a': mine(1, 1), 'cache:b': mine(2, 2), 'cache:c': mine(3, 3), theme: 'dark' },
      { failSet: () => { if (failOnce) { failOnce = false; return true; } return false; } },
    );
    const cache = createReadCache(store, { now: () => 10, maxEntries: 2 });
    await cache.read('new', async () => 'n');
    expect(Object.keys(store.data).filter((k) => !k.startsWith('session')).sort()).toEqual(['cache:c', 'cache:new', 'theme']);
  });

  it('EXT-05: prune keeps only the most recent entries and never touches other keys', async () => {
    const store = plainStorage({
      'cache:a': mine(1, 1),
      'cache:b': mine(2, 3),
      'cache:c': mine(3, 2),
      syncQueue: [],
      refreshToken: 'r',
    });
    const removed = await createReadCache(store, { maxEntries: 2 }).prune();
    expect(removed).toBe(1);
    expect(Object.keys(store.data).sort()).toEqual(['cache:b', 'cache:c', 'refreshToken', 'syncQueue']);
  });

  it('peek returns the cached value without fetching', async () => {
    const store = fakeStorage({ 'cache:projects': mine([{ id: 'p1' }], 1) });
    const cache = createReadCache(store);
    expect(await cache.peek('projects')).toEqual([{ id: 'p1' }]);
    expect(await cache.peek('missing')).toBeUndefined();
  });

  it('merge updates a saved object with a newer answer (a write’s reply) and leaves anything not saved alone', async () => {
    const store = fakeStorage({ 'cache:task:t1': mine({ id: 't1', title: 'A', version: 2, meeting: null }, 1) });
    const cache = createReadCache(store, { now: () => 50 });
    expect(await cache.merge('task:t1', { id: 't1', title: 'B', version: 3 })).toBe(true);
    expect(store.data['cache:task:t1']).toEqual({ data: { id: 't1', title: 'B', version: 3, meeting: null }, cachedAt: 50, ...WHO });
    expect(await cache.merge('task:t9', { id: 't9' })).toBe(false);
    expect(store.data['cache:task:t9']).toBeUndefined();
  });
});
