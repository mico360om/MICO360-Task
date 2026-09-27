/**
 * Durable offline mutation queue for the extension, backed by a chrome.storage.local-compatible
 * store ({ get(key), set(obj) }). Changes made while offline are queued here and replayed later.
 *
 * Guarantees (XP-02 / XP-06):
 *  - every item belongs to the user who made it (`userId`) and is only ever replayed for that user;
 *  - every item carries an `Idempotency-Key` created when the change was first attempted, so a
 *    replay of a request that already reached the server is not applied twice;
 *  - all read-modify-writes of the queue happen under one cross-context lock, and a flush removes
 *    items by id — an enqueue in the app tab can never be overwritten by the service worker's flush;
 *  - only one flush runs at a time (the service worker normally; the app tab only as a fallback);
 *  - nothing is dropped silently: an item that can never succeed, or keeps failing, is marked
 *    `failed` and shown in Settings (retry / discard). A 401 pauses the queue instead of dropping.
 */
import { withLock } from './locks.js';
import { ApiError, QueueError } from './errors.js';

const KEY = 'syncQueue';
export const QUEUE_LOCK = 'mico360:sync-queue';
export const FLUSH_LOCK = 'mico360:sync-flush';
/** runtime message the app tab sends to ask the service worker to flush now. */
export const FLUSH_MESSAGE = 'mico360:flush';
/** Attempts (5xx / timeouts / 403) before an item stops retrying and is shown as failed. */
export const MAX_ATTEMPTS = 5;

async function readQueue(storage) {
  const o = await storage.get(KEY);
  const q = o && o[KEY];
  return Array.isArray(q) ? q : [];
}

/** Read-modify-write the queue under the cross-context queue lock. */
async function mutateQueue(storage, change) {
  const { value } = await withLock(QUEUE_LOCK, async () => {
    const next = change(await readQueue(storage));
    await storage.set({ [KEY]: next });
    return next;
  });
  return value;
}

export function newIdempotencyKey() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const r = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${r()}-${r()}-${r()}`;
}

/**
 * Add a mutation (e.g. { kind: 'task.create', payload, userId }) to the queue. `userId` is required:
 * an ownerless item could later be replayed under someone else's account.
 */
export async function enqueue(storage, { kind, payload, userId, idempotencyKey } = {}) {
  if (!userId) throw new QueueError('Sign in again to save changes.');
  const item = {
    id: newIdempotencyKey(),
    kind,
    payload,
    userId,
    idempotencyKey: idempotencyKey || newIdempotencyKey(),
    queuedAt: Date.now(),
    attempts: 0,
    status: 'pending',
    lastError: null,
  };
  await mutateQueue(storage, (q) => [...q, item]);
  return item;
}

export async function getQueue(storage) {
  return readQueue(storage);
}

/** The signed-in user's queue: `pending` items still to send, `failed` items that need a decision. */
export async function queueStats(storage, userId) {
  const mine = (await readQueue(storage)).filter((i) => i.userId === userId);
  const failed = mine.filter((i) => i.status === 'failed');
  return { pending: mine.length - failed.length, failed: failed.length, failedItems: failed };
}

export async function queueSize(storage, userId) {
  return (await queueStats(storage, userId)).pending;
}

export async function clearQueue(storage) {
  await mutateQueue(storage, () => []);
}

export async function removeQueued(storage, id) {
  await mutateQueue(storage, (q) => q.filter((i) => i.id !== id));
}

/** Put a failed item back in line for the next sync. */
export async function retryQueued(storage, id) {
  await mutateQueue(storage, (q) => q.map((i) => (i.id === id ? { ...i, status: 'pending', attempts: 0, lastError: null } : i)));
}

/** One-time upgrade: items queued before owners existed belong to the session that is still signed in. */
export async function assignOwnerlessItems(storage, userId) {
  const q = await readQueue(storage);
  if (!q.some((i) => !i.userId)) return;
  await mutateQueue(storage, (cur) => cur.map((i) => (i.userId ? i : { ...i, userId })));
}

/**
 * Map a queued mutation to its HTTP request `{ path, init }`, or null for an unknown kind. Pure so
 * the whole offline-write surface is unit-testable. POSTs carry the item's Idempotency-Key.
 */
export function mutationRequest(item) {
  const p = item.payload || {};
  const post = (path, body) => ({
    path,
    init: {
      method: 'POST',
      body: JSON.stringify(body),
      ...(item.idempotencyKey ? { headers: { 'Idempotency-Key': item.idempotencyKey } } : {}),
    },
  });
  switch (item.kind) {
    case 'task.create':
      return post('/tasks', p);
    case 'task.move':
      return { path: `/tasks/${p.id}/move`, init: { method: 'PATCH', body: JSON.stringify({ columnId: p.columnId, position: p.position }) } };
    case 'task.update':
      return { path: `/tasks/${p.id}`, init: { method: 'PUT', body: JSON.stringify(p.patch || {}) } };
    case 'task.assign':
      return post(`/tasks/${p.id}/assignees`, { userIds: p.userIds });
    case 'task.unassign':
      return { path: `/tasks/${p.id}/assignees/${p.userId}`, init: { method: 'DELETE' } };
    case 'comment.add':
      return post(`/tasks/${p.id}/comments`, { body: p.body });
    case 'checklist.add':
      return post(`/tasks/${p.id}/checklist`, { text: p.text });
    case 'checklist.update':
      return { path: `/checklist/${p.itemId}`, init: { method: 'PUT', body: JSON.stringify(p.patch || {}) } };
    case 'notification.read':
      return { path: `/notifications/${p.id}/read`, init: { method: 'PUT' } };
    case 'chat.send':
      return post(`/conversations/${p.conversationId}/messages`, { body: p.body });
    default:
      return null;
  }
}

/** Short human description of a queued change (Settings → Sync). */
export function describeMutation(item) {
  const p = item.payload || {};
  switch (item.kind) {
    case 'task.create': return `New task “${p.title || 'Untitled'}”`;
    case 'task.move': return 'Move a task';
    case 'task.update': return 'Edit a task';
    case 'task.assign': return 'Assign a task';
    case 'task.unassign': return 'Unassign a task';
    case 'comment.add': return 'Comment on a task';
    case 'checklist.add': return `Checklist item “${p.text || ''}”`;
    case 'checklist.update': return 'Tick a checklist item';
    case 'notification.read': return 'Mark a notification read';
    case 'chat.send': return 'Chat message';
    default: return 'Change';
  }
}

/**
 * How the queue treats a failed replay:
 *  - 'pause' — stop this sync and keep the item untouched (offline, session renewing/expired,
 *              rate limited, the server still processing the first attempt);
 *  - 'retry' — count an attempt, stop this sync to keep the order; `failed` after MAX_ATTEMPTS;
 *  - 'fail'  — can never succeed as sent: mark `failed` (kept + shown), carry on with the rest.
 */
export function outcomeForStatus(status, code) {
  if (status === 401 || status === 429) return 'pause';
  if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') return 'pause';
  if (status === 408 || status === 403 || status >= 500) return 'retry';
  return 'fail';
}

function failureOutcome(e) {
  if (e && e.outcome) return e.outcome;
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'retry';
  return 'pause'; // network failure / session renewal unavailable
}

async function errorInfo(res) {
  try {
    const j = await res.json();
    return { code: j?.error?.code, message: j?.error?.message };
  } catch {
    return {};
  }
}

/**
 * Build the `perform(item)` used to replay one queued mutation. `doFetch(path, init)` is the
 * caller's authenticated fetch, so the replay logic lives in ONE place for every surface.
 */
export function makePerformMutation(doFetch) {
  return async (item) => {
    const req = mutationRequest(item);
    if (!req) {
      const e = new Error(`unknown mutation: ${item.kind}`);
      e.outcome = 'fail';
      throw e;
    }
    const res = await doFetch(req.path, req.init);
    if (!res.ok) {
      const { code, message } = await errorInfo(res);
      const e = new Error(message || `${item.kind} failed (${res.status})`);
      e.status = res.status;
      e.code = code;
      e.outcome = outcomeForStatus(res.status, code);
      throw e;
    }
  };
}

function errorText(e) {
  if (e && typeof e.status === 'number') return `${e.status}${e.message ? ` — ${e.message}` : ''}`;
  return (e && e.message) || 'Unknown error';
}

/**
 * Replay the given user's queued mutations in FIFO order, one flusher at a time. Items are removed
 * by id as they succeed, and the queue is re-read before each item so changes queued (or discarded)
 * during the flush are respected. Returns { synced, failed, remaining, paused, skipped }.
 */
export async function flushQueue(storage, perform, { userId, maxAttempts = MAX_ATTEMPTS } = {}) {
  const base = { synced: 0, failed: 0, remaining: 0, paused: false, skipped: false };
  if (!userId) return base;
  const run = await withLock(FLUSH_LOCK, async () => {
    const result = { ...base };
    const tried = new Set();
    for (;;) {
      const item = (await readQueue(storage)).find((i) => i.userId === userId && i.status !== 'failed' && !tried.has(i.id));
      if (!item) break;
      tried.add(item.id);
      try {
        await perform(item);
      } catch (e) {
        const outcome = failureOutcome(e);
        if (outcome === 'pause') {
          result.paused = true;
          break;
        }
        let gaveUp = outcome === 'fail';
        await mutateQueue(storage, (q) => q.map((i) => {
          if (i.id !== item.id) return i;
          const attempts = (i.attempts || 0) + 1;
          if (attempts >= maxAttempts) gaveUp = true;
          return { ...i, attempts, lastError: errorText(e), status: gaveUp ? 'failed' : 'pending' };
        }));
        if (gaveUp) {
          result.failed += 1;
          continue;
        }
        result.paused = true; // keep the order: later changes wait for this one
        break;
      }
      await removeQueued(storage, item.id);
      result.synced += 1;
    }
    result.remaining = (await queueStats(storage, userId)).pending;
    return result;
  }, { ifAvailable: true });
  if (!run.acquired) return { ...base, skipped: true, remaining: (await queueStats(storage, userId)).pending };
  return run.value;
}

/** Statuses for which an immediate write is kept for later instead of reported as an error. */
const QUEUE_ON_STATUS = new Set([401, 408, 429, 502, 503, 504]);

/**
 * Online-first write used by the screens: send the change now; when the server can't be reached,
 * queue it for the signed-in user with the SAME Idempotency-Key, so a request that did reach the
 * server before the connection dropped is not applied twice when it is replayed.
 * Resolves `{ queued: false, data }` or `{ queued: true, item }`. Rejects with ApiError for an
 * HTTP error the user should see, or QueueError when the change could not be saved at all.
 */
export async function sendOrQueue({ kind, payload }, { doFetch, storage, userId, newKey = newIdempotencyKey }) {
  const item = { kind, payload, userId, idempotencyKey: newKey() };
  const req = mutationRequest(item);
  if (!req) throw new Error(`unknown mutation: ${kind}`);

  async function queueIt() {
    try {
      return { queued: true, item: await enqueue(storage, item) };
    } catch (e) {
      throw e instanceof QueueError ? e : new QueueError();
    }
  }

  let res;
  try {
    res = await doFetch(req.path, req.init);
  } catch {
    return queueIt(); // offline, timed out, or the session couldn't be renewed right now
  }
  if (res.ok) {
    if (res.status === 204) return { queued: false, data: undefined };
    const json = await res.json().catch(() => ({}));
    return { queued: false, data: json && json.data !== undefined ? json.data : json };
  }
  if (QUEUE_ON_STATUS.has(res.status)) return queueIt();
  const { code, message } = await errorInfo(res);
  throw new ApiError(res.status, message, code);
}
