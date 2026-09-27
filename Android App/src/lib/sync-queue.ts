import type { KeyValueStore } from './storage';
import { ApiError, isNetworkError } from './api-client';
import { newIdempotencyKey } from './idempotency';

const QUEUE_KEY = 'mico360.mutations';

/** `pending` items are replayed; `failed` items stopped retrying and are shown to the user. */
export type MutationStatus = 'pending' | 'failed';

export interface QueuedMutation {
  id: string;
  kind: string;
  payload: unknown;
  createdAt: number;
  /** Owner of the change — it is only ever replayed while this user is signed in (XP-02). */
  userId: string;
  /**
   * Sent as the `Idempotency-Key` header on replay (XP-06). Minted before the first online attempt
   * and reused here, so a write that timed out after the server saved it is not duplicated.
   */
  idempotencyKey: string;
  /** Server-side failures (5xx etc.) so far; network/401 pauses do not count. */
  attempts: number;
  status: MutationStatus;
  /** Last error message, shown next to a failed item. */
  lastError?: string;
}

/** How one replay failure should be handled. */
export type FailureKind = 'offline' | 'unauthorized' | 'transient' | 'permanent';

export interface FlushResult {
  synced: number;
  /** Items that moved to `failed` during this flush (permanent rejection or retry cap reached). */
  failed: QueuedMutation[];
  /** Items still pending for this user. */
  remaining: number;
  /** Why the flush stopped before the end, if it did. */
  pausedBy?: 'offline' | 'unauthorized' | 'server' | 'user-changed';
}

export interface EnqueueOptions {
  userId: string;
  /** Reuse the key of the online attempt that just failed; a new one is minted when absent. */
  idempotencyKey?: string;
}

export interface SyncQueueOptions {
  store: KeyValueStore;
  /** Send one mutation to the server. Resolves on success, rejects on failure. */
  perform: (mutation: QueuedMutation) => Promise<void>;
  /** Classify a replay failure (default: {@link classifyReplayError}). */
  classifyError?: (error: unknown) => FailureKind;
  /** Server-side failures tolerated before an item is marked failed (default 5). */
  maxAttempts?: number;
  now?: () => number;
  genId?: () => string;
  genKey?: () => string;
}

/**
 * Default replay-failure policy:
 * - no response (offline / timeout) → pause, keep order, no attempt counted;
 * - 401 → pause until the owner is signed in with a working session (never dropped);
 * - 408 / 409 IDEMPOTENCY_IN_PROGRESS / 429 / 5xx → transient, counts an attempt;
 * - any other 4xx → permanent: the item is marked failed and shown, and the queue moves on.
 */
export function classifyReplayError(error: unknown): FailureKind {
  if (isNetworkError(error)) return 'offline';
  if (error instanceof ApiError || typeof (error as { status?: unknown })?.status === 'number') {
    const status = (error as { status: number }).status;
    const code = (error as { code?: unknown }).code;
    if (status === 401) return 'unauthorized';
    if (status === 409) return code === 'IDEMPOTENCY_IN_PROGRESS' ? 'transient' : 'permanent';
    if (status === 408 || status === 429 || status >= 500) return 'transient';
    if (status >= 400) return 'permanent';
  }
  return 'transient';
}

function isValidItem(raw: unknown): raw is QueuedMutation {
  const m = raw as Partial<QueuedMutation> | null;
  return !!m && typeof m.id === 'string' && typeof m.kind === 'string' && typeof m.userId === 'string' && m.userId !== '';
}

/**
 * Durable FIFO queue of writes made while offline (A8, XP-02, XP-06).
 *
 * - Every item records its owner; `flush(userId)` replays only that user's items, so user A's
 *   offline edits can never be posted under user B's account on a shared phone.
 * - Every item carries an idempotency key that the replay sends to the server.
 * - A transient failure pauses the flush (order preserved); a permanent rejection or an item that
 *   keeps failing is marked `failed` and kept (visible, retryable, discardable) instead of being
 *   silently dropped or blocking everything behind it.
 * - Items are removed by id, so writes enqueued while a flush is running are never lost.
 */
export function createSyncQueue(options: SyncQueueOptions) {
  const { store, perform } = options;
  const classify = options.classifyError ?? classifyReplayError;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const now = options.now ?? Date.now;
  const genId = options.genId ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const genKey = options.genKey ?? (() => newIdempotencyKey());

  // Immutable updates: every change swaps in a new array so `snapshot()` is a stable reference
  // between changes (React's useSyncExternalStore relies on that).
  let queue: readonly QueuedMutation[] = [];
  const listeners = new Set<() => void>();

  function commit(next: readonly QueuedMutation[]): Promise<void> {
    queue = next;
    listeners.forEach((l) => l());
    return store.setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => {
      /* storage unavailable — keep the in-memory queue for this run */
    });
  }

  function update(id: string, patch: Partial<QueuedMutation>): Promise<void> {
    return commit(queue.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  async function load(): Promise<QueuedMutation[]> {
    let parsed: unknown[] = [];
    try {
      const raw = await store.getItem(QUEUE_KEY);
      parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
      if (!Array.isArray(parsed)) parsed = [];
    } catch {
      parsed = [];
    }
    // Items from older builds have no owner. Replaying them could post one user's change as
    // another user, so they are discarded rather than guessed.
    const items = parsed.filter(isValidItem).map<QueuedMutation>((m) => ({
      ...m,
      idempotencyKey: typeof m.idempotencyKey === 'string' && m.idempotencyKey ? m.idempotencyKey : genKey(),
      attempts: typeof m.attempts === 'number' ? m.attempts : 0,
      status: m.status === 'failed' ? 'failed' : 'pending',
    }));
    queue = items;
    if (items.length !== parsed.length) await commit(items);
    else listeners.forEach((l) => l());
    return [...queue];
  }

  async function enqueue(kind: string, payload: unknown, opts: EnqueueOptions): Promise<QueuedMutation> {
    if (!opts?.userId) throw new Error('A queued change needs its owner (userId).');
    const mutation: QueuedMutation = {
      id: genId(),
      kind,
      payload,
      createdAt: now(),
      userId: opts.userId,
      idempotencyKey: opts.idempotencyKey || genKey(),
      attempts: 0,
      status: 'pending',
    };
    await commit([...queue, mutation]);
    return mutation;
  }

  const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Could not be saved.');

  async function flush(userId: string, opts: { shouldContinue?: () => boolean } = {}): Promise<FlushResult> {
    let synced = 0;
    const failed: QueuedMutation[] = [];
    let pausedBy: FlushResult['pausedBy'];

    for (;;) {
      if (opts.shouldContinue && !opts.shouldContinue()) {
        pausedBy = 'user-changed';
        break;
      }
      const m = queue.find((x) => x.userId === userId && x.status === 'pending');
      if (!m) break;
      try {
        await perform(m);
        await commit(queue.filter((x) => x.id !== m.id));
        synced += 1;
      } catch (error) {
        const kind = classify(error);
        if (kind === 'offline') {
          pausedBy = 'offline';
          break;
        }
        if (kind === 'unauthorized') {
          pausedBy = 'unauthorized';
          break;
        }
        if (kind === 'permanent') {
          await update(m.id, { status: 'failed', lastError: errorText(error) });
          failed.push({ ...m, status: 'failed', lastError: errorText(error) });
          continue;
        }
        const attempts = m.attempts + 1;
        if (attempts >= maxAttempts) {
          await update(m.id, { attempts, status: 'failed', lastError: errorText(error) });
          failed.push({ ...m, attempts, status: 'failed', lastError: errorText(error) });
          continue; // one poisoned item must not block everything behind it
        }
        await update(m.id, { attempts, lastError: errorText(error) });
        pausedBy = 'server';
        break;
      }
    }

    return { synced, failed, remaining: pendingFor(userId).length, ...(pausedBy ? { pausedBy } : {}) };
  }

  function pendingFor(userId: string | null | undefined): QueuedMutation[] {
    return userId ? queue.filter((m) => m.userId === userId && m.status === 'pending') : [];
  }

  function failedFor(userId: string | null | undefined): QueuedMutation[] {
    return userId ? queue.filter((m) => m.userId === userId && m.status === 'failed') : [];
  }

  return {
    load,
    enqueue,
    flush,
    /** Every item on the device (all owners) — mostly for tests and diagnostics. */
    pending: () => [...queue],
    pendingFor,
    failedFor,
    /** Stable snapshot of the whole queue (changes identity on every update). */
    snapshot: () => queue,
    /** Put a failed item back in line for another try. */
    retry: (id: string) => update(id, { status: 'pending', attempts: 0, lastError: undefined }),
    /** Throw away one item (the user chose to discard a change that cannot be saved). */
    discard: (id: string) => commit(queue.filter((m) => m.id !== id)),
    /** Remove every item owned by this user (explicit sign-out, after warning about unsynced work). */
    clearForUser: (userId: string) => commit(queue.filter((m) => m.userId !== userId)),
    /** Remove everything. */
    clear: () => commit([]),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SyncQueue = ReturnType<typeof createSyncQueue>;
