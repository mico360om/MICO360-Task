import type { ApiTask } from './types';

/**
 * What the phone keeps offline (read-cache), named and capped. A project's tasks are kept per
 * board day looked at, and only the most recently loaded days stay; a task list too long to keep
 * whole is kept without the tasks finished long ago.
 */

/** Board days kept offline per person (the most recently loaded; older ones are deleted). */
export const BOARD_DAYS_KEPT = 14;

/** A list too long to keep whole leaves out tasks finished more than this many days ago. */
export const DONE_KEPT_DAYS = 30;

const BOARD_DAY = /^tasks\.[^.]+\.\d{4}-\d{2}-\d{2}$/;

/** The offline copy's name for a project's tasks: one board day, or all of them. */
export function projectTasksCopyKey(projectId: string, boardDate?: string): string {
  return `tasks.${projectId}.${boardDate ?? 'all'}`;
}

/** Is this the copy of one board day (one is kept per day looked at)? */
export function isBoardDayCopy(key: string): boolean {
  return BOARD_DAY.test(key);
}

/** A task list without the tasks finished more than DONE_KEPT_DAYS ago (every open one stays). */
export function withoutOldDone(now: number): (tasks: ApiTask[]) => ApiTask[] {
  const since = now - DONE_KEPT_DAYS * 86_400_000;
  return (tasks) =>
    tasks.filter((t) => {
      if (!t.completedAt) return true;
      const at = Date.parse(t.completedAt);
      return Number.isNaN(at) || at >= since;
    });
}
