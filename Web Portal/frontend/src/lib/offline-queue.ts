/**
 * Durable offline mutation queue for the web app (Epic C). Task actions taken while the network is
 * down are queued here and replayed in FIFO order on reconnect.
 *
 * - Every item records the user who queued it; only that user's session replays it.
 * - Every item carries a stable Idempotency-Key (generated when it is queued, or the key the failed
 *   online attempt already used), so a replay after a lost response never creates a duplicate.
 * - Items are removed by id after they succeed, so changes queued during a flush are never lost.
 * - A rejected item, or one that keeps failing, is marked failed (not silently dropped) so the user
 *   can see it and retry or discard it; it no longer blocks the rest of the queue.
 *
 * Backed by an injectable store so it's unit-testable; the default store persists to localStorage.
 */
export interface QueuedMutation {
  id: string;
  kind: string; // e.g. 'task.create' | 'task.move'
  payload: unknown;
  queuedAt: number;
  /** The user who queued it — only their session may replay it. Missing on items from older builds. */
  ownerId?: string | null;
  /** Sent as `Idempotency-Key` so the server de-duplicates a replay of a request it already applied. */
  idempotencyKey?: string;
  /** Failed replay attempts so far (network outages don't count). */
  attempts?: number;
  /** Set once the item can't succeed (rejected, or out of retries); kept so the user can review it. */
  failedAt?: number;
  lastError?: string;
}

export interface QueueStore {
  read(): QueuedMutation[];
  write(q: QueuedMutation[]): void;
}

/** Retries (server errors) before an item is marked failed. */
export const MAX_ATTEMPTS = 5;

const KEY = 'mico360.syncQueue';

/** Default store backed by localStorage; degrades to an empty queue where storage is unavailable. */
export const localStorageQueueStore: QueueStore = {
  read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
      return Array.isArray(parsed) ? (parsed as QueuedMutation[]) : [];
    } catch {
      return [];
    }
  },
  write(q) {
    try {
      if (q.length === 0) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(q));
    } catch {
      /* storage unavailable — the queue simply won't persist this session */
    }
  },
};

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh client-generated Idempotency-Key. */
export function newIdempotencyKey(): string {
  return randomId();
}

export function enqueue(
  store: QueueStore,
  mutation: { kind: string; payload: unknown; ownerId?: string | null; idempotencyKey?: string },
): QueuedMutation {
  const item: QueuedMutation = {
    id: randomId(),
    queuedAt: Date.now(),
    kind: mutation.kind,
    payload: mutation.payload,
    ownerId: mutation.ownerId ?? null,
    idempotencyKey: mutation.idempotencyKey ?? newIdempotencyKey(),
    attempts: 0,
  };
  store.write([...store.read(), item]);
  return item;
}

const belongsTo = (m: QueuedMutation, ownerId: string | null | undefined) => ownerId === undefined || m.ownerId === ownerId;

/** Items still waiting to sync (optionally only one user's). */
export function pendingItems(store: QueueStore, ownerId?: string | null): QueuedMutation[] {
  return store.read().filter((m) => !m.failedAt && belongsTo(m, ownerId));
}

/** Items that could not be synced and need the user's attention (optionally only one user's). */
export function failedItems(store: QueueStore, ownerId?: string | null): QueuedMutation[] {
  return store.read().filter((m) => !!m.failedAt && belongsTo(m, ownerId));
}

/** How many items are waiting to sync (optionally only one user's). */
export function queueSize(store: QueueStore, ownerId?: string | null): number {
  return pendingItems(store, ownerId).length;
}

export function getQueue(store: QueueStore): QueuedMutation[] {
  return store.read();
}

export function clearQueue(store: QueueStore): void {
  store.write([]);
}

/** Remove one item by id (re-reading the store so concurrent additions survive). */
export function removeItem(store: QueueStore, id: string): void {
  store.write(store.read().filter((m) => m.id !== id));
}

/** Remove every item a user queued (explicit sign-out). */
export function removeOwnerItems(store: QueueStore, ownerId: string): void {
  const q = store.read();
  const kept = q.filter((m) => m.ownerId !== ownerId);
  if (kept.length !== q.length) store.write(kept);
}

/** Remove items from older builds that don't record who queued them — they can't be replayed safely. */
export function removeOrphans(store: QueueStore): number {
  const q = store.read();
  const kept = q.filter((m) => !!m.ownerId);
  if (kept.length !== q.length) store.write(kept);
  return q.length - kept.length;
}

/** Put a failed item back in line for another attempt. */
export function retryItem(store: QueueStore, id: string): void {
  patchItem(store, id, { failedAt: undefined, lastError: undefined, attempts: 0 });
}

function patchItem(store: QueueStore, id: string, patch: Partial<QueuedMutation>): void {
  store.write(store.read().map((m) => (m.id === id ? { ...m, ...patch } : m)));
}

export interface FlushResult {
  synced: number;
  /** Items newly marked failed during this flush. */
  failed: number;
  /** Items still waiting to sync afterwards. */
  remaining: number;
}

/**
 * Replay queued mutations in FIFO order. `perform(item)` sends one mutation and resolves on success.
 * A rejection with `pause: true` (offline, signed out) stops the flush and keeps everything for later;
 * `permanent: true` (a real rejection) marks the item failed; any other error counts an attempt, and
 * after `maxAttempts` the item is marked failed. Only `ownerId`'s items are replayed when given.
 */
export async function flushQueue(
  store: QueueStore,
  perform: (m: QueuedMutation) => Promise<void>,
  opts: { ownerId?: string | null; maxAttempts?: number } = {},
): Promise<FlushResult> {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const snapshot = pendingItems(store, opts.ownerId);
  let synced = 0;
  let failed = 0;
  for (const item of snapshot) {
    // Skip anything discarded, synced (by another flusher) or failed since the snapshot.
    const current = store.read().find((m) => m.id === item.id);
    if (!current || current.failedAt) continue;
    try {
      await perform(current);
      removeItem(store, current.id);
      synced += 1;
    } catch (e) {
      const err = (e ?? {}) as { pause?: boolean; permanent?: boolean; message?: string };
      if (err.pause) break;
      const attempts = (current.attempts ?? 0) + 1;
      const lastError = typeof err.message === 'string' && err.message ? err.message : 'Sync failed';
      if (err.permanent || attempts >= maxAttempts) {
        patchItem(store, current.id, { attempts, lastError, failedAt: Date.now() });
        failed += 1;
      } else {
        patchItem(store, current.id, { attempts, lastError });
      }
    }
  }
  return { synced, failed, remaining: queueSize(store, opts.ownerId) };
}
