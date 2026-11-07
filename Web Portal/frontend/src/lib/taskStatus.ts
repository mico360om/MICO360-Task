/**
 * Shared Kanban-stage (status) metadata — one source for the label and the theme-aware
 * colour of each column category, so status reads the same on the board, dashboard,
 * reports, project profile and My Tasks.
 *
 * 1.23.8: the colours are the one colour scheme's (lib/colour-scheme.ts, owner 6 Nov): Backlog grey · To do
 * slate · In progress blue · Blocked red · Review purple · Done green. Written as CSS values here (this file
 * is loaded on its own by the Android app's drift tests, so it imports nothing); a test checks they are the
 * scheme's (lib/colour-classes `statusColour`).
 */
export type TaskCategory = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

export const STATUS_META: Record<string, { label: string; color: string }> = {
  BACKLOG: { label: 'Backlog', color: 'rgb(var(--c-status-backlog))' },
  TODO: { label: 'To Do', color: 'rgb(var(--c-status-todo))' },
  IN_PROGRESS: { label: 'In Progress', color: 'rgb(var(--c-status-progress))' },
  BLOCKED: { label: 'Blocked', color: 'rgb(var(--c-status-blocked))' },
  REVIEW: { label: 'Review', color: 'rgb(var(--c-status-review))' },
  DONE: { label: 'Done', color: 'rgb(var(--c-status-done))' },
};

/** The display order of statuses (board order). */
export const STATUS_ORDER: TaskCategory[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];

const FALLBACK_STATUS = { label: 'To Do', color: 'rgb(var(--c-status-todo))' };
export const statusMeta = (category?: string | null): { label: string; color: string } =>
  STATUS_META[category ?? 'TODO'] ?? FALLBACK_STATUS;
