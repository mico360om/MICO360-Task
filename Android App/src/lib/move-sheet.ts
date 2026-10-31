/**
 * The "Move to another project" sheet (the website's MoveTaskDialog), in words and rules: its titles
 * and buttons, the column note, what a move sends, and what a failure says. One sheet for one task or
 * many. The rule is the server's: administrators, or someone who manages both projects, may move a
 * task into an open project; people assigned who aren't on the new team need one answer for the
 * whole group (add them to the team, or unassign them). Pure.
 */
import { ApiError } from './api-client';
import type { AssigneeChoice, BulkMoveResult, MoveInput, MovePreview, MoveTargets } from './types';

/** A task to move, as the place it is moved from knows it. */
export interface MoveTaskRef {
  id: string;
  key: string;
  title: string;
  projectId: string;
}

/** The sheet's and its menus' words (the website's MoveTaskDialog, task menu and bulk bar). */
export const MOVE_TEXT = {
  title: 'Move to another project',
  project: 'Project',
  projectPlaceholder: 'Choose a project…',
  noProjects: 'No projects to move to',
  loading: 'Loading…',
  checking: 'Checking what will change…',
  previewFailed: 'Couldn’t check what would change.',
  column: 'Column',
  sameKind: 'Same kind of column as now',
  manyHint: 'Each task goes to the same kind of column it’s in now, or the first one when there isn’t one.',
  changes: 'What will change',
  cantMove: 'Can’t be moved',
  cantOpen: 'A task you can’t open',
  moveOne: 'Move task',
  moving: 'Moving…',
  chooseTeam: 'Choose whether to add them to the team or unassign them.',
  failedOne: 'Couldn’t move the task.',
  failedMany: 'Couldn’t move the tasks.',
  checkConnection: ' Check your connection and try again.',
  notMoved: 'Couldn’t be moved',
  done: 'Done',
  menuItem: 'Move to another project…',
  bulkButton: 'Move to project…',
} as const;

/**
 * The tasks the sheet shows: the ones it is given, or — while it slides away after its caller let go
 * of them — the last ones it had (final review A4: never "Move 0 tasks…" as it closes).
 */
export function sheetTasks(given: MoveTaskRef[], last: MoveTaskRef[]): MoveTaskRef[] {
  return given.length > 0 ? given : last;
}

/** "Move to another project" / "Move 3 tasks to another project". */
export function moveTitle(n: number): string {
  return n === 1 ? MOVE_TEXT.title : `Move ${n} tasks to another project`;
}

/** "RIG-4 · Check pumps" / "3 tasks selected". */
export function moveSubtitle(tasks: readonly MoveTaskRef[]): string {
  return tasks.length === 1 ? `${tasks[0]!.key} · ${tasks[0]!.title}` : `${tasks.length} tasks selected`;
}

/** "Move task" (one task), "Move 3 tasks" (several: how many can go), "Moving…". */
export function submitLabel(o: { single: boolean; movable: number; busy: boolean }): string {
  if (o.busy) return MOVE_TEXT.moving;
  if (o.single) return MOVE_TEXT.moveOne;
  return `Move ${o.movable} task${o.movable === 1 ? '' : 's'}`;
}

/**
 * The note under the column: one task whose suggested column is of another kind than its own (the
 * new project has none of its kind), while no column is chosen; several tasks, while none is chosen.
 * `columnId` is the column chosen ('' none).
 */
export function columnHint(o: { single: boolean; preview: MovePreview; columnId: string; statusLabel: (category: string) => string }): string | null {
  if (o.columnId) return null;
  if (!o.single) return MOVE_TEXT.manyHint;
  const t = o.preview.tasks.find((x) => x.canMove);
  const suggested = o.preview.columns.find((c) => c.id === t?.columnId);
  if (!t || !suggested || !t.currentCategory || suggested.category === t.currentCategory) return null;
  return `${o.preview.project.name} has no ${o.statusLabel(t.currentCategory)} column, so it goes to its first one.`;
}

/**
 * What a move sends: the project, the column only when one is chosen, and the answer for the people
 * not on the new team only when there are some — without that answer nothing is sent.
 */
export function moveInput(o: { projectId: string; columnId: string; choice: AssigneeChoice | null; outsiders: number }): MoveInput | { problem: string } {
  if (o.outsiders > 0 && !o.choice) return { problem: MOVE_TEXT.chooseTeam };
  return { projectId: o.projectId, ...(o.columnId ? { columnId: o.columnId } : {}), ...(o.outsiders > 0 && o.choice ? { assignees: o.choice } : {}) };
}

/** The server's own words when it gives them, else `fallback` and "Check your connection and try again." (the website's). */
function failureWords(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.message ? e.message : `${fallback}${MOVE_TEXT.checkConnection}`;
}

/**
 * Why a move failed. Someone assigned left the new team since the preview (the server's
 * ASSIGNEES_NOT_ON_TEAM): the question is asked again from a fresh preview.
 */
export function moveFailure(e: unknown, many: boolean): { message: string; rerunPreview: boolean } {
  return { message: failureWords(e, many ? MOVE_TEXT.failedMany : MOVE_TEXT.failedOne), rerunPreview: e instanceof ApiError && e.code === 'ASSIGNEES_NOT_ON_TEAM' };
}

/** Why "What will change" couldn't be read. */
export function previewProblem(e: unknown): string {
  return failureWords(e, MOVE_TEXT.previewFailed);
}

/** "RIG-4 · Check pumps", or — for a task the person can't see (no key) — says so. */
function keyLine(t: { key: string; title: string } | undefined): string {
  return t && t.key ? `${t.key} · ${t.title}` : MOVE_TEXT.cantOpen;
}

/** Several tasks: the ones that can't be moved, and why ("RIG-7 · Pumps: Already in Operations."). */
export function refusedLines(preview: MovePreview): string[] {
  return preview.tasks.filter((t) => !t.canMove).map((t) => `${keyLine(t)}: ${t.reason ?? ''}`);
}

/** After a bulk move: the ones that couldn't be moved, and the server's reason for each. */
export function failedLines(result: BulkMoveResult, preview: MovePreview | undefined, tasks: readonly MoveTaskRef[]): string[] {
  return result.results.flatMap((r) => (r.ok ? [] : [`${keyLine(preview?.tasks.find((x) => x.id === r.taskId) ?? tasks.find((x) => x.id === r.taskId))}: ${r.error.message}`]));
}

/** Where the person may move tasks, when the answer has that shape; null otherwise (the website's useMoveTargets). */
export function moveTargetsOf(data: unknown): MoveTargets | null {
  const t = data as MoveTargets | null;
  return t && typeof t === 'object' && Array.isArray(t.projects) && Array.isArray(t.managedProjectIds) ? t : null;
}
