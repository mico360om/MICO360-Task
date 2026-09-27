import type { KeyValueStore } from './storage';
import { isNetworkError } from './api-client';

export interface CachedRead<T> {
  data: T;
  /** True when the value came from cache because the live fetch failed (offline). */
  stale: boolean;
}

interface CacheEnvelope<T> {
  data: T;
  cachedAt: number;
}

/** Every read-cache entry lives under this prefix (sign-out deletes all of them). */
export const CACHE_PREFIX = 'mico360.cache.';

export interface ReadCacheOptions {
  store: KeyValueStore;
  /** The signed-in user's id. Entries are stored per user; nothing is cached while signed out. */
  getUserId: () => string | null | undefined;
  /** Which failures may be answered from cache (default: network errors / timeouts only). */
  canFallBack?: (error: unknown) => boolean;
  now?: () => number;
}

/**
 * Read-through cache for API GETs (A2.2, XP-01). A successful fetch is cached under the signed-in
 * user's id; when a later fetch fails because the device is offline, that user's last cached value
 * is returned marked stale, so screens stay usable without a connection.
 *
 * A server answer (401, 403, 404, 5xx …) is never papered over with cached data, and one user can
 * never be shown another user's cache: keys are `mico360.cache.<userId>.<key>`.
 */
export function createReadCache({ store, getUserId, canFallBack = isNetworkError, now = Date.now }: ReadCacheOptions) {
  const cacheKey = (userId: string, key: string) => `${CACHE_PREFIX}${userId}.${key}`;

  async function read<T>(key: string, fetcher: () => Promise<T>): Promise<CachedRead<T>> {
    const userId = getUserId();
    try {
      const data = await fetcher();
      // Re-check the owner: the user may have signed out while the request was in flight.
      if (userId && getUserId() === userId) {
        const envelope: CacheEnvelope<T> = { data, cachedAt: now() };
        await store.setItem(cacheKey(userId, key), JSON.stringify(envelope)).catch(() => {});
      }
      return { data, stale: false };
    } catch (error) {
      if (userId && canFallBack(error)) {
        const raw = await store.getItem(cacheKey(userId, key)).catch(() => null);
        if (raw) {
          try {
            const envelope = JSON.parse(raw) as CacheEnvelope<T>;
            return { data: envelope.data, stale: true };
          } catch {
            /* corrupt entry — fall through to the original error */
          }
        }
      }
      throw error;
    }
  }

  /** Delete every cached entry for every user (and legacy un-prefixed entries). */
  async function clear(): Promise<void> {
    if (!store.keys) return;
    const keys = await store.keys().catch(() => [] as string[]);
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => store.deleteItem(k).catch(() => {})));
  }

  return { read, clear };
}

export type ReadCache = ReturnType<typeof createReadCache>;
