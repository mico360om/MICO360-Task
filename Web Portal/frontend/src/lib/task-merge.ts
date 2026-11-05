import type { QueryClient } from '@tanstack/react-query';
import type { MoveTargets } from '../api/tasks';
import { invalidateTaskQueries } from './task-cache';
import type { MergeCounts, UndoPreview } from '../api/task-merge';
import { dayKeyIn, instantDayText } from './day-words';

/**
 * 1.23.1 Merge tasks, in words and rules the website shows: who sees "Merge" (the server's rule —
 * administrators, or someone who manages every project involved — checked again when merging), what
 * each task brings, the line on a task opened by a merged task's old number, and the checklist's
 * "From MICO-14" groups.
 */

/** The most tasks one merge takes. */
export const MAX_MERGE_TASKS = 10;

export interface MergeAvailability {
  /** Offer it at all (employees never see it). */
  show: boolean;
  /** Shown but unavailable: why (null when it can be used). */
  reason: string | null;
}

const manages = (targets: MoveTargets, projectId: string) => targets.managesAll || targets.managedProjectIds.includes(projectId);

/**
 * The task panel's "Merge with other tasks…": for administrators and whoever manages the task's project.
 * `readOnly`: why the task can't be merged now (its project is archived or completed).
 */
export function mergeAvailability(projectId: string, targets: MoveTargets | null | undefined, opts: { readOnly?: string | null } = {}): MergeAvailability {
  if (!targets || !manages(targets, projectId)) return { show: false, reason: null };
  return { show: true, reason: opts.readOnly ?? null };
}

/** My Tasks' "Merge…": 2–10 selected tasks, each in a project the person manages. */
export function bulkMergeAvailability(tasks: { projectId: string }[], targets: MoveTargets | null | undefined): MergeAvailability {
  if (!targets || tasks.length < 2 || !tasks.every((t) => manages(targets, t.projectId))) return { show: false, reason: null };
  if (tasks.length > MAX_MERGE_TASKS) return { show: true, reason: `Merge at most ${MAX_MERGE_TASKS} tasks at a time.` };
  return { show: true, reason: null };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 comments, 1 checklist item, 2 files…" — what a task brings to the merge. */
export function countsLine(c: MergeCounts): string {
  const parts = [
    c.comments ? plural(c.comments, 'comment') : null,
    c.checklist ? plural(c.checklist, 'checklist item') : null,
    c.files ? plural(c.files, 'file') : null,
    c.assignees ? plural(c.assignees, 'person', 'people') : null,
    c.watchers ? plural(c.watchers, 'watcher') : null,
    c.contacts ? plural(c.contacts, 'external contact') : null,
    c.tags ? plural(c.tags, 'tag') : null,
    c.blockers ? plural(c.blockers, 'blocker link') : null,
    c.actionItems ? plural(c.actionItems, 'action item') : null,
    c.inspections ? plural(c.inspections, 'inspection') : null,
    c.activity ? plural(c.activity, 'history entry', 'history entries') : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(', ') : 'Nothing besides its own fields';
}

/** "5 Nov" (with the year when it isn't this year's). */
function onDay(at: string, timeZone: string, today: string): string {
  const key = dayKeyIn(new Date(at), timeZone);
  return instantDayText(at, timeZone, { year: key.slice(0, 4) !== today.slice(0, 4) });
}

/** "MICO-14 was merged into this task on 5 Nov by Khurram." — a task opened by a merged task's number or link. */
export function mergeNoticeText(n: { key: string; mergedAt: string | null; mergedByName: string | null }, timeZone: string, today: string): string {
  const when = n.mergedAt ? ` on ${onDay(n.mergedAt, timeZone, today)}` : '';
  const who = n.mergedByName ? ` by ${n.mergedByName}` : '';
  return `${n.key} was merged into this task${when}${who}.`;
}

/** The main task's numbers from before a move ("Formerly …"), apart from the merged tasks' (its "Merged from" panel). */
export function mergedFromKeys(task: { formerKeys?: string[]; mergedFrom?: { id?: string; key: string; mergeId?: string }[] }): { former: string[]; merged: string[] } {
  const merged = (task.mergedFrom ?? []).map((m) => m.key);
  const set = new Set(merged);
  return { former: (task.formerKeys ?? []).filter((k) => !set.has(k)), merged };
}

/** What the Undo question says besides: what was deleted since, and that the main task stays where it is. */
export function undoNotes(p: Pick<UndoPreview, 'deletedSince' | 'mainMoved' | 'mainKey'>): string[] {
  return [...p.deletedSince, ...(p.mainMoved ? [`${p.mainKey} stays in ${p.mainMoved.toProject} (the merge moved it from ${p.mainMoved.fromProject}).`] : [])];
}

/**
 * The checklist in runs of the task each item came from: the main task's own items have no heading;
 * a run of a merged task's items is headed "From MICO-14". In list order, so reordering still works.
 */
export function checklistGroups<T extends { id: string }>(items: T[], labels: Record<string, string>): { fromKey: string | null; items: T[] }[] {
  const groups: { fromKey: string | null; items: T[] }[] = [];
  for (const item of items) {
    const fromKey = labels[item.id] ?? null;
    const last = groups[groups.length - 1];
    if (last && last.fromKey === fromKey) last.items.push(item);
    else groups.push({ fromKey, items: [item] });
  }
  return groups;
}

/** The task panel's own parts a merge or an undo changes (comments, files, checklist… of both sides), besides every task view. */
const MERGE_QUERY_ROOTS = ['comments', 'checklist', 'attachments', 'dependencies', 'task-watch', 'task-watchers', 'task-merges', 'merged-record', 'mentionable', 'task-inspections', 'move-targets'];

/** After a merge or an undo: refresh every view that shows tasks, and the open panel's parts. */
export async function invalidateMergeQueries(qc: QueryClient): Promise<void> {
  await Promise.all([invalidateTaskQueries(qc), ...MERGE_QUERY_ROOTS.map((root) => qc.invalidateQueries({ queryKey: [root] }))]);
}
