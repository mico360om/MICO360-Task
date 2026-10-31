/** Pure helpers behind the task details screen (kept here so they can be tested without a device). */
import { appTimeZone, dueDayKey, formatDueDay, isOverdue, isTaskDone, type DateInput } from './due-date';
import { moveItem } from './list-order';
import { dayText, instantDayText } from './day-words';
import { isWaitingForApproval } from './approvals';
import { canManageProject } from './project-team';
import { ApiError, isNetworkError } from './api-client';
import { DELETE_NOT_ALLOWED, DELETE_SERIES_NOT_ALLOWED, mayDeleteSeries, mayDeleteTask } from './task-delete-rule';
import type { FeedEntry } from './activity-feed';
import type { ApiActivityEntry, ApiColumn, ApiTask, ApiTaskMeeting } from './types';

/** The due date field's value: the due day (company time), as the header and the website show it. */
export function dueFieldValue(dueDate: DateInput): string {
  return dueDayKey(dueDate) ?? '';
}

/** A failed action's message: offline, the server's own message, or the fallback. */
export function failureText(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return 'You’re offline — this needs a connection. Please try again.';
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * A failed AI suggestion's message. Running out of time is the AI being slow (a model still
 * loading), not a lost connection, so it says that; anything else reads as {@link failureText}.
 */
export function aiFailureText(e: unknown, fallback: string): string {
  if (isNetworkError(e) && (e as { timedOut?: unknown }).timedOut === true) return 'The AI is taking longer than usual. Please try again in a minute.';
  return failureText(e, fallback);
}

/** Someone else changed the task since it was loaded (the edit was refused): say so plainly. */
export function conflictText(e: unknown, fallback = 'Couldn’t save the change.'): string {
  if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') return 'Someone else changed this task. Pull down to reload it, then try again.';
  return failureText(e, fallback);
}

/** Whoever runs the project may delete its tasks: the server's canManageTask (lib/project-team canManageProject). */
export function canDeleteTask(
  user: { id: string; roles: string[] } | null,
  project: { canManage?: boolean } | null | undefined,
  members: readonly { id: string; role: 'MEMBER' | 'MANAGER' }[] = [],
): boolean {
  return canManageProject(user, project, members);
}

/**
 * Delete task on the task screen (the owner's rule, lib/task-delete-rule): offered to whoever may
 * delete tasks at all ({@link canDeleteTask}); of those, greyed out with the reason for a task they
 * didn't create that isn't assigned to them alone, and "the entire series" only for the series'
 * creator. The server says (canDelete / canDeleteSeries); an older one doesn't: the same rule here.
 */
export function deleteChoice(
  user: { id: string; roles: string[] } | null,
  project: { canManage?: boolean } | null | undefined,
  members: readonly { id: string; role: 'MEMBER' | 'MANAGER' }[],
  task: Pick<ApiTask, 'createdById' | 'canDelete' | 'canDeleteSeries'>,
  assigneeIds: readonly string[],
): { offered: boolean; blocked: string | null; seriesBlocked: string | null } {
  const offered = canDeleteTask(user, project, members);
  if (!offered || !user) return { offered: false, blocked: null, seriesBlocked: null };
  const facts = { viewerId: user.id, mayManage: true, createdById: task.createdById ?? '' };
  const one = task.canDelete ?? mayDeleteTask({ ...facts, assigneeIds });
  const all = task.canDeleteSeries ?? mayDeleteSeries({ ...facts, seriesCreatorId: facts.createdById });
  return { offered, blocked: one ? null : DELETE_NOT_ALLOWED, seriesBlocked: all ? null : DELETE_SERIES_NOT_ALLOWED };
}

/**
 * "Due 12 Oct 2026" / "Overdue · 8 Oct 2026" (company calendar day; a finished task is never
 * overdue, and neither is one waiting for approval — it says "Due <day>" and `waiting`).
 */
export function dueState(
  task: { dueDate: DateInput; completedAt?: DateInput; columnCategory?: string | null; approvalRequestedAt?: string | null },
  now: Date = new Date(),
  timeZone: string = appTimeZone(),
): { text: string | null; overdue: boolean; waiting: boolean; dayKey: string | null } {
  const waiting = !isTaskDone(task) && isWaitingForApproval(task);
  const dayKey = dueDayKey(task.dueDate, timeZone);
  if (!dayKey) return { text: null, overdue: false, waiting, dayKey: null };
  const day = formatDueDay(task.dueDate, timeZone);
  const overdue = isOverdue(task, now, timeZone);
  return { text: overdue ? `Overdue · ${day}` : `Due ${day}`, overdue, waiting, dayKey };
}

/**
 * The line naming the meeting a task was created from: its title and day (company time, "Fri 30
 * Oct" as the website's) and the meeting to open in the app, or — for someone not part of the
 * meeting — just a mention.
 */
export function meetingLine(
  meeting: ApiTaskMeeting | null | undefined,
  timeZone: string = appTimeZone(),
): { text: string; meetingId: string | null } | null {
  if (!meeting) return null;
  if (!meeting.canView || !meeting.title) return { text: 'From a meeting you’re not part of', meetingId: null };
  const day = meeting.startAt ? instantDayText(meeting.startAt, timeZone, { weekday: 'short', year: false }) : '';
  return {
    text: day ? `From meeting: ${meeting.title} · ${day}` : `From meeting: ${meeting.title}`,
    meetingId: meeting.id,
  };
}

/** The order with `id` moved one place up (-1) or down (+1); null when it can't move that way. */
export function moveBy(ids: string[], id: string, delta: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  return moveItem(ids, from, to);
}

export interface TaskRef {
  id: string;
  key: string;
  title: string;
  statusName?: string;
  statusCategory?: string;
  done: boolean;
}

/**
 * Linked tasks by id → key, title and status, from the tasks loaded and the project's columns (a
 * task in another project is done by its own column's stage). `loading` holds ids still on their way.
 */
export function blockerRefs(ids: string[], tasks: ApiTask[], columns: ApiColumn[], loading: Set<string> = new Set()): TaskRef[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const colById = new Map(columns.map((c) => [c.id, c]));
  return ids.map((id) => {
    const t = byId.get(id);
    if (!t) return loading.has(id) ? { id, key: '…', title: 'Loading…', done: false } : { id, key: id, title: 'Couldn’t load this task', done: false };
    const col = colById.get(t.columnId);
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      statusName: col?.name,
      statusCategory: col?.category,
      done: col ? col.category === 'DONE' : isTaskDone(t),
    };
  });
}

/** Activity rows → timeline entries, naming who did each thing. */
export function activityFeed(entries: ApiActivityEntry[], nameOf: (userId: string) => string): FeedEntry[] {
  return entries.map((a) => ({ id: a.id, action: a.action, actorName: a.actor?.name ?? nameOf(a.userId), createdAt: a.createdAt, meta: a.meta ?? null }));
}

/**
 * What to say when a task can't be opened: gone or not visible to you (no point retrying), no
 * answer from the server (check the connection), or anything else (try again).
 */
export function taskLoadProblem(error: unknown): { message: string; canRetry: boolean } {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return { message: 'This task wasn’t found, or you don’t have access to it. It may have been deleted.', canRetry: false };
  }
  if (isNetworkError(error)) return { message: 'Could not load this task. Check your connection and try again.', canRetry: true };
  return { message: 'Could not load this task. Please try again.', canRetry: true };
}

/**
 * The task's carry-forward history (4d), as the website's "Carried forward" chip: how many times and
 * since which day (per-date boards move an unfinished task on to the next day), and each move.
 * Days are calendar days ('YYYY-MM-DD'). Null when it never was carried forward.
 */
export function carryForward(log: readonly { from: unknown; to: unknown; at?: unknown }[] | null | undefined): { text: string; label: string; lines: string[] } | null {
  const moves = (Array.isArray(log) ? log : []).filter((e) => typeof e?.from === 'string' && typeof e?.to === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.from as string)) as { from: string; to: string }[];
  if (moves.length === 0) return null;
  const day = (key: string) => dayText(key);
  const since = day(moves[0]!.from);
  const n = moves.length;
  return {
    text: `Carried forward ${n}× · since ${since}`,
    label: `Carried forward ${n === 1 ? 'once' : `${n} times`}, since ${since}`,
    lines: moves.map((m) => `${day(m.from)} → ${day(m.to)}`),
  };
}

/** A part of the task screen, in the website's TaskDrawer words. */
export type TaskSection = 'approval' | 'description' | 'details' | 'checklist' | 'comments' | 'files' | 'blockers' | 'activity';

/**
 * The task screen's order, as the website's TaskDrawer (1.19): on a phone one column — the
 * description, the details, the checklist and the comments first, then approval, files and blockers,
 * then the history; on a wide screen the details, approval, files and blockers sit beside the work.
 * A task waiting for approval opens on its Approval section (`top`, above everything), shown once;
 * without `approval` the section isn't shown at all.
 */
export function taskSections(o: { wide: boolean; waiting: boolean; approval: boolean }): { top: TaskSection[]; main: TaskSection[]; side: TaskSection[] } {
  const besideWork: TaskSection[] = o.approval && !o.waiting ? ['approval', 'files', 'blockers'] : ['files', 'blockers'];
  const top: TaskSection[] = o.approval && o.waiting ? ['approval'] : [];
  if (o.wide) return { top, main: ['description', 'checklist', 'comments', 'activity'], side: ['details', ...besideWork] };
  return { top, main: ['description', 'details', 'checklist', 'comments', ...besideWork, 'activity'], side: [] };
}

/** What "Formerly RIG-4" means (the website's hint on it). */
export const FORMERLY_HINT = 'Its old number still finds it in search';

/** "Formerly RIG-4, OPS-2": the keys a task had before it moved to another project (oldest first); null for none. */
export function formerKeysText(keys: readonly string[] | null | undefined): string | null {
  return keys && keys.length > 0 ? `Formerly ${keys.join(', ')}` : null;
}
