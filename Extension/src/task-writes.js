/**
 * Edits to a task carry the version they were made against (`expectedVersion`), and the server
 * refuses one made over someone else's change with 409 VERSION_CONFLICT (H1). Every save or move
 * bumps that version, so this device's own edits must each be sent against the version the one
 * before made — one at a time — or the second would be refused as "someone else's". The same rules
 * as the Android app's `lib/task-writes.ts`. Pure (no chrome APIs) so it is unit-testable.
 */

/** Queued kinds that change a task's version: an edit (which checks it) and a move (which bumps it). */
export const VERSIONED_KINDS = new Set(['task.update', 'task.move']);

/** Kinds whose payload `id` is the task they change. */
const TASK_KINDS = new Set([
  'task.update', 'task.move', 'task.assign', 'task.unassign', 'comment.add', 'checklist.add',
  'comment.update', 'comment.delete', 'task.tags', 'task.watch', 'task.unwatch', 'attachment.delete', 'task.delete',
]);

/** The task a queued change is about, or null. */
export function taskIdOf(item) {
  const id = item && TASK_KINDS.has(item.kind) && item.payload ? item.payload.id : null;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Changes of one thing that must reach the server in the order they were made, or an older one
 * replayed late would undo a newer one sent straight away: a task's edits and moves (they also carry
 * its version), its whole list of tags, its people, whether you watch it, and one comment's text.
 */
const LANE = {
  'task.update': 'version', 'task.move': 'version',
  'task.tags': 'tags',
  'task.assign': 'people', 'task.unassign': 'people',
  'task.watch': 'watch', 'task.unwatch': 'watch',
  'comment.update': 'comment', 'comment.delete': 'comment',
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
  const id = taskIdOf(next);
  if (!id || !waiting || taskIdOf(waiting) !== id) return false;
  if (next.kind === 'task.delete') return true;
  const lane = LANE[next.kind];
  if (!lane || LANE[waiting.kind] !== lane) return false;
  return lane !== 'comment' || (waiting.payload && waiting.payload.commentId) === (next.payload && next.payload.commentId);
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
