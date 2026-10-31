import { describe, it, expect } from 'vitest';
import { assigneeChoiceLabels, notOnTeamText } from './task-move';
import { MOVE_TEXT, columnHint, failedLines, moveFailure, moveInput, moveSubtitle, moveTargetsOf, moveTitle, previewProblem, refusedLines, submitLabel, type MoveTaskRef } from './move-sheet';
import { ApiError, NetworkError } from './api-client';
import { hasWeb, readWeb } from '../testing/web-source';
import type { BulkMoveResult, MovePreview, TaskMovePreview } from './types';

/** An error isNetworkError recognises, built as the app's other tests build one. */
const networkError = () => new NetworkError('Network request failed.');
const people = [{ id: 'u1', name: 'Ann Lee' }, { id: 'u2', name: 'Omar Said' }];
/** row(o): one task of a move preview (movable, in To do, suggested column c1), changed by `o`. */
const row = (o: Partial<TaskMovePreview> = {}): TaskMovePreview => ({ id: 't1', key: 'RIG-4', title: 'Check pumps', from: { id: 'p1', code: 'RIG', name: 'Rig' }, canMove: true, reason: null, newKey: 'OPS-17', currentCategory: 'TODO', completed: false, columnId: 'c1', milestoneCleared: false, dueDate: null, repeat: null, outsiders: [], ...o });
/** A preview into Operations, whose columns are c1 (To do) and c2 (Done). */
const preview = (tasks: TaskMovePreview[]): MovePreview => ({
  project: { id: 'p2', code: 'OPS', name: 'Operations', status: 'ACTIVE', color: null, icon: null, imageUrl: null, defaultDueToday: false },
  columns: [{ id: 'c1', name: 'To do', category: 'TODO', position: 0, enabled: true }, { id: 'c2', name: 'Done', category: 'DONE', position: 1, enabled: true }],
  tasks,
  outsiders: [],
});
const STATUS: Record<string, string> = { TODO: 'To Do', REVIEW: 'Review', DONE: 'Done' };
const statusLabel = (c: string) => STATUS[c] ?? c;

it('Review Focus 3: asks once for the whole group when people aren’t on the new team', () => {
  expect(notOnTeamText(people, 'Operations')).toBe('Ann Lee and Omar Said aren’t on the Operations team.');
  expect(assigneeChoiceLabels(people)).toEqual({ add: 'Add them to the team', unassign: 'Unassign them' });
  expect(assigneeChoiceLabels(people.slice(0, 1))).toEqual({ add: 'Add Ann Lee to the team', unassign: 'Unassign Ann Lee' });
  expect(moveInput({ projectId: 'p2', columnId: '', choice: null, outsiders: 2 })).toEqual({ problem: 'Choose whether to add them to the team or unassign them.' });
  expect(moveInput({ projectId: 'p2', columnId: '', choice: 'UNASSIGN', outsiders: 2 })).toEqual({ projectId: 'p2', assignees: 'UNASSIGN' });
  expect(moveInput({ projectId: 'p2', columnId: 'c9', choice: 'ADD_TO_TEAM', outsiders: 0 })).toEqual({ projectId: 'p2', columnId: 'c9' });
});
it('Review Focus 3: the server’s "not on the team" asks again with a fresh preview; other failures say what happened', () => {
  const words = 'Ann Lee isn’t on the Operations team. Choose whether to add them to the team or unassign them.';
  expect(moveFailure(new ApiError(409, 'ASSIGNEES_NOT_ON_TEAM', words), false)).toEqual({ message: words, rerunPreview: true });
  expect(moveFailure(new ApiError(403, 'FORBIDDEN', 'You need to manage Operations to move tasks into it.'), false)).toEqual({ message: 'You need to manage Operations to move tasks into it.', rerunPreview: false });
  expect(moveFailure(networkError(), true)).toEqual({ message: 'Couldn’t move the tasks. Check your connection and try again.', rerunPreview: false });
  expect(moveFailure(networkError(), false).message).toBe('Couldn’t move the task. Check your connection and try again.');
  expect(previewProblem(networkError())).toBe('Couldn’t check what would change. Check your connection and try again.');
});
it('the sheet’s titles and buttons', () => {
  expect([moveTitle(1), moveTitle(3)]).toEqual(['Move to another project', 'Move 3 tasks to another project']);
  expect([submitLabel({ single: true, movable: 1, busy: false }), submitLabel({ single: false, movable: 1, busy: false }), submitLabel({ single: false, movable: 3, busy: false }), submitLabel({ single: true, movable: 1, busy: true })]).toEqual(['Move task', 'Move 1 task', 'Move 3 tasks', 'Moving…']);
  const refs: MoveTaskRef[] = [{ id: 't1', key: 'RIG-4', title: 'Check pumps', projectId: 'p1' }, { id: 't2', key: 'RIG-5', title: 'Seals', projectId: 'p1' }, { id: 't3', key: 'RIG-6', title: 'Valves', projectId: 'p1' }];
  expect([moveSubtitle(refs.slice(0, 1)), moveSubtitle(refs)]).toEqual(['RIG-4 · Check pumps', '3 tasks selected']);
});
it('the column note: one task whose kind the new project hasn’t; several go each to its own kind', () => {
  expect(columnHint({ single: true, preview: preview([row({ currentCategory: 'REVIEW' })]), columnId: '', statusLabel })).toBe('Operations has no Review column, so it goes to its first one.');
  expect(columnHint({ single: true, preview: preview([row()]), columnId: '', statusLabel })).toBeNull();
  expect(columnHint({ single: true, preview: preview([row({ currentCategory: 'REVIEW' })]), columnId: 'c2', statusLabel })).toBeNull(); // a column chosen
  expect(columnHint({ single: false, preview: preview([row(), row({ id: 't2' })]), columnId: '', statusLabel })).toBe(MOVE_TEXT.manyHint);
  expect(columnHint({ single: false, preview: preview([row(), row({ id: 't2' })]), columnId: 'c1', statusLabel })).toBeNull();
});
it('says which tasks can’t be moved, and which couldn’t, by number and title', () => {
  const p = preview([row(), row({ id: 't7', key: 'RIG-7', title: 'Pumps', canMove: false, reason: 'Already in Operations.' }), row({ id: 't9', key: '', title: '', canMove: false, reason: 'You can’t move it.' })]);
  expect(refusedLines(p)).toEqual(['RIG-7 · Pumps: Already in Operations.', 'A task you can’t open: You can’t move it.']);
  const r: BulkMoveResult = { moved: 1, failed: 1, results: [{ taskId: 't1', ok: false, error: { code: 'X', message: 'Changed meanwhile.' } }] };
  expect(failedLines(r, p, [])).toEqual(['RIG-4 · Check pumps: Changed meanwhile.']);
  expect(failedLines(r, undefined, [{ id: 't1', key: 'RIG-4', title: 'Check pumps', projectId: 'p1' }])).toEqual(['RIG-4 · Check pumps: Changed meanwhile.']);
});
it('where the person may move tasks: an answer of another shape is none', () => {
  const ok = { managesAll: false, managedProjectIds: ['p1'], projects: [] };
  expect(moveTargetsOf(ok)).toBe(ok);
  expect(moveTargetsOf({ projects: 'x' })).toBeNull(); expect(moveTargetsOf(null)).toBeNull();
});
describe.skipIf(!hasWeb('frontend/src/components/MoveTaskDialog.tsx', 'frontend/src/components/task-drawer/menus.tsx', 'frontend/src/components/BulkActionBar.tsx'))('the website’s words', () => {
  it('every sheet word', () => {
    const w = readWeb('frontend/src/components/MoveTaskDialog.tsx') + readWeb('frontend/src/components/task-drawer/menus.tsx') + readWeb('frontend/src/components/BulkActionBar.tsx');
    for (const t of Object.values(MOVE_TEXT)) expect(w, t).toContain(t.trim());
    // The website joins a fallback and the connection words: `${fallback} Check your connection and try again.`.
    expect(w).toContain('`${fallback} Check your connection and try again.`');
  });
});
