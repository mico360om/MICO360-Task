import { isTransientFailure } from './errors.js';

export const CACHE_PREFIX = 'cache:';
/** Most recently cached responses kept on the device; older ones are evicted (EXT-05). */
export const MAX_CACHE_ENTRIES = 200;

/**
 * Read-through cache for API GETs (offline support). A successful fetch is cached in the given
 * chrome.storage.local-compatible store ({ get(key|null), set(obj), remove(keys) }); when a later
 * fetch can't reach the server (offline / server down) the last cached value is returned marked
 * `stale`, so screens stay usable without a connection. Mirrors the Android app's read-cache.
 *
 * - A real HTTP answer such as 401/403/404 is NOT masked with old data (XP-01).
 * - Caching is best-effort: a failed write (e.g. storage full) never turns fresh data into an error
 *   or into stale data; it evicts old entries and retries once (EXT-05).
 */
export function createReadCache(storage, { now = Date.now, maxEntries = MAX_CACHE_ENTRIES } = {}) {
  const cacheKey = (key) => `${CACHE_PREFIX}${key}`;

  /** Keep only the `keep` most recently cached entries. Returns how many were removed. */
  async function prune(keep = maxEntries) {
    const all = (await storage.get(null)) || {};
    const entries = Object.entries(all)
      .filter(([k]) => k.startsWith(CACHE_PREFIX))
      .sort((a, b) => ((b[1] && b[1].cachedAt) || 0) - ((a[1] && a[1].cachedAt) || 0));
    const drop = entries.slice(Math.max(0, keep)).map(([k]) => k);
    if (drop.length) await storage.remove(drop);
    return drop.length;
  }

  async function save(k, env) {
    try {
      await storage.set({ [k]: env });
      return true;
    } catch {
      try {
        await prune(Math.floor(maxEntries / 2));
        await storage.set({ [k]: env });
        return true;
      } catch {
        return false;
      }
    }
  }

  async function read(key, fetcher) {
    const k = cacheKey(key);
    let data;
    try {
      data = await fetcher();
    } catch (error) {
      if (!isTransientFailure(error)) throw error;
      let env;
      try {
        const o = await storage.get(k);
        env = o && o[k];
      } catch {
        env = undefined;
      }
      if (env) return { data: env.data, stale: true, cachedAt: env.cachedAt };
      throw error;
    }
    const cachedAt = now();
    await save(k, { data, cachedAt });
    return { data, stale: false, cachedAt };
  }

  /** Return the cached value for a key without fetching (or undefined). */
  async function peek(key) {
    const k = cacheKey(key);
    const o = await storage.get(k);
    return o && o[k] ? o[k].data : undefined;
  }

  return { read, peek, prune };
}
