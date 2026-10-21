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
   * and reused here, so a write that timed out after the server saved it is not duplicated. Replaced
   * only after a refusal the server keeps under it (see {@link needsNewKey}).
   */
  idempotencyKey: string;
  /** Server-side failures (5xx etc.) so far; network/401 pauses do not count. */
  attempts: number;
  /** Tries the server didn't answer in time (a timeout, not "no connection"); older builds leave it out. */
  timeouts?: number;
  /** When the last try without an answer was made: the next waits retryDelay(timeouts) after it (4a review). */
  lastTryAt?: number;
  /** When a try first went without an answer: the server keeps its key for a day from about then. */
  firstUnansweredAt?: number;
  /** It was refused, and the server keeps that refusal under its key: a Retry goes under a new key. */
  refused?: boolean;
  status: MutationStatus;
  /** Last error message, shown next to a failed item. */
  lastError?: string;
}

/** Why a change the server never answered stopped being sent (it shows with Retry and Discard). */
export const NO_ANSWER_TEXT = 'The server didn’t answer in time. It may have been saved — check before you retry.';

/**
 * How long a change the server didn't answer waits before it is sent again (4a review): 30 s after
 * the first try, then twice as long each time, at most 10 minutes — not on every sync, so a stuck
 * long note isn't sent twice a minute all day.
 */
export function retryDelay(timeouts: number): number {
  return Math.min(15_000 * 2 ** Math.max(1, timeouts), 10 * 60_000);
}

/**
 * The server keeps an idempotency key for 24 hours. A create it may have saved is not sent again
 * under its key once about that long has passed since its first unanswered try (a retry could
 * then make it twice): it is stopped with KEY_EXPIRED_TEXT, to be checked first (4a review).
 */
export const KEY_SAFE_MS = 23 * 60 * 60_000;
export const KEY_EXPIRED_TEXT = 'The server hasn’t answered this for a day, so it wasn’t sent again. It may have been saved — check before you retry.';

/** Changes the server didn't answer that are tried again at the same time, aside from the rest. */
const MAX_ASIDE = 3;

/** A change waiting this long can be discarded from the list (it may be stuck). */
export const LONG_WAIT_MS = 15 * 60_000;

/**
 * Has this waiting change waited too long (2c review)? The server didn't answer one of its tries,
 * or it has been waiting a quarter of an hour. Such a change can be discarded, not only a refused one.
 */
export function waitingTooLong(m: Pick<QueuedMutation, 'createdAt' | 'timeouts' | 'status'>, now: number): boolean {
  return m.status === 'pending' && ((m.timeouts ?? 0) > 0 || now - m.createdAt >= LONG_WAIT_MS);
}

/** How one replay failure should be handled. */
export type FailureKind = 'offline' | 'unauthorized' | 'transient' | 'permanent';

export interface FlushResult {
  synced: number;
  /** The items replayed during this flush, in order (so the app refreshes what they touched). */
  done: QueuedMutation[];
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
  /** Its live try got no answer in time (it may be saved): it starts out counted and waiting (4a review). */
  answerLost?: boolean;
}

export interface SyncQueueOptions {
  store: KeyValueStore;
  /** Send one mutation to the server. Resolves (with the server's answer) on success, rejects on failure. */
  perform: (mutation: QueuedMutation) => Promise<unknown>;
  /**
   * After a mutation replays, update each of the owner's waiting ones with its result (e.g. a task
   * edit made after an earlier one moves on to the version that one made). Default: unchanged.
   */
  rebase?: (done: QueuedMutation, result: unknown, waiting: QueuedMutation) => QueuedMutation;
  /** Classify a replay failure (default: {@link classifyReplayError}). */
  classifyError?: (error: unknown) => FailureKind;
  /** Server-side failures tolerated before an item is marked failed (default 5). */
  maxAttempts?: number;
  /** The server's key lifetime (KEY_SAFE_MS) and the changes it matters for (keyed creates — 4a review). */
  keyLifetime?: { ms: number; applies: (m: QueuedMutation) => boolean };
  /**
   * What a change waits behind (write-order replayLane): changes of one lane go in order, and one
   * that gets no answer or a server hiccup holds only its own lane. Default: one lane for all.
   */
  lane?: (m: QueuedMutation) => string;
  now?: () => number;
  genId?: () => string;
  genKey?: () => string;
}

/**
 * Default replay-failure policy:
 * - no response (offline / timeout) → pause, keep order, no attempt counted;
 * - 401 → pause until the owner is signed in with a working session (never dropped);
 * - 408 / 409 IDEMPOTENCY_IN_PROGRESS / 409 TASK_KEY_CONFLICT / 429 / 5xx → transient, counts an attempt;
 * - any other 4xx → permanent: the item is marked failed and shown, and the queue moves on.
 */
export function classifyReplayError(error: unknown): FailureKind {
  if (isNetworkError(error)) return 'offline';
  if (error instanceof ApiError || typeof (error as { status?: unknown })?.status === 'number') {
    const status = (error as { status: number }).status;
    const code = (error as { code?: unknown }).code;
    if (status === 401) return 'unauthorized';
    if (status === 409) return code === 'IDEMPOTENCY_IN_PROGRESS' || code === 'TASK_KEY_CONFLICT' ? 'transient' : 'permanent';
    if (status === 408 || status === 429 || status >= 500) return 'transient';
    if (status >= 400) return 'permanent';
  }
  return 'transient';
}

/**
 * A create refused because another task took its number at the same moment (TASK_KEY_CONFLICT).
 * The server keeps that refusal under the item's idempotency key for a day and would hand it back
 * to every retry with the same key — and no task was made under it — so the retry needs a new key.
 */
export function needsNewKey(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 409 && (error as { code?: unknown }).code === 'TASK_KEY_CONFLICT';
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
  const laneOf = (m: QueuedMutation) => options.lane?.(m) ?? '';
  const isTimeout = (e: unknown) => (e as { timedOut?: unknown } | null)?.timedOut === true;
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
    let changed = false;
    const items = parsed.filter(isValidItem).map<QueuedMutation>((m) => {
      const attempts = typeof m.attempts === 'number' ? m.attempts : 0;
      const item: QueuedMutation = {
        ...m,
        idempotencyKey: typeof m.idempotencyKey === 'string' && m.idempotencyKey ? m.idempotencyKey : genKey(),
        attempts,
        status: m.status === 'failed' ? 'failed' : 'pending',
      };
      if (item.status !== 'failed' || item.refused) return item;
      // Kept by an older version (3b review): one it stopped sending for want of an answer waits
      // again under its key (a change that gets no answer is never failed now); a refusal it kept
      // without the flag is known as one, so its Retry goes under a new key — unless it was failed
      // for failing on the server again and again (it may be saved: the key stays).
      changed = true;
      if (item.lastError === NO_ANSWER_TEXT) return { ...item, status: 'pending', lastError: undefined };
      return attempts < maxAttempts ? { ...item, refused: true } : item;
    });
    queue = items;
    if (changed || items.length !== parsed.length) await commit(items);
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
      ...(opts.answerLost ? { timeouts: 1, lastTryAt: now(), firstUnansweredAt: now() } : {}),
    };
    await commit([...queue, mutation]);
    return mutation;
  }

  const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Could not be saved.');

  async function flush(userId: string, opts: { shouldContinue?: () => boolean } = {}): Promise<FlushResult> {
    let synced = 0;
    const done: QueuedMutation[] = [];
    const failed: QueuedMutation[] = [];
    let pausedBy: FlushResult['pausedBy'];
    let stop = false;
    /** The flush stops here (the first reason is the one told); changes already on their way finish. */
    const pause = (why: NonNullable<FlushResult['pausedBy']>) => {
      pausedBy ??= why;
      stop = true;
    };
    // Lanes held back for the rest of this flush: their first change got no answer, or a hiccup.
    const held = new Set<string>();
    let heldBy: 'offline' | 'server' | undefined;
    // Lanes with a change on its way now (4a review): each lane goes in order, one at a time, but a
    // slow change of one lane never makes another lane's wait — a new message goes at once.
    const busy = new Map<string, Promise<void>>();
    const fail = async (m: QueuedMutation, patch: Partial<QueuedMutation>) => {
      await update(m.id, { status: 'failed', ...patch });
      failed.push({ ...m, status: 'failed', ...patch });
    };
    /**
     * One change of a lane got no answer (or a server hiccup): its lane waits, the others go on —
     * unless one already did this flush, then the connection or the server is the problem and the
     * whole flush pauses.
     */
    const holdLane = (m: QueuedMutation, why: 'offline' | 'server'): void => {
      if (held.size > 0) return pause(why);
      held.add(laneOf(m));
      heldBy = why;
    };

    /**
     * The next change to send: the first waiting change of a lane not held and not busy — a lane
     * whose first change got no answer last time goes after the others (3b review), and only once
     * its wait is over (retryDelay — 4a review); until then the rest of its lane waits with it.
     * Within a lane the order never changes.
     */
    const next = (): QueuedMutation | undefined => {
      const seen = new Set<string>();
      let unanswered: QueuedMutation | undefined;
      const t = now();
      for (const x of queue) {
        if (x.userId !== userId || x.status !== 'pending') continue;
        const lane = laneOf(x);
        if (seen.has(lane)) continue;
        seen.add(lane);
        if (held.has(lane) || busy.has(lane)) continue;
        if (!(x.timeouts ?? 0)) return x;
        if (busy.size >= MAX_ASIDE) continue;
        if (x.lastTryAt !== undefined && t < x.lastTryAt + retryDelay(x.timeouts ?? 0)) continue;
        unanswered ??= x;
      }
      return unanswered;
    };

    async function tryOne(m: QueuedMutation): Promise<void> {
      // The server forgets a key after a day (4a review): a create it may have saved isn't sent
      // again under its key so late — it asks the person to check first.
      const life = options.keyLifetime;
      if (life && (m.timeouts ?? 0) > 0 && life.applies(m) && now() - (m.firstUnansweredAt ?? m.createdAt) >= life.ms) {
        await fail(m, { lastError: KEY_EXPIRED_TEXT });
        return;
      }
      try {
        const result = await perform(m);
        const rest = queue.filter((x) => x.id !== m.id);
        const rebase = options.rebase;
        await commit(rebase ? rest.map((x) => (x.userId === m.userId && x.status === 'pending' ? rebase(m, result, x) : x)) : rest);
        synced += 1;
        done.push(m);
      } catch (error) {
        const kind = classify(error);
        if (kind === 'offline') {
          // No connection at all: everything waits, nothing is counted.
          if (!isTimeout(error)) return pause('offline');
          // The request went and no answer came in time. It may be saved, so it is never failed (3b
          // review): it keeps waiting at the head of its lane — a later change of the same item can't
          // overtake it with a version it never moved on — and is sent again once its wait is over
          // (longer after each try — 4a review) until the server answers. It is counted ("no answer
          // yet, N tries"), and can be discarded (waitingTooLong).
          const t = now();
          await update(m.id, { timeouts: (m.timeouts ?? 0) + 1, lastTryAt: t, firstUnansweredAt: m.firstUnansweredAt ?? t });
          return holdLane(m, 'offline');
        }
        if (kind === 'unauthorized') return pause('unauthorized');
        if (kind === 'permanent') {
          // The server keeps this refusal under the key: a Retry goes under a new one (3a review).
          await fail(m, { lastError: errorText(error), refused: true });
          return;
        }
        const attempts = m.attempts + 1;
        // A refusal the server keeps under this key would come back on every retry (and a "Retry"
        // after it is marked failed): the next try goes under a new key.
        const rekey = needsNewKey(error) ? { idempotencyKey: genKey() } : {};
        if (attempts >= maxAttempts) {
          await fail(m, { attempts, lastError: errorText(error), ...rekey });
          return; // one poisoned item must not block everything behind it
        }
        await update(m.id, { attempts, lastError: errorText(error), ...rekey });
        // A hiccup on one change (a meeting note) holds its own lane, not the chat behind it (3a review).
        holdLane(m, 'server');
      }
    }

    // A change added while this flush runs is picked up at once (a new message), not after it.
    let wake: (() => void) | null = null;
    const nudge = () => wake?.();
    listeners.add(nudge);
    try {
      for (;;) {
        if (opts.shouldContinue && !opts.shouldContinue()) pause('user-changed');
        if (stop) break;
        const m = next();
        if (m && (m.timeouts ?? 0) > 0) {
          // Another try of a change the server didn't answer goes aside: whatever is added or
          // waiting in other lanes goes meanwhile, not after its time-out (4a review).
          const lane = laneOf(m);
          busy.set(
            lane,
            tryOne(m).finally(() => {
              busy.delete(lane);
              nudge();
            }),
          );
          continue;
        }
        if (m) {
          await tryOne(m);
          continue;
        }
        if (busy.size === 0) break;
        // Wait for a change on its way to end, or a new one to be added.
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
      await Promise.all(busy.values());
    } finally {
      listeners.delete(nudge);
    }
    if (!pausedBy && held.size > 0 && pendingFor(userId).length > 0) pausedBy = heldBy;

    return { synced, done, failed, remaining: pendingFor(userId).length, ...(pausedBy ? { pausedBy } : {}) };
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
    /**
     * Put a failed item back in line for another try, counted afresh. After a refusal it goes under a
     * new key — the server would hand the kept refusal back for a day (a message's client id still
     * keeps it from being stored twice); after no answer or hiccups the key stays (it may be saved).
     */
    retry: (id: string) => {
      const m = queue.find((x) => x.id === id);
      return update(id, { status: 'pending', attempts: 0, timeouts: 0, lastError: undefined, refused: undefined, ...(m?.refused ? { idempotencyKey: genKey() } : {}) });
    },
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
