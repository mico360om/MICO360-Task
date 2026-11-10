import { create } from 'zustand';
import { dayKeyIn, instantDayText } from './day-words';
import { isProjectArchived } from './project-archive';

/**
 * Task archive (bulk lane; owner, 10 Nov 2026: "hide but keep"). An archived task is read-only and out of
 * every board and list; search still finds it, its project's "Archived tasks" list shows it, and Unarchive
 * brings it back. Administrators and the people who run its project archive and unarchive (the server
 * checks too); a task of an archived project can't be either until the project is reopened.
 */

/** The words of a task that can't be changed while archived (the server's own, 409 TASK_ARCHIVED). */
export const TASK_ARCHIVED_TEXT = 'This task is archived — unarchive it first.';

/** "3 Nov" this year, "3 Nov 2025" another — in the company's time zone. */
export function archivedDay(at: string, timeZone: string, now: Date = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = dayKeyIn(d, timeZone).slice(0, 4) === dayKeyIn(now, timeZone).slice(0, 4);
  return instantDayText(d, timeZone, { year: !sameYear });
}

/** The panel's banner: "Archived on 3 Nov by Ali — read-only" (who, when known). */
export function archivedBannerText(task: { archivedAt?: string | null }, byName: string | null | undefined, timeZone: string, now: Date = new Date()): string {
  if (!task.archivedAt) return '';
  const day = archivedDay(task.archivedAt, timeZone, now);
  return `Archived${day ? ` on ${day}` : ''}${byName ? ` by ${byName}` : ''} — read-only`;
}

/** A list row's line: "Archived 3 Nov by Ali". */
export function archivedLine(task: { archivedAt?: string | null }, byName: string | null | undefined, timeZone: string, now: Date = new Date()): string {
  if (!task.archivedAt) return '';
  const day = archivedDay(task.archivedAt, timeZone, now);
  return `Archived${day ? ` ${day}` : ''}${byName ? ` by ${byName}` : ''}`;
}

/**
 * May this person archive / unarchive the project's tasks? Administrators and whoever runs it (the
 * project's `canManage`), never in an archived project (the server refuses: reopen it first).
 */
export function mayArchiveTasks(opts: { isAdmin: boolean; project?: { canManage?: boolean; status: string; archived?: boolean } | null }): boolean {
  const { isAdmin, project } = opts;
  if (!project || isProjectArchived(project)) return false;
  return isAdmin || project.canManage === true;
}

/** The notice after an archive: "RIG-12 archived" with Undo (the app shell shows it: ArchiveUndoToast). */
export interface ArchiveNotice {
  text: string;
  taskId: string;
  key: string;
}

export const useArchiveNotice = create<{ notice: ArchiveNotice | null }>(() => ({ notice: null }));

export function showArchiveNotice(task: { id: string; key: string }): void {
  useArchiveNotice.setState({ notice: { text: `${task.key} archived`, taskId: task.id, key: task.key } });
}

export function clearArchiveNotice(): void {
  useArchiveNotice.setState({ notice: null });
}

/** The query key of a project's Archived tasks list. */
export const archivedTasksKey = (projectId: string) => ['project-archived-tasks', projectId] as const;
