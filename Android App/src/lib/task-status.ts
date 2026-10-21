import { isNetworkError } from './api-client';
import type { ApiColumn } from './types';

/** The plain name of each kind of board column (a task's status). */
export const CATEGORY_LABEL: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  DONE: 'Done',
};

/**
 * A task's status: its column (hidden columns included — a task can sit in one), else the kind of
 * column the server says it is in, else null.
 */
export function statusOf(
  task: { columnId: string; columnCategory?: string | null },
  columns: ApiColumn[],
): { name: string; category: string } | null {
  const column = columns.find((c) => c.id === task.columnId);
  if (column) return { name: column.name, category: column.category };
  if (task.columnCategory) return { name: CATEGORY_LABEL[task.columnCategory] ?? task.columnCategory, category: task.columnCategory };
  return null;
}

/**
 * Reload the board after a move? Not after a network error: the move is queued, a reload would get
 * no answer, and the sync refreshes the board once the move is sent. Otherwise yes (as the web does).
 */
export function refetchAfterMove(error: unknown): boolean {
  return !isNetworkError(error);
}
