import { describe, it, expect } from 'vitest';
import { createReadCache } from './read-cache';
import { createMemoryStore } from './storage';

describe('createReadCache (offline read cache, A2.2)', () => {
  it('fetches fresh, caches the result, and marks it not stale', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store });
    const res = await cache.read('projects', async () => [{ id: 'p1' }]);
    expect(res).toEqual({ data: [{ id: 'p1' }], stale: false });
    expect(await store.getItem('mico360.cache.projects')).toContain('p1');
  });

  it('falls back to the cached value (stale) when the fetch fails', async () => {
    const store = createMemoryStore();
    const cache = createReadCache({ store });
    await cache.read('projects', async () => [{ id: 'p1' }]); // seed
    const res = await cache.read('projects', async () => {
      throw new Error('offline');
    });
    expect(res).toEqual({ data: [{ id: 'p1' }], stale: true });
  });

  it('rethrows when the fetch fails and nothing is cached', async () => {
    const cache = createReadCache({ store: createMemoryStore() });
    await expect(cache.read('projects', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  });
});
