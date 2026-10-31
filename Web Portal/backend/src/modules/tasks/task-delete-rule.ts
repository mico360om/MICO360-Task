/**
 * Who may delete a task (the owner's rule, 1.20.0). Whoever may delete tasks at all — an admin, or
 * someone who runs the task's project — may delete one only if they created it, or it is assigned
 * to them and nobody else. A task assigned to several people is its creator's to delete; one
 * someone else created (assigned to others, or to nobody) is refused.
 *
 * A repeating task: deleting this copy follows the same rule on that copy; deleting the entire
 * series is only for the person who created the series — the `createdById` of its first task,
 * which every next copy carries over (prisma-recurrence-port), so any copy of the series says who.
 *
 * The server owns this file and decides; the website and the Android app keep identical copies and
 * the Chrome extension a plain-JavaScript one, so Delete is greyed out with the same reason the
 * server refuses with (a drift test in each fails when a copy differs). No imports: it is copied.
 */

/** The error code of a refusal under this rule (403). */
export const DELETE_NOT_ALLOWED_CODE = 'DELETE_NOT_ALLOWED';

/** Why Delete is greyed out, and what the server answers when it is sent anyway. */
export const DELETE_NOT_ALLOWED = 'Only the person who created this task, or the one person it’s assigned to, can delete it.';

/** Why "the entire series" is greyed out, and what the server answers when it is sent anyway. */
export const DELETE_SERIES_NOT_ALLOWED = 'Only the person who created this repeating task can delete the entire series.';

export interface TaskDeleteFacts {
  /** Who is asking. */
  viewerId: string;
  /** They may delete tasks in its project at all: an admin, or someone who runs the project. */
  mayManage: boolean;
  /** Who created the task. */
  createdById: string;
  /** Who it is assigned to. */
  assigneeIds: readonly string[];
}

/** May this person delete this task (or, for a repeating task, this copy of it)? */
export function mayDeleteTask(f: TaskDeleteFacts): boolean {
  if (!f.mayManage) return false;
  if (f.createdById === f.viewerId) return true;
  const people = new Set(f.assigneeIds);
  return people.size === 1 && people.has(f.viewerId);
}

/** May this person delete the entire series of a repeating task? Only the series' creator. */
export function mayDeleteSeries(f: { viewerId: string; mayManage: boolean; seriesCreatorId: string }): boolean {
  return f.mayManage && f.seriesCreatorId === f.viewerId;
}
