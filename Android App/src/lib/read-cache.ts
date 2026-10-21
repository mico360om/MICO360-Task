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
   * Keys that pile up, one per thing looked at (board days, chat threads): of each group only the
   * `keep` most recently loaded are kept per user, the rest are deleted.
   */
  rolling?: RollingGroup | RollingGroup[];
  /** The longest copy kept, in characters (default MAX_COPY_CHARS). */
  maxChars?: number;
}

/** One kind of copy that piles up, capped on its own. */
export interface RollingGroup {
  matches: (key: string) => boolean;
  keep: number;
  /** Names the stored order (the first group without a name keeps the original `~rolling`). */
  name?: string;
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
  const groups: RollingGroup[] = rolling ? (Array.isArray(rolling) ? rolling : [rolling]) : [];
  const rollingKey = (userId: string, group: RollingGroup) => `${CACHE_PREFIX}${userId}.~rolling${group.name ? `.${group.name}` : ''}`;
  const groupOf = (key: string): RollingGroup | undefined => groups.find((g) => g.matches(key));

  /** The newest copy of each entry that isn't written yet, by storage key. */
  const waiting = new Map<string, Waiting>();
  let generation = 0;
  let scheduled = false;
  /** Writes run one after another; clear() and settled() wait for the one in progress. */
  let writing: Promise<void> = Promise.resolve();
  /** Each user's copies of each group, loaded longest ago first (read from storage once). */
  const days = new Map<string, string[]>();
  const orderId = (userId: string, group: RollingGroup) => `${groups.indexOf(group)}|${userId}`;

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
        const group = text !== null ? groupOf(w.key) : undefined;
        if (group) await noteDay(w.userId, w.key, w.generation, group);
      } catch {
        /* storage full or unavailable — the screen already has its data */
      }
      if (waiting.get(storageKey) === w) waiting.delete(storageKey);
    }
  }

  async function dayOrder(userId: string, gen: number, group: RollingGroup): Promise<string[]> {
    const known = days.get(orderId(userId, group));
    if (known) return known;
    let order: string[] | null = null;
    try {
      const parsed: unknown = JSON.parse((await store.getItem(rollingKey(userId, group))) ?? 'null');
      if (Array.isArray(parsed)) order = parsed.filter((k): k is string => typeof k === 'string');
    } catch {
      /* missing or unreadable — rebuilt below */
    }
    if (!order) {
      // First time (or from an older version): the days already stored, earliest first.
      const mine = `${CACHE_PREFIX}${userId}.`;
      const keys = store.keys ? await store.keys().catch(() => [] as string[]) : [];
      order = keys.filter((k) => k.startsWith(mine)).map((k) => k.slice(mine.length)).filter((k) => group.matches(k)).sort();
    }
    // A sign-out while this was read cleared the cache: don't bring the old order back.
    if (gen === generation) days.set(orderId(userId, group), order);
    return order;
  }

  /** This copy (a board day, a chat thread) was just stored: it is now its group's newest; the ones beyond `keep` go. */
  async function noteDay(userId: string, key: string, gen: number, group: RollingGroup): Promise<void> {
    const order = await dayOrder(userId, gen, group);
    if (gen !== generation) return;
    const at = order.indexOf(key);
    if (at >= 0) order.splice(at, 1);
    order.push(key);
    const dropped = order.splice(0, Math.max(0, order.length - group.keep));
    for (const old of dropped) await store.deleteItem(cacheKey(userId, old)).catch(() => {});
    await store.setItem(rollingKey(userId, group), JSON.stringify(order)).catch(() => {});
  }

  /** Hold this user's newest copy of an entry, to be written after the screen has its data. */
  function hold(userId: string, key: string, data: unknown, slim?: (data: unknown) => unknown): void {
    waiting.set(cacheKey(userId, key), { userId, key, envelope: { data, cachedAt: now() }, slim, generation });
    schedule();
  }

  async function read<T>(key: string, fetcher: () => Promise<T>, opts: ReadOptions<T> = {}): Promise<CachedRead<T>> {
    const userId = getUserId();
    try {
      const data = await fetcher();
      // Re-check the owner: the user may have signed out while the request was in flight.
      if (userId && getUserId() === userId) hold(userId, key, data, opts.slim as ((data: unknown) => unknown) | undefined);
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

  /**
   * Keep a copy without a fetch: what the screen shows after changes put in place (a chat thread
   * with the messages that arrived live, 3a). Nothing is kept while signed out.
   */
  function keep<T>(key: string, data: T, opts: ReadOptions<T> = {}): void {
    const userId = getUserId();
    if (userId) hold(userId, key, data, opts.slim as ((data: unknown) => unknown) | undefined);
  }

  /**
   * Change a kept copy in place — the newest waiting to be written, else the stored one — without a
   * fetch (3a review: a chat message deleted or edited while its thread isn't open must not stay on
   * the phone as it was). A copy that isn't there stays missing; nothing is changed while signed out.
   */
  async function revise<T>(key: string, change: (data: T) => T): Promise<void> {
    const userId = getUserId();
    if (!userId) return;
    const gen = generation;
    const unwritten = waiting.get(cacheKey(userId, key));
    if (unwritten && unwritten.generation === gen) {
      hold(userId, key, change(unwritten.envelope.data as T), unwritten.slim);
      return;
    }
    const raw = await store.getItem(cacheKey(userId, key)).catch(() => null);
    if (!raw || gen !== generation || getUserId() !== userId) return;
    let data: T;
    try {
      data = (JSON.parse(raw) as CacheEnvelope<T>).data;
    } catch {
      return;
    }
    // A newer copy may have been kept while this one was read: change that one instead.
    const newer = waiting.get(cacheKey(userId, key));
    hold(userId, key, change(newer && newer.generation === gen ? (newer.envelope.data as T) : data));
  }

  return { read, keep, revise, clear, settled };
}

export type ReadCache = ReturnType<typeof createReadCache>;
