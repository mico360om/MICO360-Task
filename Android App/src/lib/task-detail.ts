/** Pure helpers behind the task details screen (kept here so they can be tested without a device). */
import { COMPANY_TIMEZONE, dueDayKey, formatDueDay, isOverdue, type DateInput } from './due-date';
import { moveItem } from './list-order';
import { ApiError, isNetworkError } from './api-client';
import type { FeedEntry } from './activity-feed';
import type { ApiActivityEntry, ApiColumn, ApiTask } from './types';

/** Admins and the project's managers may delete a task (the server's rule). */
export function canDeleteTask(user: { id: string; roles: string[] } | null, members: { id: string; role: 'MEMBER' | 'MANAGER' }[]): boolean {
  if (!user) return false;
  if (user.roles.includes('ADMIN')) return true;
  return members.some((m) => m.id === user.id && m.role === 'MANAGER');
}

/** "Due Oct 12" / "Overdue · Oct 8" (company calendar day; a finished task is never overdue). */
export function dueState(
  task: { dueDate: DateInput; completedAt?: DateInput },
  now: Date = new Date(),
  locale?: string,
  timeZone: string = COMPANY_TIMEZONE,
): { text: string | null; overdue: boolean; dayKey: string | null } {
  const dayKey = dueDayKey(task.dueDate, timeZone);
  if (!dayKey) return { text: null, overdue: false, dayKey: null };
  const day = formatDueDay(task.dueDate, locale, timeZone);
  const overdue = isOverdue(task, now, timeZone);
  return { text: overdue ? `Overdue · ${day}` : `Due ${day}`, overdue, dayKey };
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

/** Linked tasks by id → key, title and status, from the project's tasks and columns. */
export function blockerRefs(ids: string[], tasks: ApiTask[], columns: ApiColumn[]): TaskRef[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const colById = new Map(columns.map((c) => [c.id, c]));
  return ids.map((id) => {
    const t = byId.get(id);
    if (!t) return { id, key: id, title: 'Task not in this project list', done: false };
    const col = colById.get(t.columnId);
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      statusName: col?.name,
      statusCategory: col?.category,
      done: col ? col.category === 'DONE' : Boolean(t.completedAt),
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
