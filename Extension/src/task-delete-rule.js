/**
 * Who may delete a task (the owner's rule, 1.20.0) — a plain-JavaScript copy of the server's
 * Web Portal/backend/src/modules/tasks/task-delete-rule.ts (task-delete-rule.test.js fails when the
 * two answer differently). Whoever may delete tasks at all — an admin, or someone who runs the
 * task's project — may delete one only if they created it, or it is assigned to them and nobody
 * else. Deleting the entire series of a repeating task is only for the person who created the
 * series (every copy carries its creator over, so any copy says who).
 */

/** The error code of a refusal under this rule (403). */
export const DELETE_NOT_ALLOWED_CODE = 'DELETE_NOT_ALLOWED';

/** Why Delete is greyed out, and what the server answers when it is sent anyway. */
export const DELETE_NOT_ALLOWED = 'Only the person who created this task, or the one person it’s assigned to, can delete it.';

/** Why "the whole series" is greyed out, and what the server answers when it is sent anyway. */
export const DELETE_SERIES_NOT_ALLOWED = 'Only the person who created this repeating task can delete the entire series.';

/** May this person delete this task (or this copy of a repeating one)? `{ viewerId, mayManage, createdById, assigneeIds }`. */
export function mayDeleteTask(f) {
  if (!f.mayManage) return false;
  if (f.createdById === f.viewerId) return true;
  const people = new Set(f.assigneeIds);
  return people.size === 1 && people.has(f.viewerId);
}

/** May this person delete the entire series of a repeating task? `{ viewerId, mayManage, seriesCreatorId }`. */
export function mayDeleteSeries(f) {
  return Boolean(f.mayManage) && f.seriesCreatorId === f.viewerId;
}
