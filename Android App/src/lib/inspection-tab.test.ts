import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { websiteSays } from '../testing/phone-words';
import { INSPECTIONS_TAB_WORDS, dueCheckGroups, dueCheckWhen, inspectorsText, isFirstRun, startCheck, startTry, waitingBannerText } from './inspection-tab';
import { createPendingKeys } from './pending-keys';
import { ApiError, NetworkError } from './api-client';
import type { DueCheck, Person } from './inspection-types';
import type { WaitingInspection } from './inspection-outbox';

/** A project's Inspections tab (Stage 4 Task 10). */

const check = (taskId: string, dueDate: string, state: DueCheck['state'] = 'DUE', daysLate = 0): DueCheck => ({
  taskId,
  key: `RIG-${taskId}`,
  title: `Check ${taskId}`,
  dueDate,
  state,
  daysLate,
  scheduled: true,
  form: { id: 'f1', title: 'Rig check', deleted: false },
  place: null,
  assignees: [],
  inProgress: null,
});
const p = (name: string): Person => ({ id: name, name });
const w = (title: string): WaitingInspection => ({ inspectionId: title, projectId: 'pr1', title, pending: { answers: 1, finish: false, followUps: 0 }, problem: null, persisted: true });

it('due checks: late first, then today, then the rest, in the website’s words', () => {
  const g = dueCheckGroups([check('c1', '2026-10-27', 'LATE', 3), check('c2', '2026-10-30'), check('c3', '2026-10-31'), check('c4', '2026-11-04')], '2026-10-30');
  expect([g.late, g.today, g.upcoming].map((l) => l.map((c) => c.taskId))).toEqual([['c1'], ['c2'], ['c3', 'c4']]);
  expect(dueCheckWhen(g.late[0]!, '2026-10-30')).toEqual({ tone: 'danger', text: '3 days late' });
  expect(dueCheckWhen(g.today[0]!, '2026-10-30')).toEqual({ tone: 'strong', text: 'Due today' });
  expect(dueCheckWhen(g.upcoming[0]!, '2026-10-30')).toEqual({ tone: 'plain', text: 'Tomorrow' });
  expect(dueCheckWhen(g.upcoming[1]!, '2026-10-30').text).toBe('Wed 4 Nov');
});

it('inspectors, the waiting banner and the start check', () => {
  expect(inspectorsText([p('Ann Lee'), p('Omar Ali'), p('Sara Khan')])).toEqual({ text: 'Ann Lee +2', label: 'Inspectors: Ann Lee, Omar Ali and Sara Khan' });
  expect(inspectorsText([p('Ann Lee')])).toEqual({ text: 'Ann Lee', label: 'Inspectors: Ann Lee' });
  expect(inspectorsText([])).toEqual({ text: 'No inspector', label: 'No inspector' });
  expect(waitingBannerText([w('Rig check')])).toBe('1 inspection has changes saved on this phone, waiting to be sent: Rig check.');
  expect(waitingBannerText([w('A'), w('B')])).toBe('2 inspections have changes saved on this phone, waiting to be sent: A, B.');
  expect(waitingBannerText([])).toBeNull();
  expect(startCheck('', '')).toBe('Pick a form.');
  expect(startCheck('f1', 'x'.repeat(201))).toBe('A place can have at most 200 characters.');
  expect(startCheck('f1', 'x'.repeat(200))).toBeNull();
});

it('a project that never had an inspection, nor a form, gets one invitation', () => {
  const settled = { inspections: [], forms: [], checks: [], schedules: [], waiting: 0 };
  expect(isFirstRun(settled)).toBe(true);
  expect(isFirstRun({ ...settled, forms: undefined })).toBe(false);
  expect(isFirstRun({ ...settled, waiting: 1 })).toBe(false);
  expect(isFirstRun({ ...settled, schedules: [{}] })).toBe(false);
});

describe.skipIf(!hasWeb('frontend/src/components/inspections/ProjectInspectionsTab.tsx', 'frontend/src/components/inspections/ScheduledInspections.tsx'))('the website’s tab', () => {
  it('uses the website’s words (phone wordings excepted)', () => {
    const web = ['ProjectInspectionsTab.tsx', 'ScheduledInspections.tsx'].map((f) => readWeb(`frontend/src/components/inspections/${f}`));
    for (const [k, v] of Object.entries(INSPECTIONS_TAB_WORDS)) expect(websiteSays(web, v), k).toBe(true);
  });
});

it('the due checks and lists are read through the offline copy; schedules and forms are not', () => {
  const q = src('core/inspection-queries.ts');
  expect(q).toMatch(/reads\.read\(queryKey, dueChecksCopyKey\(projectId\)/);
  expect(q).toMatch(/reads\.read\(queryKey, inspectionListCopyKey\(projectId\)/);
  expect(q).toMatch(/reads\.read\(queryKey, taskInspectionsCopyKey\(taskId\)/);
  expect(q).not.toMatch(/reads\.read\([^)]*(forms|schedules)/i);
  expect(q).toMatch(/queryKey: \['project-inspections', projectId, 'checks'\]/);
});

it('a started inspection is kept on the phone at once, under one key per Start', () => {
  const q = src('core/inspection-queries.ts');
  expect(q).toMatch(/onSuccess: async \(detail\) => \{\s*\/\/[^\n]*\n\s*await inspections\.ready;[^]*outboxFor\(ownerId\)\.remember\(ownerId, detail\)/);
  expect(q).toMatch(/resources\.inspections\.start\(projectId, [^)]*v\.key\)/);
  expect(src('components/inspections/StartInspectionSheet.tsx')).toMatch(/newIdempotencyKey\(\)/);
});

it('the project has an Inspections tab, which a link can open', () => {
  const s = src('screens/ProjectDetailScreen.tsx');
  expect(s).toMatch(/\{ value: 'inspections', label: 'Inspections' \}/);
  expect(s).toMatch(/route\.params\.tab/);
  expect(src('navigation/types.ts')).toMatch(/ProjectDetail: \{ projectId: string; projectName\?: string; tab\?: 'inspections' \}/);
});

it('every inspection in the tab opens the Inspection screen', () => {
  for (const f of ['components/inspections/InspectionRow.tsx', 'components/inspections/DueChecksSection.tsx', 'components/project/InspectionsTab.tsx'])
    expect(src(f), f).toMatch(/navigate\('Inspection', \{ inspectionId/);
});

it('a due check keeps one Start key until the server answers: kept after a lost answer, new after a refusal (Final I8)', () => {
  let n = 0;
  const keys = createPendingKeys(() => `k${++n}`);
  const c = check('c1', '2026-10-30');
  const first = keys.keyFor(startTry('pr1', c));
  keys.settle(startTry('pr1', c), new NetworkError('Network request failed.'));
  expect(keys.keyFor(startTry('pr1', c))).toBe(first); // a second tap after no answer: the same Start
  keys.settle(startTry('pr1', c), new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Still on it'));
  expect(keys.keyFor(startTry('pr1', c))).toBe(first);
  keys.settle(startTry('pr1', c), new ApiError(422, 'FORM_DELETED', 'No'));
  expect(keys.keyFor(startTry('pr1', c))).not.toBe(first); // refused: the next tap is a new Start
  expect(startTry('pr1', c)).not.toBe(startTry('pr1', check('c2', '2026-10-30')));
  const d = src('components/inspections/DueChecksSection.tsx');
  expect(d).toMatch(/pendingKeys\.keyFor\(startTry\(projectId, check\)\)/);
  expect(d).toMatch(/pendingKeys\.settle\(startTry\(projectId, check\)(, e)?\)/);
  expect(d).not.toMatch(/newIdempotencyKey\(\)/);
  expect(src('components/inspections/StartInspectionSheet.tsx')).toMatch(/if \(!keepsKey\(e\)\) setKey\(newIdempotencyKey\(\)\)/);
});
