import type { DraftStorage } from './inspection-outbox';
import { MAX_COPY_CHARS } from './read-cache';
import type { KeyValueStore } from './storage';

/**
 * Where the phone keeps its inspection records (Stage 4). The outbox (the website's copy) reads and
 * writes them synchronously, as the website does with localStorage; AsyncStorage is asynchronous.
 * So the records live in memory, read from AsyncStorage once when the app starts (`hydrate`), and
 * every change is written through to AsyncStorage at once — one record's writes in order, so the
 * last one wins. If Android closes the app, what was written is read back on the next start.
 *
 * A record too long for Android to read back, or more records than their share of the phone's
 * storage, is refused like a full localStorage: the outbox keeps that change in the app and the
 * screen says "This phone's storage is full…". A write AsyncStorage itself fails is tried again with
 * the next write and by `settled()`; until then `unwritten()` names it.
 */

/** The website's keys: `mico360.inspection.<ownerId>.<inspectionId>`. */
export const INSPECTION_RECORD_PREFIX = 'mico360.inspection.';
/** One record at most (Android can't read a much longer value back — the read cache's limit). */
export const RECORD_MAX_CHARS = MAX_COPY_CHARS;
/** All records together (AsyncStorage's 6 MB is shared with the offline copy and the queue). */
export const ALL_RECORDS_MAX_CHARS = 2_400_000;

/** The phone's storage for inspections is full (the name the website's quota error has). */
export class StorageFullError extends Error {
  constructor(message = 'This phone’s storage for inspections is full.') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export interface MirroredDraftStorage extends DraftStorage {
  /** Reads the records kept on the phone (once, when the app starts). */
  hydrate(): Promise<void>;
  isHydrated(): boolean;
  /** Resolves when every write asked for so far has ended (a failed one is tried once more first). */
  settled(): Promise<void>;
  /** Records whose newest change isn't on the phone yet (AsyncStorage refused it). */
  unwritten(): string[];
}

export function createMirroredDraftStorage(store: KeyValueStore, o: { recordMax?: number; allMax?: number } = {}): MirroredDraftStorage {
  const recordMax = o.recordMax ?? RECORD_MAX_CHARS;
  const allMax = o.allMax ?? ALL_RECORDS_MAX_CHARS;
  const records = new Map<string, string>();
  /** Changed in the app since it started: a stored value read later doesn't overwrite them. */
  const touched = new Set<string>();
  const failedKeys = new Set<string>();
  /** Per record: the last write asked for (each one waits for the one before it). */
  const chains = new Map<string, Promise<void>>();
  /** Records with a write asked for that hasn't started yet (one more would write the same). */
  const waiting = new Set<string>();
  let total = 0;
  let hydrated = false;

  /** Writes the record as it is now in the app (or removes it), after its earlier writes. */
  function writeOut(key: string): void {
    if (waiting.has(key)) return;
    waiting.add(key);
    const before = chains.get(key) ?? Promise.resolve();
    const next = before.then(async () => {
      waiting.delete(key);
      const value = records.get(key);
      try {
        if (value === undefined) await store.deleteItem(key);
        else await store.setItem(key, value);
        failedKeys.delete(key);
      } catch {
        failedKeys.add(key);
      }
    });
    chains.set(key, next);
    void next.then(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  }

  /** A change: written at once, with any earlier write that failed. */
  function changed(key: string): void {
    touched.add(key);
    writeOut(key);
    for (const k of [...failedKeys]) if (k !== key) writeOut(k);
  }

  return {
    async hydrate() {
      let keys: string[] = [];
      try {
        keys = ((await store.keys?.()) ?? []).filter((k) => k.startsWith(INSPECTION_RECORD_PREFIX));
      } catch {
        keys = [];
      }
      for (const key of keys) {
        let value: string | null = null;
        try {
          value = await store.getItem(key);
        } catch {
          continue; // too long to read back, or unreadable: skipped
        }
        if (value === null || touched.has(key)) continue;
        records.set(key, value);
        total += value.length;
      }
      hydrated = true;
    },
    isHydrated: () => hydrated,
    get: (key) => records.get(key) ?? null,
    keys: () => [...records.keys()].filter((k) => k.startsWith(INSPECTION_RECORD_PREFIX)),
    set(key, value) {
      const had = records.get(key);
      if (value.length > recordMax || total - (had?.length ?? 0) + value.length > allMax) throw new StorageFullError();
      records.set(key, value);
      total += value.length - (had?.length ?? 0);
      changed(key);
    },
    remove(key) {
      const had = records.get(key);
      if (had !== undefined) {
        records.delete(key);
        total -= had.length;
      }
      changed(key);
    },
    async settled() {
      for (const k of [...failedKeys]) writeOut(k);
      while (chains.size > 0) await Promise.all([...chains.values()]);
    },
    unwritten: () => [...failedKeys],
  };
}
