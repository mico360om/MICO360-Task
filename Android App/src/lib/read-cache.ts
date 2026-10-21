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

/**
 * Android reads at most about 2 MB of one stored value back (a longer one can be written but never
 * read); a copy longer than this many characters is slimmed, or not kept.
 */
export const MAX_COPY_CHARS = 800_000;

export interface ReadCacheOptions {
  store: KeyValueStore;
  /** The signed-in user's id. Entries are stored per user; nothing is cached while signed out. */
  getUserId: () => string | null | undefined;
  /** Which failures may be answered from cache (default: network errors / timeouts only). */
  canFallBack?: (error: unknown) => boolean;
  now?: () => number;
  /** When the copy is written: after the screen has its data (default: the next turn, setTimeout 0). */
  defer?: (run: () => void) => void;
  /**
   * Keys that pile up, one per day looked at (board days): only the `keep` most recently loaded of
   * them are kept per user, the rest are deleted.
   */
  rolling?: { matches: (key: string) => boolean; keep: number };
  /** The longest copy kept, in characters (default MAX_COPY_CHARS). */
  maxChars?: number;
}

export interface ReadOptions<T> {
  /** A smaller copy to keep when the whole one is too long (e.g. without old finished tasks). */
  slim?: (data: T) => T;
}

interface Waiting {
  userId: string;
  key: string;
  envelope: CacheEnvelope<unknown>;
  slim?: (data: unknown) => unknown;
  /** Which clear() it belongs after: a copy from before a sign-out is never written. */
  generation: number;
}

/**
 * Read-through cache for API GETs (A2.2, XP-01). A successful fetch is cached under the signed-in
 * user's id; when a later fetch fails because the device is offline, that user's last cached value
 * is returned marked stale, so screens stay usable without a connection.
 *
 * A server answer (401, 403, 404, 5xx …) is never papered over with cached data, and one user can
 * never be shown another user's cache: keys are `mico360.cache.<userId>.<key>`.
 *
 * The copy is written after the data is handed back (1c): the screen never waits for it to be
 * turned into text and stored, several fetches of one list in a row write only the newest, and a
 * copy not written yet still answers an offline read. Board days are capped (`rolling`), and a copy
 * too long to read back is slimmed or not kept.
 */
export function createReadCache({
  store,
  getUserId,
  canFallBack = isNetworkError,
  now = Date.now,
  defer = (run) => void setTimeout(run, 0),
  rolling,
  maxChars = MAX_COPY_CHARS,
}: ReadCacheOptions) {
  const cacheKey = (userId: string, key: string) => `${CACHE_PREFIX}${userId}.${key}`;
  const rollingKey = (userId: string) => `${CACHE_PREFIX}${userId}.~rolling`;

  /** The newest copy of each entry that isn't written yet, by storage key. */
  const waiting = new Map<string, Waiting>();
  let generation = 0;
  let scheduled = false;
  /** Writes run one after another; clear() and settled() wait for the one in progress. */
  let writing: Promise<void> = Promise.resolve();
  /** Each user's board days, loaded longest ago first (read from storage once). */
  const days = new Map<string, string[]>();

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    defer(() => {
      scheduled = false;
      writing = writing.then(writeWaiting, writeWaiting);
    });
  }

  /** The copy as stored: whole, slimmed when too long, or null when even that is too long. */
  function encode(w: Waiting): string | null {
    let text = JSON.stringify(w.envelope);
    if (text.length > maxChars && w.slim) text = JSON.stringify({ ...w.envelope, data: w.slim(w.envelope.data) });
    return text.length > maxChars ? null : text;
  }

  async function writeWaiting(): Promise<void> {
    for (const [storageKey, w] of [...waiting]) {
      // Signed out (or someone else signed in) since: never write it.
      if (w.generation !== generation || getUserId() !== w.userId) {
        if (waiting.get(storageKey) === w) waiting.delete(storageKey);
        continue;
      }
      try {
        const text = encode(w);
        // Too long to read back: the older copy goes too, so storage stays small.
        if (text === null) await store.deleteItem(storageKey);
        else await store.setItem(storageKey, text);
        if (text !== null && rolling?.matches(w.key)) await noteDay(w.userId, w.key, w.generation);
      } catch {
        /* storage full or unavailable — the screen already has its data */
      }
      if (waiting.get(storageKey) === w) waiting.delete(storageKey);
    }
  }

  async function dayOrder(userId: string, gen: number): Promise<string[]> {
    const known = days.get(userId);
    if (known) return known;
    let order: string[] | null = null;
    try {
      const parsed: unknown = JSON.parse((await store.getItem(rollingKey(userId))) ?? 'null');
      if (Array.isArray(parsed)) order = parsed.filter((k): k is string => typeof k === 'string');
    } catch {
      /* missing or unreadable — rebuilt below */
    }
    if (!order) {
      // First time (or from an older version): the days already stored, earliest first.
      const mine = `${CACHE_PREFIX}${userId}.`;
      const keys = store.keys ? await store.keys().catch(() => [] as string[]) : [];
      order = keys.filter((k) => k.startsWith(mine)).map((k) => k.slice(mine.length)).filter((k) => rolling!.matches(k)).sort();
    }
    // A sign-out while this was read cleared the cache: don't bring the old order back.
    if (gen === generation) days.set(userId, order);
    return order;
  }

  /** This board day was just stored: it is now the newest; the ones beyond `keep` go. */
  async function noteDay(userId: string, key: string, gen: number): Promise<void> {
    const order = await dayOrder(userId, gen);
    if (gen !== generation) return;
    const at = order.indexOf(key);
    if (at >= 0) order.splice(at, 1);
    order.push(key);
    const dropped = order.splice(0, Math.max(0, order.length - rolling!.keep));
    for (const old of dropped) await store.deleteItem(cacheKey(userId, old)).catch(() => {});
    await store.setItem(rollingKey(userId), JSON.stringify(order)).catch(() => {});
  }

  async function read<T>(key: string, fetcher: () => Promise<T>, opts: ReadOptions<T> = {}): Promise<CachedRead<T>> {
    const userId = getUserId();
    try {
      const data = await fetcher();
      // Re-check the owner: the user may have signed out while the request was in flight.
      if (userId && getUserId() === userId) {
        waiting.set(cacheKey(userId, key), {
          userId,
          key,
          envelope: { data, cachedAt: now() },
          slim: opts.slim as ((data: unknown) => unknown) | undefined,
          generation,
        });
        schedule();
      }
      return { data, stale: false };
    } catch (error) {
      if (userId && canFallBack(error)) {
        const unwritten = waiting.get(cacheKey(userId, key));
        if (unwritten && unwritten.generation === generation) return { data: unwritten.envelope.data as T, stale: true };
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
    generation += 1;
    waiting.clear();
    days.clear();
    await writing;
    if (!store.keys) return;
    const keys = await store.keys().catch(() => [] as string[]);
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => store.deleteItem(k).catch(() => {})));
  }

  /** Write the copies waiting now, without waiting for their turn (tests; nothing in the app waits for it). */
  async function settled(): Promise<void> {
    writing = writing.then(writeWaiting, writeWaiting);
    await writing;
  }

  return { read, clear, settled };
}

export type ReadCache = ReturnType<typeof createReadCache>;
