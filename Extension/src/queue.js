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
 *    `failed` and shown in Settings (retry / discard). A 401 pauses the queue instead of dropping;
 *  - task edits carry the version they were made against (H1). A task's edits and moves go one at a
 *    time: a new one waits behind the task's queued ones, and each replay moves this device's later
 *    edits of that task on to the version it made (src/task-writes.js). Its tags, people, watching
 *    and a comment's edits keep their order the same way, and a delete waits behind the task's changes;
 *  - a change of tags is sent over the task's tags as they are then, so others' changes stay; a failed
 *    change that a later change of the same thing replaced can't be tried again (it would undo it);
 *  - a delete that finds nothing to delete (the server's 404) is done, not failed.
 */
import { withLock } from './locks.js';
import { ApiError, QueueError } from './errors.js';
import { pruneCache, MAX_CACHE_ENTRIES } from './read-cache.js';
import {
  VERSIONED_KINDS, ORDERED_KINDS, DELETE_KINDS, taskIdOf, mustFollow, rebaseQueuedVersion, isVersionConflict, patchHeld, QUEUED_CONFLICT_MESSAGE, supersede,
} from './task-writes.js';
import { mergeTagChange } from './tags.js';

const KEY = 'syncQueue';
export const QUEUE_LOCK = 'mico360:sync-queue';
export const FLUSH_LOCK = 'mico360:sync-flush';
/** runtime message the app tab sends to ask the service worker to flush now. */
export const FLUSH_MESSAGE = 'mico360:flush';
/** Attempts (5xx / timeouts) before an item stops retrying and is shown as failed. */
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
    await saveQueue(storage, next);
    return next;
  });
  return value;
}

/**
 * Write the queue. When the device's storage for the extension is full (a disk without room, or a
 * copy without unlimitedStorage), the saved copies of screens give way — the older half, then all of them — so a change waiting
 * to sync is never refused for their sake. Only when even that fails does the write fail (EXT-05).
 */
async function saveQueue(storage, next) {
  let failure;
  for (const keep of [null, Math.floor(MAX_CACHE_ENTRIES / 2), 0]) {
    if (keep !== null) {
      try {
        if (!(await pruneCache(storage, keep))) continue; // nothing to drop: trying again can't help
      } catch {
        continue;
      }
    }
    try {
      await storage.set({ [KEY]: next });
      return;
    } catch (e) {
      failure = e;
    }
  }
  throw failure;
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

/** The signed-in person's changes still waiting to sync (not failed ones), oldest first — what reads show on top (H3). */
export async function pendingItems(storage, userId) {
  if (!userId) return [];
  return (await readQueue(storage)).filter((i) => i.userId === userId && i.status !== 'failed');
}

/** This person's queued (not failed) changes that `item` must follow (task-writes.js `mustFollow`). */
const waitingTaskWrites = (q, item) =>
  q.filter((i) => i.userId === item.userId && i.status !== 'failed' && mustFollow(item, i));

/**
 * Queue a task change behind this person's queued changes it must follow (task-writes.js), so they
 * reach the server one at a time and in order: an edit or move behind the task's edits and moves
 * (H1), a list of tags, people or watching behind the same, a comment's edit behind that comment's,
 * a task's delete behind everything of that task. A queued edit continues their versions: it is
 * made against the newest version they expect (never an older one), which each replay moves on.
 * Resolves `{ item, syncNow }`, or null when nothing it follows is waiting (send it now). `syncNow`
 * is false while one of this person's waiting changes has already failed a try: syncing at once
 * would only spend another of its tries, so the next alarm or reconnect sends them.
 */
async function enqueueBehindTaskWrites(storage, item) {
  const taskId = taskIdOf(item);
  if (!item.userId || !taskId || !ORDERED_KINDS.has(item.kind)) return null;
  const { value } = await withLock(QUEUE_LOCK, async () => {
    const q = await readQueue(storage);
    const waiting = waitingTaskWrites(q, item);
    if (!waiting.length) return null;
    let payload = item.payload;
    if (item.kind === 'task.update') {
      const versions = waiting.map((i) => i.payload && i.payload.expectedVersion).filter((v) => typeof v === 'number');
      const own = payload && payload.expectedVersion;
      if (versions.length) payload = { ...payload, expectedVersion: Math.max(...versions, typeof own === 'number' ? own : -Infinity) };
    }
    const queued = {
      id: newIdempotencyKey(), kind: item.kind, payload, userId: item.userId, idempotencyKey: item.idempotencyKey || newIdempotencyKey(),
      queuedAt: Date.now(), attempts: 0, status: 'pending', lastError: null,
    };
    await storage.set({ [KEY]: [...q, queued] });
    const retrying = q.some((i) => i.userId === item.userId && i.status !== 'failed' && (i.attempts || 0) > 0);
    return { item: queued, syncNow: !retrying };
  });
  return value;
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

/**
 * Put a failed item back in line for the next sync — not one a later change has replaced
 * (`superseded`, task-writes.js): sent now, it would undo that change. It can only be discarded.
 */
export async function retryQueued(storage, id) {
  await mutateQueue(storage, (q) => q.map((i) => (i.id === id && !i.superseded ? { ...i, status: 'pending', attempts: 0, lastError: null } : i)));
}

/**
 * After `done` reached the server, this person's older changes of the same thing that failed are
 * marked replaced, or trimmed to what `done` didn't change (task-writes.js `supersede`), so trying
 * them again can't undo it. Only items before `done` in the queue are older; when `done` isn't in
 * the queue (sent now), all of them are.
 */
function supersedeOlder(q, done) {
  const at = q.findIndex((i) => i.id === done.id);
  return q.map((i, n) => (at === -1 || n < at ? supersede(done, i) : i));
}

/** The same for a change sent now: best effort (the queue can't be written: nothing to protect). */
async function supersedeQueued(storage, done) {
  try {
    const q = await readQueue(storage);
    if (!q.some((i) => supersede(done, i) !== i)) return;
    await mutateQueue(storage, (cur) => supersedeOlder(cur, done));
  } catch {
    /* ignore */
  }
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
      // H1: the version the edit was made against; the server refuses it when the task changed since.
      return {
        path: `/tasks/${p.id}`,
        init: { method: 'PUT', body: JSON.stringify({ ...(p.patch || {}), ...(typeof p.expectedVersion === 'number' ? { expectedVersion: p.expectedVersion } : {}) }) },
      };
    case 'task.assign':
      return post(`/tasks/${p.id}/assignees`, { userIds: p.userIds });
    case 'task.unassign':
      return { path: `/tasks/${p.id}/assignees/${p.userId}`, init: { method: 'DELETE' } };
    case 'comment.add':
      // A reply names the comment it answers.
      return post(`/tasks/${p.id}/comments`, { body: p.body, ...(p.parentId ? { parentId: p.parentId } : {}) });
    case 'comment.update':
      return { path: `/comments/${encodeURIComponent(p.commentId)}`, init: { method: 'PUT', body: JSON.stringify({ body: p.body }) } };
    case 'comment.delete':
      return { path: `/comments/${encodeURIComponent(p.commentId)}`, init: { method: 'DELETE' } };
    case 'task.tags':
      // The task's whole list of tag names (the server finds or makes each one). A change that knows
      // the list it started from (`base`) is sent over the task's tags as they are now (requestToSend).
      return { path: `/tasks/${p.id}/tags`, init: { method: 'PUT', body: JSON.stringify({ tags: p.tags || [] }) } };
    case 'task.watch':
      return post(`/tasks/${p.id}/watch`, {});
    case 'task.unwatch':
      return { path: `/tasks/${p.id}/watch`, init: { method: 'DELETE' } };
    case 'attachment.delete':
      return { path: `/attachments/${encodeURIComponent(p.attachmentId)}`, init: { method: 'DELETE' } };
    case 'task.delete':
      // One copy, or (`scope: 'series'`) every copy of a repeating series.
      return { path: `/tasks/${p.id}${p.scope === 'series' ? '?scope=series' : ''}`, init: { method: 'DELETE' } };
    case 'checklist.add':
      return post(`/tasks/${p.id}/checklist`, { text: p.text });
    case 'checklist.update':
      return { path: `/checklist/${p.itemId}`, init: { method: 'PUT', body: JSON.stringify(p.patch || {}) } };
    case 'notification.read':
      return { path: `/notifications/${p.id}/read`, init: { method: 'PUT' } };
    case 'notification.readAll':
      return post('/notifications/read-all', {});
    case 'chat.send':
      // The clientId is the Idempotency-Key: the server recognises a retried send by it even after
      // its stored replies have expired (24 hours), so a message is never posted twice.
      return post(`/conversations/${p.conversationId}/messages`, { body: p.body, ...(item.idempotencyKey ? { clientId: item.idempotencyKey } : {}) });
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
    case 'comment.add': return p.parentId ? 'Reply to a comment' : 'Comment on a task';
    case 'comment.update': return 'Edit a comment';
    case 'comment.delete': return 'Delete a comment';
    case 'task.tags': return 'Change a task’s tags';
    case 'task.watch': return 'Watch a task';
    case 'task.unwatch': return 'Stop watching a task';
    case 'attachment.delete': return `Delete the file “${p.filename || 'a file'}”`;
    case 'task.delete': return p.scope === 'series' ? 'Delete a repeating series' : 'Delete a task';
    case 'checklist.add': return `Checklist item “${p.text || ''}”`;
    case 'checklist.update': return 'Tick a checklist item';
    case 'notification.read': return 'Mark a notification read';
    case 'notification.readAll': return 'Mark all notifications read';
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
 * A 403 (no permission) can't succeed by trying again, so it fails at once, as on the web (L21).
 */
export function outcomeForStatus(status, code) {
  if (status === 401 || status === 429) return 'pause';
  if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') return 'pause';
  if (status === 408 || status >= 500) return 'retry';
  return 'fail';
}

/**
 * Read a 2xx write reply (M6): `{ ok: true, data }` for the server's answer (or a 204), `{ ok: false }`
 * when something else answered (a Wi-Fi sign-in page or a proxy) — the change did not reach the server.
 */
async function readReply(res) {
  if (res.status === 204) return { ok: true, data: undefined };
  const type = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : null;
  if (type && !/json/i.test(type)) return { ok: false };
  try {
    const json = await res.json();
    return { ok: true, data: json && json.data !== undefined ? json.data : json };
  } catch {
    return type ? { ok: false } : { ok: true, data: {} };
  }
}

function failureOutcome(e) {
  if (e && e.outcome) return e.outcome;
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'retry';
  return 'pause'; // network failure / session renewal unavailable
}

async function errorInfo(res) {
  try {
    const j = await res.json();
    return { code: j?.error?.code, message: j?.error?.message, details: j?.error?.details };
  } catch {
    return {};
  }
}

/**
 * The request to send for `item` now. A change of a task's tags that knows the list it started from
 * (`base`) reads the task's tags first and sends its own additions and removals over them, so a tag
 * someone else added or took off meanwhile stays as they left it (src/tags.js `mergeTagChange`).
 * Resolves `{ req }`; `{ res }` when that read was refused (the caller treats it as the change's
 * own answer); or `{ unreadable: true }` when something other than the server answered. Rejects
 * when the server can't be reached — the change waits, it never fails for that.
 */
async function requestToSend(item, doFetch) {
  const req = mutationRequest(item);
  const p = item.payload || {};
  if (!req || item.kind !== 'task.tags' || !Array.isArray(p.base)) return { req };
  const res = await doFetch(`/tasks/${p.id}/tags`, { method: 'GET' });
  if (!res.ok) return { res };
  const reply = await readReply(res);
  if (!reply.ok || !Array.isArray(reply.data)) return { unreadable: true };
  const current = reply.data.map((t) => t && t.name).filter((n) => typeof n === 'string');
  return { req: mutationRequest({ ...item, payload: { ...p, tags: mergeTagChange(current, p.base, Array.isArray(p.tags) ? p.tags : []) } }) };
}

/** Hand a task the server sent on (best effort: keeping the offline copy never fails a sync). */
async function keep(onTask, task) {
  if (!onTask) return;
  try {
    await onTask(task);
  } catch {
    /* ignore */
  }
}

function replayError(message, { status, code, outcome }) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  e.outcome = outcome;
  return e;
}

/**
 * A replayed edit the server refused because the task changed since it was made (H1). The task is
 * reloaded: when it already holds the edited values (the first try did reach the server, or someone
 * made the same change) the edit is done and resolves with the task; otherwise the stale edit is
 * dropped — marked failed with a plain message, shown in Settings → Sync. The reloaded task is kept
 * either way (`onTask`), so the next edit starts from it. A task that is gone or no longer this
 * person's to see (404 / 403) leaves the conflict standing; a reload that gets no usable answer (no
 * connection, a timeout, a 5xx, a page that isn't the server's) is tried again like any replay, as on
 * Android — the change it refused may well be this device's own.
 */
async function settleConflict(item, doFetch, onTask, code) {
  const p = item.payload || {};
  const unchecked = (outcome, status) => replayError('The task could not be reloaded to check this change.', { status, outcome });
  let res;
  try {
    res = await doFetch(`/tasks/${p.id}`, { method: 'GET' });
  } catch (e) {
    throw unchecked(failureOutcome(e));
  }
  if (!res.ok && res.status !== 403 && res.status !== 404) {
    throw unchecked(outcomeForStatus(res.status) === 'pause' ? 'pause' : 'retry', res.status);
  }
  let task = null;
  if (res.ok) {
    const reply = await readReply(res);
    task = reply.ok && reply.data && reply.data.id ? reply.data : null;
    if (!task) throw unchecked('pause');
  }
  if (task) await keep(onTask, task);
  if (task && patchHeld(task, p.patch)) return task;
  throw replayError(QUEUED_CONFLICT_MESSAGE, { status: 409, code, outcome: 'fail' });
}

/**
 * A delete the server answers "not found" (its own 404, not a proxy's page): the thing is already
 * gone — deleted by someone else, or by this change's first try — so the delete has done its job.
 * (The server looks a task up before it checks who may delete it, so a task that is gone answers
 * 404 for everyone, and its 403 is a real refusal: failed, with the server's words.)
 */
function alreadyGone(kind, status, code) {
  return DELETE_KINDS.has(kind) && status === 404 && code === 'NOT_FOUND';
}

/**
 * Build the `perform(item)` used to replay one queued mutation. `doFetch(path, init)` is the
 * caller's authenticated fetch, so the replay logic lives in ONE place for every surface. It
 * resolves with the server's answer (for an edit or move: the task, at its new version), which
 * `onTask(task)` also receives so the offline copy of the task can be kept up to date.
 */
export function makePerformMutation(doFetch, { onTask } = {}) {
  return async (item) => {
    if (!mutationRequest(item)) throw replayError(`unknown mutation: ${item.kind}`, { outcome: 'fail' });
    const prep = await requestToSend(item, doFetch);
    if (prep.unreadable) throw replayError('The server’s reply could not be read.', { outcome: 'pause' });
    const res = prep.res || (await doFetch(prep.req.path, prep.req.init));
    if (!res.ok) {
      const { code, message } = await errorInfo(res);
      if (item.kind === 'task.update' && isVersionConflict({ status: res.status, code })) return settleConflict(item, doFetch, onTask, code);
      if (alreadyGone(item.kind, res.status, code)) return undefined;
      throw replayError(message || `${item.kind} failed (${res.status})`, { status: res.status, code, outcome: outcomeForStatus(res.status, code) });
    }
    const reply = await readReply(res);
    // Something other than the server answered: like being offline, try again on the next sync.
    if (!reply.ok) throw replayError('The server’s reply could not be read.', { outcome: 'pause' });
    if (VERSIONED_KINDS.has(item.kind) && reply.data && reply.data.id) await keep(onTask, reply.data);
    return reply.data;
  };
}

function errorText(e) {
  if (e && typeof e.status === 'number') return `${e.status}${e.message ? ` — ${e.message}` : ''}`;
  return (e && e.message) || 'Unknown error';
}

/**
 * Replay the given user's queued mutations in FIFO order, one flusher at a time. Items are removed
 * by id as they succeed, and the queue is re-read before each item so changes queued (or discarded)
 * during the flush are respected. A synced edit or move of a task moves this person's later queued
 * edits of it on to the version it made (H1), in the same queue write that removes it.
 * Returns { synced, failed, remaining, paused, skipped }.
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
      let answer;
      try {
        answer = await perform(item);
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
      await mutateQueue(storage, (q) => supersedeOlder(q, item)
        .filter((i) => i.id !== item.id)
        .map((i) => (i.userId === userId ? rebaseQueuedVersion(item, answer, i) : i)));
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
 * An edit or move of a task that still has changes waiting to sync is queued behind them instead of
 * sent (H1: one at a time, in order); a reply that isn't the server's (M6) is kept for later too.
 * Only a change queued behind others says `syncNow: true` (sync straight away) — and not while a
 * waiting change keeps failing. One whose own send just failed waits for the next alarm or reconnect,
 * so a run of quick changes during an outage doesn't spend the first one's tries.
 * `onTask(task)` receives the server's task after an edit or move sent now (its new version).
 * `hold: true` never queues: when the server can't be reached it resolves `{ queued: false, held:
 * true, item }` instead (a new task with files, which can't wait offline, as on the web). Sending
 * `item` again with its `idempotencyKey` (`newKey`) can't create it twice.
 */
export async function sendOrQueue({ kind, payload }, { doFetch, storage, userId, newKey = newIdempotencyKey, onTask, hold = false }) {
  const item = { kind, payload, userId, idempotencyKey: newKey() };
  const req = mutationRequest(item);
  if (!req) throw new Error(`unknown mutation: ${kind}`);

  async function queueIt() {
    if (hold) return { queued: false, held: true, item };
    try {
      return { queued: true, item: await enqueue(storage, item) };
    } catch (e) {
      throw e instanceof QueueError ? e : new QueueError();
    }
  }

  if (userId && ORDERED_KINDS.has(kind) && !hold) {
    let behind = null;
    try {
      behind = await enqueueBehindTaskWrites(storage, item);
    } catch {
      behind = null; // the queue can't be read: send it now (the server's version check still guards edits)
    }
    if (behind) return { queued: true, item: behind.item, syncNow: behind.syncNow };
  }

  let res;
  try {
    const prep = await requestToSend(item, doFetch);
    if (prep.unreadable) return queueIt();
    res = prep.res || (await doFetch(prep.req.path, prep.req.init));
  } catch {
    return queueIt(); // offline, timed out, or the session couldn't be renewed right now
  }
  if (res.ok) {
    const reply = await readReply(res);
    if (!reply.ok) return queueIt();
    if (VERSIONED_KINDS.has(kind) && reply.data && reply.data.id) await keep(onTask, reply.data);
    if (userId && ORDERED_KINDS.has(kind) && storage) await supersedeQueued(storage, item);
    return { queued: false, data: reply.data };
  }
  if (QUEUE_ON_STATUS.has(res.status)) return queueIt();
  const { code, message, details } = await errorInfo(res);
  if (alreadyGone(kind, res.status, code)) return { queued: false, data: undefined };
  throw new ApiError(res.status, message, code, details);
}
