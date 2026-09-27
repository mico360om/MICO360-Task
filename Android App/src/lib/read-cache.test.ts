import { describe, it, expect } from 'vitest';
import { createReadCache } from './read-cache';
import { createMemoryStore } from './storage';
import { ApiError, NetworkError } from './api-client';

const offline = async (): Promise<never> => {
  throw new NetworkError('offline');
};

describe('createReadCache (offline read cache, A2.2 / XP-01)', () => {
  it('fetches fresh, caches the result under the user id, and marks it not stale', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store, getUserId: () => 'u1' });
    const res = await cache.read('projects', async () => [{ id: 'p1' }]);
    expect(res).toEqual({ data: [{ id: 'p1' }], stale: false });
    expect(await store.getItem('mico360.cache.u1.projects')).toContain('p1');
  });

  it('falls back to the cached value (stale) when the device is offline', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store, getUserId: () => 'u1' });
    await cache.read('projects', async () => [{ id: 'p1' }]); // seed
    const res = await cache.read('projects', offline);
    expect(res).toEqual({ data: [{ id: 'p1' }], stale: true });
  });

  it('does NOT fall back on a server answer such as 401 / 403 / 500', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store, getUserId: () => 'u1' });
    await cache.read('projects', async () => [{ id: 'p1' }]);
    for (const status of [401, 403, 500]) {
      await expect(
        cache.read('projects', async () => {
          throw new ApiError(status, 'X', 'nope');
        }),
      ).rejects.toBeInstanceOf(ApiError);
    }
  });

  it('never serves one user’s cache to another user', async () => {
    const store = createMemoryStore();
    let user = 'alice';
    const cache = createReadCache({ store, getUserId: () => user });
    await cache.read('tasks.mine', async () => [{ id: 'alice-task' }]);
    user = 'bob';
    await expect(cache.read('tasks.mine', offline)).rejects.toBeInstanceOf(NetworkError);
  });

  it('caches nothing while signed out', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store, getUserId: () => null });
    await cache.read('projects', async () => [{ id: 'p1' }]);
    expect(await store.keys()).toEqual([]);
  });

  it('does not store a response that arrives after the user signed out', async () => {
    const store = createMemoryStore();
    let user: string | null = 'u1';
    const cache = createReadCache({ store, getUserId: () => user });
    await cache.read('projects', async () => {
      user = null; // signed out mid-request
      return [{ id: 'p1' }];
    });
    expect(await store.keys()).toEqual([]);
  });

  it('rethrows when the fetch fails and nothing is cached', async () => {
    const cache = createReadCache({ store: createMemoryStore(), getUserId: () => 'u1' });
    await expect(cache.read('projects', offline)).rejects.toThrow('offline');
  });

  it('clear() deletes every mico360.cache.* entry (all users, legacy keys) and nothing else', async () => {
    const store = createMemoryStore({
      'mico360.cache.u1.projects': '{}',
      'mico360.cache.u2.tasks.mine': '{}',
      'mico360.cache.notifications': '{}',
      'mico360.themeMode': 'dark',
    });
    const cache = createReadCache({ store, getUserId: () => 'u1' });
    await cache.clear();
    expect(await store.keys()).toEqual(['mico360.themeMode']);
  });
});
