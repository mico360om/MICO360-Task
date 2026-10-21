/**
 * Edits to a task carry the version they were made against (`expectedVersion`), and the server
 * refuses one made over someone else's change with 409 VERSION_CONFLICT (H1). Every save or move
 * bumps that version, so this device's own edits must each be sent against the version the one
 * before made — one at a time — or the second would be refused as "someone else's". The same rules
 * as the Android app's `lib/task-writes.ts`. Pure (no chrome APIs) so it is unit-testable.
 */
import { tagKey } from './tags.js';

/** Queued kinds that change a task's version: an edit (which checks it) and a move (which bumps it). */
export const VERSIONED_KINDS = new Set(['task.update', 'task.move']);

/** Kinds whose payload `id` is the task they change. */
const TASK_KINDS = new Set([
  'task.update', 'task.move', 'task.assign', 'task.unassign', 'comment.add', 'checklist.add',
  'comment.update', 'comment.delete', 'task.tags', 'task.watch', 'task.unwatch', 'attachment.delete', 'task.delete',
  'checklist.update', // its payload carries the task's `id` beside the item's (queued before Stage 3: none)
]);

/** The task a queued change is about, or null. */
export function taskIdOf(item) {
  const id = item && TASK_KINDS.has(item.kind) && item.payload ? item.payload.id : null;
  return typeof id === 'string' && id ? id : null;
}

/**
 * What a queued change is about, for keeping changes of one thing in order: a task (its changes,
 * see LANE), or a conversation (its messages). Null for anything else.
 */
export function subjectOf(item) {
  const task = taskIdOf(item);
  if (task) return `task:${task}`;
  const p = item && item.kind === 'chat.send' ? item.payload || {} : null;
  return p && p.conversationId ? `chat:${p.conversationId}` : null;
}

/**
 * Changes of one thing that must reach the server in the order they were made, or an older one
 * replayed late would undo a newer one sent straight away: a task's edits and moves (they also carry
 * its version), its whole list of tags, its people, whether you watch it, and one comment's text.
 * A conversation's messages too: one kept on this device goes before the ones written after it.
 */
const LANE = {
  'task.update': 'version', 'task.move': 'version',
  'task.tags': 'tags',
  'task.assign': 'people', 'task.unassign': 'people',
  'task.watch': 'watch', 'task.unwatch': 'watch',
  'comment.update': 'comment', 'comment.delete': 'comment',
  'chat.send': 'chat',
};

/** Kinds sent behind this person's waiting changes they must follow (see `mustFollow`). */
export const ORDERED_KINDS = new Set([...Object.keys(LANE), 'task.delete']);

/** Deletes: one that finds nothing to delete (already gone) has done its job. */
export const DELETE_KINDS = new Set(['comment.delete', 'attachment.delete', 'task.delete']);

/**
 * Must `next` wait for `waiting` (a change still queued) to reach the server first? A change waits
 * behind the waiting changes of the same task in its line (LANE; for a comment, the same comment). A
 * task's delete waits behind every change of that task, so none of them fails on a deleted task.
 */
export function mustFollow(next, waiting) {
  const id = subjectOf(next);
  if (!id || !waiting || subjectOf(waiting) !== id) return false;
  if (next.kind === 'task.delete') return true;
  const lane = LANE[next.kind];
  if (!lane || LANE[waiting.kind] !== lane) return false;
  return lane !== 'comment' || (waiting.payload && waiting.payload.commentId) === (next.payload && next.payload.commentId);
}

/** Why a failed change can't be tried again (Settings → Sync shows it, with Discard only). */
export const SUPERSEDED_MESSAGE = 'A later change to the same thing was saved, so this one can’t be sent again.';

/** The tag names (as the server tells them apart) a change of tags adds or takes off; null: all of them. */
function tagsTouched(item) {
  const p = item.payload || {};
  if (!Array.isArray(p.base)) return null; // the whole list (queued before changes knew their start)
  const before = new Set(p.base.map(tagKey));
  const after = new Set((p.tags || []).map(tagKey));
  return new Set([...before, ...after].filter((k) => before.has(k) !== after.has(k)));
}

const peopleOf = (item) => {
  const p = item.payload || {};
  return item.kind === 'task.assign' ? (Array.isArray(p.userIds) ? p.userIds : []) : [p.userId];
};

const superseded = (item) => ({ ...item, superseded: true, lastError: SUPERSEDED_MESSAGE });

/**
 * `done` (a change of a task) has reached the server, after `older` — a change of the same thing
 * made before it — failed to sync. Sent late, `older` would undo `done`: tags or a person it put back,
 * watching again, an old comment text or column. Returns `older` itself when `done` didn't change what
 * it changes; for tags and people a copy without the names or people `done` changed, which can still
 * be tried; otherwise a copy marked `superseded`, which Settings offers to discard but not to try again.
 * (An edit carries the version it was made against, so the server already refuses a stale one.)
 */
export function supersede(done, older) {
  if (!done || !older || older.status !== 'failed' || older.superseded || older.userId !== done.userId) return older;
  if (done.kind === 'task.delete' || !mustFollow(done, older)) return older;
  const lane = LANE[done.kind];
  if (lane === 'chat') return older; // a later message never replaces an earlier one
  if (lane === 'version') return done.kind === 'task.move' && older.kind === 'task.move' ? superseded(older) : older;
  if (lane === 'tags') {
    const touched = tagsTouched(done);
    const p = older.payload || {};
    if (!touched || !Array.isArray(p.base)) return superseded(older);
    const left = (names) => (names || []).filter((n) => !touched.has(tagKey(n)));
    const base = left(p.base);
    const tags = left(p.tags);
    if (base.length === p.base.length && tags.length === (p.tags || []).length) return older;
    const rest = { ...p, base, tags };
    return tagsTouched({ payload: rest }).size ? { ...older, payload: rest } : superseded(older);
  }
  if (lane === 'people') {
    const touched = new Set(peopleOf(done));
    if (older.kind === 'task.unassign') return touched.has(older.payload && older.payload.userId) ? superseded(older) : older;
    const userIds = peopleOf(older).filter((u) => !touched.has(u));
    if (userIds.length === peopleOf(older).length) return older;
    return userIds.length ? { ...older, payload: { ...older.payload, userIds } } : superseded(older);
  }
  return superseded(older); // watching; one comment's text
}

/** The server refused an edit because the task changed since it was loaded. */
export function isVersionConflict(e) {
  return !!e && e.status === 409 && e.code === 'VERSION_CONFLICT';
}

/** What the person sees when their edit is refused (live, in the task drawer). */
export const CONFLICT_MESSAGE = 'Someone else changed this task, so your change was not saved. The latest version is shown — make your change again if it is still needed.';

/** Why a queued edit was dropped on sync (Settings → Sync shows it). */
export const QUEUED_CONFLICT_MESSAGE = 'Someone else changed this task first, so this change was not saved. Open the task to see the latest version.';

/**
 * After a queued task edit or move replays and the server answers with the task's new version R,
 * this device's later queued edit of that task made against R - 1 (the version before this device's
 * own write) now expects R. An edit made against any other version stays as it is, so it is still
 * refused when someone else changed the task in between. Returns `waiting` itself when unchanged.
 */
export function rebaseQueuedVersion(done, result, waiting) {
  if (!done || !VERSIONED_KINDS.has(done.kind)) return waiting;
  if (!waiting || waiting.kind !== 'task.update') return waiting;
  const made = result && result.version;
  if (typeof made !== 'number') return waiting;
  const p = waiting.payload;
  if (!p || p.id !== taskIdOf(done) || p.expectedVersion !== made - 1) return waiting;
  return { ...waiting, payload: { ...p, expectedVersion: made } };
}

const DAY_FIELDS = new Set(['dueDate', 'startDate']);
const isBlank = (v) => v === null || v === undefined || v === '';

/** Two values that mean the same: null and undefined alike; objects key by key (the server's anchorDay aside). */
function same(a, b) {
  if (isBlank(a) && isBlank(b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    keys.delete('anchorDay'); // added by the server to a saved repeat
    return [...keys].every((k) => same(a[k], b[k]));
  }
  return a === b;
}

/**
 * Whether `task` (the server's copy) already holds every value an edit set — then a replayed edit
 * the server refused as stale is already done, and is counted as synced rather than failed.
 */
export function patchHeld(task, patch) {
  if (!task || !patch) return false;
  return Object.entries(patch).every(([field, sent]) => {
    if (field === 'expectedVersion' || field === 'scope') return true;
    const current = task[field];
    if (DAY_FIELDS.has(field)) return isBlank(sent) ? isBlank(current) : !isBlank(current) && String(current).slice(0, 10) === String(sent).slice(0, 10);
    if (field === 'description') return (sent || '') === (current || '');
    return same(sent, current);
  });
}

/** Runs writes one after another, each once the one before has finished (failed or not). */
export function createWriteLane() {
  let tail = Promise.resolve();
  return {
    run(write) {
      const next = tail.then(write, write);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

/**
 * Keep the offline copy of a task (`task:<id>`) at the version a write of this device made, so an
 * edit made later from that copy is sent against it. Best effort; only a task already saved is updated.
 */
export async function rememberTask(cache, task) {
  if (!cache || typeof cache.merge !== 'function' || !task || typeof task.id !== 'string') return;
  try {
    await cache.merge(`task:${task.id}`, task);
  } catch {
    /* the cache is best effort */
  }
}
