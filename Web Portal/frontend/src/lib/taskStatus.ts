/**
 * Shared Kanban-stage (status) metadata — one source for the label and the theme-aware
 * colour of each column category, so status reads the same on the board, dashboard,
 * reports, project profile and My Tasks.
 */
export type TaskCategory = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

export const STATUS_META: Record<string, { label: string; color: string }> = {
  BACKLOG: { label: 'Backlog', color: 'rgb(var(--c-cat-backlog))' },
  TODO: { label: 'To Do', color: 'rgb(var(--c-cat-todo))' },
  IN_PROGRESS: { label: 'In Progress', color: 'rgb(var(--c-cat-progress))' },
  BLOCKED: { label: 'Blocked', color: 'rgb(var(--c-cat-blocked))' },
  REVIEW: { label: 'Review', color: 'rgb(var(--c-cat-review))' },
  DONE: { label: 'Done', color: 'rgb(var(--c-cat-done))' },
};

/** The display order of statuses (board order). */
export const STATUS_ORDER: TaskCategory[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];

const FALLBACK_STATUS = { label: 'To Do', color: 'rgb(var(--c-cat-todo))' };
export const statusMeta = (category?: string | null): { label: string; color: string } =>
  STATUS_META[category ?? 'TODO'] ?? FALLBACK_STATUS;
