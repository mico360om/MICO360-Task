import { apiClient } from '../api/client';
import { tasksApi, type NewTaskInput } from '../api/tasks';
import { useAuthStore } from '../stores/auth-store';
import { ApiError } from './api-client';
import {
  enqueue,
  failedItems,
  flushQueue,
  localStorageQueueStore,
  queueSize,
  removeItem,
  removeOrphans,
  retryItem,
  type FlushResult,
  type QueuedMutation,
} from './offline-queue';

export type OfflineKind = 'task.create' | 'task.move';

const fail = (message: string) => Object.assign(new Error(message), { permanent: true });
const pause = (message: string) => Object.assign(new Error(message), { pause: true });

/**
 * Sort a replay error into: pause (still offline, signed out, rate limited, the original request is
 * still running — stop and keep everything), permanent (the server rejected it — mark failed), or a
 * plain error (server trouble — count an attempt and try again later).
 */
function classify(e: unknown): Error {
  if (e && typeof e === 'object' && ((e as { permanent?: boolean }).permanent || (e as { pause?: boolean }).pause)) return e as Error;
  if (!(e instanceof ApiError)) return pause('Offline');
  if (e.status === 401) return pause('Signed out');
  if (e.status === 429) return pause('Rate limited');
  if (e.status === 409 && e.code === 'IDEMPOTENCY_IN_PROGRESS') return pause('Still processing');
  if (e.status === 408 || e.status >= 500) return e;
  return fail(e.message || `Rejected (${e.status})`);
}

/** Replay one queued task mutation through the API. */
async function replayMutation(m: QueuedMutation): Promise<void> {
  try {
    if (m.kind === 'task.create') {
      await tasksApi(apiClient).create(m.payload as NewTaskInput, { idempotencyKey: m.idempotencyKey });
      return;
    }
    if (m.kind === 'task.move') {
      // A move is idempotent by nature (PATCH to a target column); the API takes no expectedVersion for it.
      const p = m.payload as { id: string; toColumnId: string };
      await tasksApi(apiClient).move(p.id, p.toColumnId);
      return;
    }
    throw fail(`Unknown change type ${m.kind}`);
  } catch (e) {
    throw classify(e);
  }
}

const currentUserId = () => useAuthStore.getState().user?.id ?? null;

/**
 * Queue a task mutation to replay when the connection returns. Pass the Idempotency-Key the failed
 * online attempt used, so if that attempt actually reached the server the replay is de-duplicated.
 * Returns false when nobody is signed in (nothing is queued).
 */
export function enqueueOffline(kind: OfflineKind, payload: unknown, opts: { idempotencyKey?: string } = {}): boolean {
  const ownerId = currentUserId();
  if (!ownerId) return false;
  enqueue(localStorageQueueStore, { kind, payload, ownerId, idempotencyKey: opts.idempotencyKey });
  return true;
}

// ── One flusher at a time: in this tab (single-flight) and across tabs (Web Locks, else a lease) ──
const QUEUE_LOCK = 'mico360-sync-queue';
const LEASE_KEY = 'mico360.syncQueue.lease';
const LEASE_MS = 60_000;
const TAB_ID = Math.random().toString(36).slice(2);

type LockManagerLike = {
  request: <T>(name: string, options: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<T>) => Promise<T>;
};

function acquireLease(): boolean {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    const lease = raw ? (JSON.parse(raw) as { tab: string; until: number }) : null;
    if (lease && lease.tab !== TAB_ID && lease.until > Date.now()) return false;
    localStorage.setItem(LEASE_KEY, JSON.stringify({ tab: TAB_ID, until: Date.now() + LEASE_MS }));
    const check = JSON.parse(localStorage.getItem(LEASE_KEY) ?? 'null') as { tab: string } | null;
    return check?.tab === TAB_ID;
  } catch {
    return true; // no storage → no other tab can share a queue with us either
  }
}
function releaseLease(): void {
  try {
    const raw = localStorage.getItem(LEASE_KEY);
    if (raw && (JSON.parse(raw) as { tab: string }).tab === TAB_ID) localStorage.removeItem(LEASE_KEY);
  } catch {
    /* ignore */
  }
}

async function withQueueLock(fn: () => Promise<FlushResult>, busy: () => FlushResult): Promise<FlushResult> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerLike }).locks : undefined;
  if (locks && typeof locks.request === 'function') {
    return locks.request(QUEUE_LOCK, { ifAvailable: true }, async (lock) => (lock ? fn() : busy()));
  }
  if (!acquireLease()) return busy();
  try {
    return await fn();
  } finally {
    releaseLease();
  }
}

let flushing: Promise<FlushResult> | null = null;

/**
 * Replay the signed-in user's queued changes, in order. Another user's items are never sent, and
 * only one tab flushes at a time (a tab that finds another flushing just reports the current state).
 */
export function flushOfflineQueue(): Promise<FlushResult> {
  const ownerId = currentUserId();
  const idle = (): FlushResult => ({ synced: 0, failed: 0, remaining: ownerId ? queueSize(localStorageQueueStore, ownerId) : 0 });
  if (!ownerId) return Promise.resolve(idle());
  if (flushing) return flushing;
  flushing = withQueueLock(async () => {
    removeOrphans(localStorageQueueStore);
    return flushQueue(localStorageQueueStore, replayMutation, { ownerId });
  }, idle).finally(() => {
    flushing = null;
  });
  return flushing;
}

/** How many of the signed-in user's changes are waiting to sync. */
export function pendingCount(): number {
  const ownerId = currentUserId();
  return ownerId ? queueSize(localStorageQueueStore, ownerId) : 0;
}

/** The signed-in user's changes that could not be synced (for review). */
export function failedChanges(): QueuedMutation[] {
  const ownerId = currentUserId();
  return ownerId ? failedItems(localStorageQueueStore, ownerId) : [];
}

/** Put a failed change back in the queue. */
export function retryChange(id: string): void {
  retryItem(localStorageQueueStore, id);
}

/** Throw a failed change away. */
export function discardChange(id: string): void {
  removeItem(localStorageQueueStore, id);
}

/** A short human description of a queued change, for the review list. */
export function describeChange(m: QueuedMutation): string {
  const p = (m.payload ?? {}) as { title?: string; id?: string };
  if (m.kind === 'task.create') return `New task “${p.title ?? 'Untitled'}”`;
  if (m.kind === 'task.move') return 'Task moved to another column';
  return m.kind;
}
