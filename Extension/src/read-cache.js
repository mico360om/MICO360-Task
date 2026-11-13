import { isTransientFailure } from './errors.js';

export const CACHE_PREFIX = 'cache:';
/**
 * Most recently cached responses kept on the device; older ones are evicted (EXT-05). Chrome gives
 * the extension unlimited storage, but a disk can still be full: a write that doesn't fit drops the
 * older half and tries again, and a change waiting to sync is never refused for these copies
 * (queue.js makes room for it).
 */
export const MAX_CACHE_ENTRIES = 200;

/** Keep only the `keep` most recently cached responses in `storage`. Resolves how many were removed. */
export async function pruneCache(storage, keep = MAX_CACHE_ENTRIES) {
  const all = (await storage.get(null)) || {};
  const entries = Object.entries(all)
    .filter(([k]) => k.startsWith(CACHE_PREFIX))
    .sort((a, b) => ((b[1] && b[1].cachedAt) || 0) - ((a[1] && a[1].cachedAt) || 0));
  const drop = entries.slice(Math.max(0, keep)).map(([k]) => k);
  if (drop.length) await storage.remove(drop);
  return drop.length;
}

/**
 * Whose session the extension holds now, as each saved copy is stamped (batch 2, review #6): the person
 * and the server, from the session kept in chrome.storage.local (null when nobody is signed in).
 */
async function sessionStamp(storage) {
  try {
    const o = (await storage.get(['sessionUserId', 'sessionApiBase'])) || {};
    return { owner: o.sessionUserId || null, apiBase: o.sessionApiBase || null };
  } catch {
    return { owner: null, apiBase: null };
  }
}

/**
 * A saved copy is the stamped person's, on the stamped server: served, peeked and changed only for them.
 * A copy kept by an older version carries no stamp — whose it is can't be told — so it is never used
 * (it is replaced on the next read, or pruned).
 */
const stampedFor = (env, who) => !!env && 'owner' in env && env.owner === who.owner && env.apiBase === who.apiBase;
const sameHolder = (a, b) => a.owner === b.owner && a.apiBase === b.apiBase;

/**
 * Read-through cache for API GETs (offline support). A successful fetch is cached in the given
 * chrome.storage.local-compatible store ({ get(key|null), set(obj), remove(keys) }); when a later
 * fetch can't reach the server (offline / server down) the last cached value is returned marked
 * `stale`, so screens stay usable without a connection. Mirrors the Android app's read-cache.
 *
 * - A real HTTP answer such as 401/403/404 is NOT masked with old data (XP-01).
 * - Caching is best-effort: a failed write (e.g. storage full) never turns fresh data into an error
 *   or into stale data; it evicts old entries and retries once (EXT-05).
 * - Batch 2 (review #6): each copy is stamped `{ owner, apiBase }` — the person and server signed in as
 *   it was read — and only ever served to them. An answer that comes back after the session changed
 *   (signed out, someone else signed in, another server) is handed to its caller but never saved.
 *   `whose()` tells the session now (default: the one kept in `storage`).
 */
export function createReadCache(storage, { now = Date.now, maxEntries = MAX_CACHE_ENTRIES, whose = () => sessionStamp(storage) } = {}) {
  const cacheKey = (key) => `${CACHE_PREFIX}${key}`;

  /** Keep only the `keep` most recently cached entries. Returns how many were removed. */
  const prune = (keep = maxEntries) => pruneCache(storage, keep);

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
    const asked = await whose();
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
      // Only the copy of the person (and server) who asked — and still holds the session now.
      if (stampedFor(env, asked) && sameHolder(asked, await whose())) return { data: env.data, stale: true, cachedAt: env.cachedAt };
      throw error;
    }
    const cachedAt = now();
    const held = await whose();
    // The session changed while it was on its way: the answer is its caller's, but never saved for the next person.
    if (sameHolder(asked, held)) await save(k, { data, cachedAt, owner: held.owner, apiBase: held.apiBase });
    return { data, stale: false, cachedAt };
  }

  /** Return the cached value for a key without fetching (or undefined) — only the signed-in person's own. */
  async function peek(key) {
    const k = cacheKey(key);
    const o = await storage.get(k);
    const env = o && o[k];
    return stampedFor(env, await whose()) ? env.data : undefined;
  }

  /**
   * Update a saved object with a newer answer from the server (a write's reply, e.g. a task at the
   * version the write made), keeping the fields the reply doesn't carry. Only a key already saved is
   * touched. Resolves true when it was updated. Best effort, like every cache write.
   */
  async function merge(key, patch) {
    const k = cacheKey(key);
    try {
      const o = await storage.get(k);
      const env = o && o[k];
      const who = await whose();
      if (!stampedFor(env, who) || !env.data || typeof env.data !== 'object' || Array.isArray(env.data)) return false;
      return save(k, { data: { ...env.data, ...patch }, cachedAt: now(), owner: who.owner, apiBase: who.apiBase });
    } catch {
      return false;
    }
  }

  /**
   * Change a saved answer (a list too) with `change(data)`, which returns the new data or undefined
   * to leave it. Only a key already saved is touched. Resolves true when it was updated. Best effort.
   */
  async function update(key, change) {
    const k = cacheKey(key);
    try {
      const o = await storage.get(k);
      const env = o && o[k];
      const who = await whose();
      if (!stampedFor(env, who) || env.data == null) return false;
      const data = change(env.data);
      if (data === undefined) return false;
      return save(k, { data, cachedAt: env.cachedAt, owner: who.owner, apiBase: who.apiBase });
    } catch {
      return false;
    }
  }

  return { read, peek, prune, merge, update };
}
