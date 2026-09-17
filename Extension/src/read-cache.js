/**
 * Read-through cache for API GETs (offline support). A successful fetch is cached in the given
 * chrome.storage.local-compatible store ({ get(key) -> {key:val}, set(obj) }); when a later fetch
 * fails (offline / server down) the last cached value is returned marked `stale`, so screens stay
 * usable without a connection. Mirrors the Android app's read-cache.
 */
export function createReadCache(storage, { now = Date.now } = {}) {
  const cacheKey = (key) => `cache:${key}`;

  async function read(key, fetcher) {
    const k = cacheKey(key);
    try {
      const data = await fetcher();
      await storage.set({ [k]: { data, cachedAt: now() } });
      return { data, stale: false, cachedAt: now() };
    } catch (error) {
      const o = await storage.get(k);
      const env = o && o[k];
      if (env) return { data: env.data, stale: true, cachedAt: env.cachedAt };
      throw error;
    }
  }

  /** Return the cached value for a key without fetching (or undefined). */
  async function peek(key) {
    const k = cacheKey(key);
    const o = await storage.get(k);
    return o && o[k] ? o[k].data : undefined;
  }

  return { read, peek };
}
