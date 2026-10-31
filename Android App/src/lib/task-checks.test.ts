import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { websiteSays } from '../testing/phone-words';
import { followUpOfLine, showTaskInspections, taskCheckCard, TASK_CHECK_WORDS } from './task-checks';
import { taskSections } from './task-detail';
import { withTaskCards } from './task-cards';
import { boardCard, cardView } from './board';
import { enrichMyTasks, myTaskLabel } from './my-tasks';
import type { InspectionListItem } from './inspection-types';
import type { ApiColumn, ApiProject, ApiTask } from './types';

/** Checks are tasks with a form: the marks, the task's Inspections card and its place (Stage 4 Task 20). */
const FORM = { id: 'f1', title: 'Rig check', deleted: false };
const li = (id: string, status: 'IN_PROGRESS' | 'FINISHED'): InspectionListItem =>
  ({ id, projectId: 'pr1', title: `Rig check ${id}`, status, place: null, startedAt: '2026-10-30T06:00:00Z', finishedAt: null, inspector: { id: 'u1', name: 'Ann' }, counts: { total: 3, answered: 1, passed: 1, failed: 0, na: 0 }, result: '1 of 3 answered', clientVisible: false, task: null }) as InspectionListItem;
const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-30T08:00:00Z');
const todoColumn = { id: 'c1', projectId: 'pr1', name: 'To do', category: 'TODO', position: 0, color: '#1E5A8B', enabled: true } as ApiColumn;
const task = (patch: Partial<ApiTask> = {}): ApiTask =>
  ({ id: 't1', key: 'RIG-1', title: 'Rig check', description: null, projectId: 'pr1', columnId: 'c1', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, progress: 0, completedAt: null, ...patch }) as ApiTask;
const project = { id: 'pr1', name: 'Rig 3', code: 'RIG', status: 'ACTIVE' } as ApiProject;

it('the task’s inspection card: continue, then report, then start', () => {
  expect(taskCheckCard({ form: FORM, place: 'Rig 3', attached: [li('i1', 'IN_PROGRESS')], canStart: true })).toMatchObject({ main: { kind: 'continue', inspectionId: 'i1' }, formLine: 'Rig check · Rig 3', another: 'another' });
  expect(taskCheckCard({ form: FORM, place: null, attached: [li('i2', 'FINISHED')], canStart: true }).main).toEqual({ kind: 'report', inspectionId: 'i2' });
  expect(taskCheckCard({ form: FORM, place: null, attached: [], canStart: true })).toMatchObject({ main: { kind: 'start' }, formLine: 'Rig check', another: null });
  expect(taskCheckCard({ form: FORM, place: null, attached: [], canStart: false }).main).toBeNull();
  expect(taskCheckCard({ form: null, place: null, attached: [], canStart: true })).toMatchObject({ main: null, formLine: null, another: 'forTask' });
  expect(taskCheckCard({ form: null, place: null, attached: [], canStart: true, noForms: true }).another).toBeNull();
  expect(taskCheckCard({ form: { ...FORM, deleted: true }, place: null, attached: [], canStart: true }).deletedNote).toBe(true);
});

it('a follow-up names its item and inspection; the card hides when it has nothing to say', () => {
  expect(followUpOfLine({ inspection: li('i1', 'FINISHED'), item: 'Rails' })).toEqual({ before: 'Follows up “Rails” from the inspection', title: 'Rig check i1', inspectionId: 'i1' });
  expect(followUpOfLine(null)).toBeNull();
  const none = { loaded: true, formsLoading: false, attached: [], followUpOf: null, offerStart: false, form: null };
  expect(showTaskInspections(none)).toBe(false);
  expect(showTaskInspections({ ...none, offerStart: true })).toBe(true);
  expect(showTaskInspections({ ...none, form: FORM })).toBe(true);
  expect(showTaskInspections({ ...none, form: FORM, loaded: false })).toBe(false);
  expect(showTaskInspections({ ...none, offerStart: true, formsLoading: true })).toBe(false);
});

it('a check’s card comes first on the task; any other task’s sits with the details, after the approval', () => {
  const check = withTaskCards(taskSections({ wide: false, waiting: true, approval: true }), { client: true, inspections: 'check' });
  expect(check.top).toEqual(['approval', 'inspections']);
  expect(check.main).not.toContain('inspections');
  expect(withTaskCards(taskSections({ wide: false, waiting: false, approval: true }), { client: true, inspections: 'other' }).main).toEqual([
    'description', 'details', 'checklist', 'comments', 'client', 'approval', 'inspections', 'files', 'blockers', 'activity',
  ]);
  expect(withTaskCards(taskSections({ wide: true, waiting: false, approval: true }), { client: false, inspections: 'other' }).side).toEqual(['details', 'approval', 'inspections', 'files', 'blockers']);
  expect(withTaskCards(taskSections({ wide: true, waiting: false, approval: true }), { client: false, inspections: null }).side).toEqual(['details', 'approval', 'files', 'blockers']);
});

it('a check is marked on cards and rows', () => {
  // Stage 2 built the board's mark (BoardCard.inspection, drawn by BoardCard.tsx; "Inspection." in its label).
  const card = boardCard(task({ inspectionFormId: 'f1' }), todoColumn);
  expect(card.inspection).toBe(true);
  expect(cardView(card, { now: NOW, timeZone: TZ }).label).toContain('Inspection.');
  const [row] = enrichMyTasks([task({ inspectionFormId: 'f1' })], [project], { timeZone: TZ, now: NOW });
  expect(row!.inspection).toBe(true);
  expect(myTaskLabel(row!)).toContain('Carried out with an inspection form.');
  expect(enrichMyTasks([task()], [project], { timeZone: TZ, now: NOW })[0]!.inspection).toBe(false);
});

describe.skipIf(!hasWeb('frontend/src/components/inspections/TaskInspections.tsx', 'frontend/src/components/task-form/TaskFormDialog.tsx', 'frontend/src/components/inspections/inspection-ui.tsx'))('the website’s', () => {
  it('words', () => {
    const web = ['components/inspections/TaskInspections.tsx', 'components/task-form/TaskFormDialog.tsx', 'components/inspections/inspection-ui.tsx'].map((f) => readWeb(`frontend/src/${f}`));
    for (const [k, v] of Object.entries(TASK_CHECK_WORDS)) expect(websiteSays(web, v) || web.some((w) => w.includes(`'${v}'`) || w.includes(`"${v}"`)), k).toBe(true);
    expect(web.join('\n')).toContain('Carried out with an inspection form');
  });
});

it('the chip is the word with the clipboard, on My Tasks too; Start goes through the kept start', () => {
  expect(src('components/ui/InspectionChip.tsx')).toMatch(/misc\.inspection[^]*Inspection/);
  expect(src('components/my-tasks/MyTaskItem.tsx')).toMatch(/row\.inspection \? <InspectionChip \/> : null/);
  const card = src('components/inspections/TaskInspectionsCard.tsx');
  expect(card).toMatch(/useStartInspection\(/);
  expect(card).toMatch(/navigate\('Inspection', \{ inspectionId/);
  expect(card).toMatch(/<StartInspectionSheet[^>]*fixedTask=/);
  expect(src('screens/TaskDetailScreen.tsx')).toMatch(/inspections: <TaskInspectionsCard/);
});
