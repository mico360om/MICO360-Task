import type { KeyValueStore } from './storage';

export interface CachedRead<T> {
  data: T;
  /** True when the value came from cache because the live fetch failed (offline). */
  stale: boolean;
}

interface CacheEnvelope<T> {
  data: T;
  cachedAt: number;
}

/**
 * Read-through cache for API GETs (A2.2). A successful fetch is cached; when a
 * later fetch fails (offline) the last cached value is returned marked stale, so
 * screens stay usable without a connection.
 */
export function createReadCache({ store, now = Date.now }: { store: KeyValueStore; now?: () => number }) {
  const cacheKey = (key: string) => `mico360.cache.${key}`;

  async function read<T>(key: string, fetcher: () => Promise<T>): Promise<CachedRead<T>> {
    try {
      const data = await fetcher();
      const envelope: CacheEnvelope<T> = { data, cachedAt: now() };
      await store.setItem(cacheKey(key), JSON.stringify(envelope));
      return { data, stale: false };
    } catch (error) {
      const raw = await store.getItem(cacheKey(key));
      if (raw) {
        const envelope = JSON.parse(raw) as CacheEnvelope<T>;
        return { data: envelope.data, stale: true };
      }
      throw error;
    }
  }

  return { read };
}

export type ReadCache = ReturnType<typeof createReadCache>;
