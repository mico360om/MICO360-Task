import { describe, it, expect, vi } from 'vitest';
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
    await cache.settled();
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
    await cache.settled();
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
    await cache.settled();
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

describe('createReadCache: the copy is written after the screen has its data (1c)', () => {
  /** Runs the deferred writes only when told to, like a busy phone. */
  function heldWrites() {
    const runs: (() => void)[] = [];
    return { defer: (run: () => void) => runs.push(run), release: () => runs.splice(0).forEach((r) => r()) };
  }

  it('hands back the data without waiting for storage', async () => {
    const store = createMemoryStore();
    const held = heldWrites();
    const cache = createReadCache({ store, getUserId: () => 'u1', defer: held.defer });
    await expect(cache.read('projects', async () => [{ id: 'p1' }])).resolves.toEqual({ data: [{ id: 'p1' }], stale: false });
    expect(await store.keys()).toEqual([]);
    held.release();
    await cache.settled();
    expect(await store.getItem('mico360.cache.u1.projects')).toContain('p1');
  });

  it('offline right after a fetch, serves the copy not written yet', async () => {
    const held = heldWrites();
    const cache = createReadCache({ store: createMemoryStore(), getUserId: () => 'u1', defer: held.defer });
    await cache.read('projects', async () => [{ id: 'p1' }]);
    expect(await cache.read('projects', offline)).toEqual({ data: [{ id: 'p1' }], stale: true });
  });

  it('writes only the newest of several fetches of one list', async () => {
    const store = createMemoryStore();
    const setItem = vi.spyOn(store, 'setItem');
    const held = heldWrites();
    const cache = createReadCache({ store, getUserId: () => 'u1', defer: held.defer });
    await cache.read('tasks.mine', async () => [{ id: 'old' }]);
    await cache.read('tasks.mine', async () => [{ id: 'new' }]);
    held.release();
    await cache.settled();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(await store.getItem('mico360.cache.u1.tasks.mine')).toContain('new');
  });

  it('never writes a copy after sign-out cleared the cache', async () => {
    const store = createMemoryStore();
    const held = heldWrites();
    const cache = createReadCache({ store, getUserId: () => 'u1', defer: held.defer });
    await cache.read('tasks.mine', async () => [{ id: 't1' }]);
    await cache.clear();
    held.release();
    await cache.settled();
    expect(await store.keys()).toEqual([]);
    await expect(cache.read('tasks.mine', offline)).rejects.toThrow('offline');
  });
});

describe('createReadCache: a capped offline copy (1c)', () => {
  const isDay = (key: string) => /^tasks\.[^.]+\.\d{4}-\d{2}-\d{2}$/.test(key);
  const cached = async (store: ReturnType<typeof createMemoryStore>) =>
    (await store.keys()).filter((k) => !k.endsWith('~rolling')).sort();

  it('keeps only the most recently loaded board days, per user', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store, getUserId: () => 'u1', rolling: { matches: isDay, keep: 2 } });
    await cache.read('tasks.p1.2026-10-19', async () => []);
    await cache.read('tasks.p1.2026-10-20', async () => []);
    await cache.read('tasks.p1.all', async () => []);
    await cache.read('tasks.p2.2026-10-21', async () => []);
    await cache.settled();
    expect(await cached(store)).toEqual(['mico360.cache.u1.tasks.p1.2026-10-20', 'mico360.cache.u1.tasks.p1.all', 'mico360.cache.u1.tasks.p2.2026-10-21']);
    // Looking at a day again keeps it; the one looked at longest ago goes.
    await cache.read('tasks.p1.2026-10-20', async () => []);
    await cache.read('tasks.p3.2026-10-21', async () => []);
    await cache.settled();
    expect(await cached(store)).toEqual(['mico360.cache.u1.tasks.p1.2026-10-20', 'mico360.cache.u1.tasks.p1.all', 'mico360.cache.u1.tasks.p3.2026-10-21']);
  });

  it('remembers the order across app starts, and counts the days an older version left behind', async () => {
    const store = createMemoryStore({
      'mico360.cache.u1.tasks.p1.2026-09-01': '{}',
      'mico360.cache.u1.tasks.p1.2026-09-02': '{}',
      'mico360.cache.u2.tasks.p1.2026-09-01': '{}',
    });
    const first = createReadCache({ store, getUserId: () => 'u1', rolling: { matches: isDay, keep: 2 } });
    await first.read('tasks.p1.2026-10-21', async () => []);
    await first.settled();
    expect(await cached(store)).toEqual(['mico360.cache.u1.tasks.p1.2026-09-02', 'mico360.cache.u1.tasks.p1.2026-10-21', 'mico360.cache.u2.tasks.p1.2026-09-01']);
    const next = createReadCache({ store, getUserId: () => 'u1', rolling: { matches: isDay, keep: 2 } });
    await next.read('tasks.p2.2026-10-21', async () => []);
    await next.settled();
    expect(await cached(store)).toEqual(['mico360.cache.u1.tasks.p1.2026-10-21', 'mico360.cache.u1.tasks.p2.2026-10-21', 'mico360.cache.u2.tasks.p1.2026-09-01']);
  });

  it('slims a copy too big to keep, or doesn’t keep it (and drops the older one)', async () => {
    const store = createMemoryStore({ 'mico360.cache.u1.tasks.mine': '{"data":[{"id":"older"}],"cachedAt":1}' });
    const cache = createReadCache({ store, getUserId: () => 'u1', maxChars: 200 });
    const big = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, done: i > 0 }));
    await cache.read('tasks.mine', async () => big, { slim: (tasks) => tasks.filter((t) => !t.done) });
    await cache.settled();
    expect(JSON.parse((await store.getItem('mico360.cache.u1.tasks.mine'))!).data).toEqual([{ id: 't0', done: false }]);
    await cache.read('tasks.mine', async () => big);
    await cache.settled();
    expect(await store.getItem('mico360.cache.u1.tasks.mine')).toBeNull();
  });

  it('clear() also forgets the board-day order', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store, getUserId: () => 'u1', rolling: { matches: isDay, keep: 1 } });
    await cache.read('tasks.p1.2026-10-20', async () => []);
    await cache.settled();
    await cache.clear();
    expect(await store.keys()).toEqual([]);
    await cache.read('tasks.p1.2026-10-21', async () => []);
    await cache.settled();
    expect(await store.keys()).toEqual(['mico360.cache.u1.tasks.p1.2026-10-21', 'mico360.cache.u1.~rolling']);
  });
});
