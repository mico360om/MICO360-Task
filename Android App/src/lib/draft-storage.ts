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

/** Why a record isn't on the phone: too big to keep (Android can't read it back), or the storage is full / refused it. */
export type StorageProblem = 'too-big' | 'full';

/** The phone's storage for inspections is full (the name the website's quota error has). */
export class StorageFullError extends Error {
  readonly reason: StorageProblem;
  constructor(reason: StorageProblem = 'full') {
    super(reason === 'too-big' ? 'This inspection is too big to keep on the phone.' : 'This phone’s storage for inspections is full.');
    this.name = 'QuotaExceededError';
    this.reason = reason;
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
  /** Why this record's newest change isn't on the phone (null: it is, or there is no record). */
  problemOf(key: string): StorageProblem | null;
  /** Hear each change of what is (not) on the phone — a refused write, one that went through after all. */
  subscribe(listener: () => void): () => void;
}

/** A record is JSON (the outbox's own): anything else on the phone under its key is no record. */
function isRecordText(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return !!v && typeof v === 'object';
  } catch {
    return false;
  }
}

export function createMirroredDraftStorage(
  store: KeyValueStore,
  o: { recordMax?: number; allMax?: number; /** A record that couldn't be read back, removed (dev logs). */ onDropped?: (key: string, why: 'unreadable' | 'not-a-record') => void } = {},
): MirroredDraftStorage {
  const recordMax = o.recordMax ?? RECORD_MAX_CHARS;
  const allMax = o.allMax ?? ALL_RECORDS_MAX_CHARS;
  const records = new Map<string, string>();
  /**
   * Changes asked for before the phone's records were read (Final I1): held, then applied once they
   * are — a record kept on the phone wins over a write made before it was read (an inspection opened
   * as the app starts must not replace the answers waiting in it); a removal still removes.
   */
  const early = new Map<string, string | null>();
  const failedKeys = new Set<string>();
  /** Writes refused at once (too big, the share full): the outbox keeps those changes in the app. */
  const refused = new Map<string, StorageProblem>();
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((l) => l());
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
        if (failedKeys.delete(key)) tell();
      } catch {
        if (!failedKeys.has(key)) {
          failedKeys.add(key);
          tell();
        }
      }
    });
    chains.set(key, next);
    void next.then(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  }

  /** A change: written at once, with any earlier write that failed. */
  function changed(key: string): void {
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
          // Too long for Android to read back, or unreadable: it would only take room (Final I11).
          writeOut(key);
          o.onDropped?.(key, 'unreadable');
          continue;
        }
        if (value === null) continue;
        if (!isRecordText(value)) {
          writeOut(key);
          o.onDropped?.(key, 'not-a-record');
          continue;
        }
        records.set(key, value);
        total += value.length;
      }
      for (const [key, value] of early) {
        const had = records.get(key);
        if (value === null) {
          if (had !== undefined) {
            records.delete(key);
            total -= had.length;
          }
          changed(key);
        } else if (had === undefined && total + value.length <= allMax) {
          records.set(key, value);
          total += value.length;
          changed(key);
        }
      }
      early.clear();
      hydrated = true;
    },
    isHydrated: () => hydrated,
    get: (key) => records.get(key) ?? null,
    keys: () => [...records.keys()].filter((k) => k.startsWith(INSPECTION_RECORD_PREFIX)),
    set(key, value) {
      const refuse = (reason: StorageProblem) => {
        if (refused.get(key) !== reason) {
          refused.set(key, reason);
          tell();
        }
        throw new StorageFullError(reason);
      };
      if (value.length > recordMax) refuse('too-big');
      if (!hydrated) {
        early.set(key, value);
        return;
      }
      const had = records.get(key);
      if (total - (had?.length ?? 0) + value.length > allMax) refuse('full');
      if (refused.delete(key)) tell();
      records.set(key, value);
      total += value.length - (had?.length ?? 0);
      changed(key);
    },
    remove(key) {
      if (refused.delete(key)) tell();
      if (!hydrated) {
        early.set(key, null);
        return;
      }
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
    problemOf: (key) => refused.get(key) ?? (failedKeys.has(key) ? 'full' : null),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
