/**
 * Durable offline mutation queue for the extension, backed by a
 * chrome.storage.local-compatible store ({ get(key), set(obj) }). Changes made
 * while offline are queued here and replayed on reconnect.
 */
const KEY = 'syncQueue';

async function readQueue(storage) {
  const o = await storage.get(KEY);
  return (o && o[KEY]) || [];
}
async function writeQueue(storage, q) {
  await storage.set({ [KEY]: q });
}
function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Add a mutation (e.g. { kind: 'task.create', payload }) to the queue. */
export async function enqueue(storage, mutation) {
  const q = await readQueue(storage);
  const item = { id: genId(), queuedAt: Date.now(), ...mutation };
  q.push(item);
  await writeQueue(storage, q);
  return item;
}

export async function getQueue(storage) {
  return readQueue(storage);
}

export async function queueSize(storage) {
  return (await readQueue(storage)).length;
}

export async function clearQueue(storage) {
  await writeQueue(storage, []);
}

/**
 * Replay queued mutations in FIFO order. `perform(item)` sends one mutation and
 * resolves on success. A rejection whose error has `permanent === true` drops the
 * item (it can never succeed); any other rejection keeps it for a later retry.
 * Returns { synced, dropped, remaining }.
 */
/**
 * Map a queued mutation to its HTTP request `{ path, init }`, or null for an unknown kind. Pure so
 * the whole offline-write surface is unit-testable. Payload shapes mirror the api.js mutations.
 */
export function mutationRequest(item) {
  const p = item.payload || {};
  switch (item.kind) {
    case 'task.create':
      return { path: '/tasks', init: { method: 'POST', body: JSON.stringify(p) } };
    case 'task.move':
      return { path: `/tasks/${p.id}/move`, init: { method: 'PATCH', body: JSON.stringify({ columnId: p.columnId, position: p.position }) } };
    case 'task.update':
      return { path: `/tasks/${p.id}`, init: { method: 'PUT', body: JSON.stringify(p.patch || {}) } };
    case 'task.assign':
      return { path: `/tasks/${p.id}/assignees`, init: { method: 'POST', body: JSON.stringify({ userIds: p.userIds }) } };
    case 'task.unassign':
      return { path: `/tasks/${p.id}/assignees/${p.userId}`, init: { method: 'DELETE' } };
    case 'comment.add':
      return { path: `/tasks/${p.id}/comments`, init: { method: 'POST', body: JSON.stringify({ body: p.body }) } };
    case 'checklist.add':
      return { path: `/tasks/${p.id}/checklist`, init: { method: 'POST', body: JSON.stringify({ text: p.text }) } };
    case 'checklist.update':
      return { path: `/checklist/${p.itemId}`, init: { method: 'PUT', body: JSON.stringify(p.patch || {}) } };
    case 'notification.read':
      return { path: `/notifications/${p.id}/read`, init: { method: 'PUT' } };
    case 'chat.send':
      return { path: `/conversations/${p.conversationId}/messages`, init: { method: 'POST', body: JSON.stringify({ body: p.body }) } };
    default:
      return null;
  }
}

/**
 * Build the `perform(item)` used to replay one queued mutation. `doFetch(path, init)` is the
 * caller's authenticated fetch (popup vs service worker differ only here), so the replay logic
 * and the permanent-vs-transient rule live in ONE place instead of being copy-pasted per surface.
 * 4xx (except 408/429) is permanent → the queue drops it; everything else is retried later.
 */
export function makePerformMutation(doFetch) {
  return async (item) => {
    const req = mutationRequest(item);
    if (!req) {
      const e = new Error(`unknown mutation: ${item.kind}`);
      e.permanent = true;
      throw e;
    }
    const res = await doFetch(req.path, req.init);
    if (!res.ok) {
      const e = new Error(`${item.kind} failed (${res.status})`);
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) e.permanent = true;
      throw e;
    }
  };
}

export async function flushQueue(storage, perform) {
  const q = await readQueue(storage);
  const remaining = [];
  let synced = 0;
  let dropped = 0;
  for (const item of q) {
    try {
      await perform(item);
      synced += 1;
    } catch (e) {
      if (e && e.permanent) dropped += 1;
      else remaining.push(item);
    }
  }
  await writeQueue(storage, remaining);
  return { synced, dropped, remaining: remaining.length };
}
