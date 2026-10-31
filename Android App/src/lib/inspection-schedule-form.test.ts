import { describe, it, expect } from 'vitest';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { websiteSays } from '../testing/phone-words';
import { ApiError } from './api-client';
import {
  NO_COLUMNS,
  SCHEDULE_WORDS,
  STALE_SCHEDULE,
  checkSchedule,
  checksColumn,
  editScheduleDraft,
  inspectorChanges,
  isStaleSchedule,
  newScheduleDraft,
  scheduleCreateBody,
  scheduleEditPatch,
  scheduleLines,
  withForm,
  withName,
  withPlace,
  withPreset,
  withStartsOn,
} from './inspection-schedule-form';
import type { InspectionSchedule } from './inspection-types';
import type { ApiColumn } from './types';

/** A project's inspection schedules: the schedule sheet's draft and checks (Stage 4 Task 12). */

const WD = [0, 1, 2, 3, 4];
const schedule = (over: Partial<InspectionSchedule> = {}): InspectionSchedule => ({
  taskId: 't1',
  key: 'RIG-1',
  version: 1,
  title: 'Rig check – Rig 3',
  form: { id: 'f1', title: 'Rig check', deleted: false },
  place: 'Rig 3',
  assignees: [{ id: 'u1', name: 'Ann Lee' }],
  rule: { freq: 'WEEKLY', interval: 1, weekdays: WD, createNext: 'ON_SCHEDULE' },
  repeat: 'Every working day',
  onSchedule: true,
  paused: false,
  nextDue: '2026-10-29',
  lastDone: '2026-10-27',
  openChecks: 1,
  lateChecks: 0,
  ...over,
});
const col = (id: string, category: ApiColumn['category'], position: number, enabled = true): ApiColumn => ({ id, projectId: 'pr1', name: id, category, position, color: '', enabled });

it('a new schedule: every working day, named from form and place, checked in the website’s order', () => {
  let d = newScheduleDraft('2026-10-28', WD);
  expect(d.preset).toBe('WORKING_DAYS');
  expect(checkSchedule(d, { today: '2026-10-28', editing: false })).toMatchObject({ ok: false, field: 'form', message: 'Pick a form.' });
  d = withPlace(withForm(d, { id: 'f1', title: 'Rig check' }), 'Rig 3');
  expect(d.name).toBe('Rig check – Rig 3');
  expect(checkSchedule(d, { today: '2026-10-28', editing: false })).toMatchObject({ field: 'inspectors', message: 'Pick at least one inspector.' });
  d = { ...d, inspectorIds: ['u1'], startsOn: '2026-10-27' };
  expect(checkSchedule(d, { today: '2026-10-28', editing: false })).toMatchObject({ field: 'startsOn', message: 'Pick today or a later day to start.' });
  expect(checkSchedule(d, { today: '2026-10-28', editing: true })).toEqual({ ok: true });
  expect(checkSchedule(withName(d, ' '), { today: '2026-10-28', editing: true })).toMatchObject({ field: 'name', message: 'Give the schedule a name.' });
  const ending = { ...d, startsOn: '2026-10-30', rule: { ...d.rule, until: '2026-10-31' } };
  expect(checkSchedule(ending, { today: '2026-10-28', editing: false })).toMatchObject({ field: 'repeat', message: 'The repeat can’t end before the first check.' });
});

it('the name follows the form and place until typed', () => {
  const typed = withName(withForm(newScheduleDraft('2026-10-28', WD), { id: 'f1', title: 'Rig check' }), 'Morning round');
  expect(withPlace(typed, 'Rig 9').name).toBe('Morning round');
  expect(withForm(newScheduleDraft('2026-10-28', WD), { id: 'f1', title: 'Rig check' }).name).toBe('Rig check');
});

it('weekly and monthly follow the start day; a preset keeps how it ends', () => {
  let d = withPreset(newScheduleDraft('2026-10-28', WD), 'WEEKLY', WD); // Wed
  expect(d.rule).toMatchObject({ freq: 'WEEKLY', weekdays: [3] });
  d = withStartsOn(d, '2026-11-02', WD); // Mon
  expect(d.rule).toMatchObject({ freq: 'WEEKLY', weekdays: [1] });
  d = withPreset({ ...d, rule: { ...d.rule, count: 5 } }, 'MONTHLY', WD);
  expect(d.rule).toMatchObject({ freq: 'MONTHLY', dayOfMonth: 2, count: 5 });
  const custom = withPreset(d, 'CUSTOM', WD);
  expect(custom.rule).toEqual(d.rule);
  expect(withStartsOn(withPreset(newScheduleDraft('2026-10-28', WD), 'DAILY', WD), '2026-11-02', WD).rule).toMatchObject({ freq: 'DAILY' });
});

it('the body makes its checks on schedule from the first check day', () => {
  // 30 Oct 2026 is a Friday, a day off.
  const d = { ...newScheduleDraft('2026-10-30', WD), formId: 'f1', formTitle: 'Rig check', name: 'Rig check', inspectorIds: ['u1'] };
  expect(scheduleCreateBody(d, 'pr1', 'col1')).toMatchObject({
    title: 'Rig check',
    projectId: 'pr1',
    columnId: 'col1',
    dueDate: '2026-11-01',
    recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: WD, createNext: 'ON_SCHEDULE' },
    inspectionFormId: 'f1',
    inspectionPlace: null,
    assigneeIds: ['u1'],
  });
  expect(scheduleCreateBody({ ...d, place: '  Rig 3 ' }, 'pr1', 'col1').inspectionPlace).toBe('Rig 3');
});

it('an edit sends only what changed, with the version it saw', () => {
  const s = schedule({ version: 4 });
  const d = editScheduleDraft(s, WD);
  expect(d).toMatchObject({ formId: 'f1', place: 'Rig 3', name: 'Rig check – Rig 3', nameTyped: false, preset: 'WORKING_DAYS', inspectorIds: ['u1'] });
  expect(scheduleEditPatch({ ...d, place: 'Rig 4' }, s)).toEqual({ inspectionPlace: 'Rig 4', expectedVersion: 4, requireNewest: true });
  expect(scheduleEditPatch(d, s)).toEqual({ expectedVersion: 4, requireNewest: true });
  expect(scheduleEditPatch(withPreset(d, 'DAILY', WD), s)).toEqual({ recurrenceRule: { freq: 'DAILY', interval: 1, createNext: 'ON_SCHEDULE' }, expectedVersion: 4, requireNewest: true });
  expect(scheduleEditPatch({ ...d, name: 'New name', formId: 'f2' }, s)).toEqual({ title: 'New name', inspectionFormId: 'f2', expectedVersion: 4, requireNewest: true });
  expect(editScheduleDraft(schedule({ title: 'Morning round' }), WD).nameTyped).toBe(true);
  expect(inspectorChanges({ ...d, inspectorIds: ['u2', 'u3'] }, s)).toEqual({ add: ['u2', 'u3'], remove: ['u1'] });
});

it('rows, columns and a stale list', () => {
  expect(scheduleLines(schedule({ nextDue: '2026-10-29', lastDone: null, lateChecks: 2 }), 'Asia/Muscat')).toMatchObject({ repeat: 'Every working day', next: 'Next due Thu 29 Oct', last: 'Not done yet', late: '2 late' });
  expect(scheduleLines(schedule({ nextDue: null, paused: true }), 'Asia/Muscat')).toMatchObject({ next: 'Paused', last: 'Last done 27 Oct 2026', late: null });
  expect(scheduleLines(schedule({ nextDue: null }), 'Asia/Muscat').next).toBe('No more checks');
  expect(scheduleLines(schedule({ nextDue: null, onSchedule: false }), 'Asia/Muscat').next).toBeNull();
  expect(checksColumn([col('d', 'DONE', 0), col('t', 'TODO', 1)])).toBe('t');
  expect(checksColumn([col('t', 'TODO', 2), col('b', 'BACKLOG', 1, false), col('p', 'IN_PROGRESS', 0)])).toBe('p');
  expect(checksColumn([col('d', 'DONE', 0)])).toBe('d');
  expect(checksColumn([])).toBeNull();
  expect(isStaleSchedule(new ApiError(409, 'RECURRENCE_NOT_NEWEST', 'x'))).toBe(true);
  expect(isStaleSchedule(new ApiError(409, 'VERSION_CONFLICT', 'x'))).toBe(true);
  expect(isStaleSchedule(new ApiError(409, 'OTHER', 'x'))).toBe(false);
  expect(isStaleSchedule(new Error('x'))).toBe(false);
});

describe.skipIf(!hasWeb('frontend/src/components/inspections/ScheduleDialog.tsx', 'frontend/src/components/inspections/ScheduledInspections.tsx'))('the website’s schedule words', () => {
  it('are the same', () => {
    const web = ['ScheduleDialog.tsx', 'ScheduledInspections.tsx'].map((f) => readWeb(`frontend/src/components/inspections/${f}`));
    for (const [k, v] of Object.entries(SCHEDULE_WORDS)) expect(websiteSays(web, v), k).toBe(true);
    for (const t of [NO_COLUMNS, STALE_SCHEDULE]) expect(websiteSays(web, t), t).toBe(true);
  });
});

it('the repeat editor has a check kind, and the inspectors field its own words', () => {
  const r = src('components/RecurrenceEditor.tsx');
  expect(r).toContain("kind?: 'task' | 'meeting' | 'check'");
  expect(r).toContain('Each check is made on its date, done or not.');
  expect(r).toMatch(/endsOnly\?: boolean/);
  expect(src('components/task-form/AssigneeField.tsx')).toMatch(/labels\?: \{ list: string; add: string; allChosen: string \}/);
});

it('schedules are made and changed through the tasks API, online, with the version they saw', () => {
  const sheet = src('components/inspections/ScheduleSheet.tsx');
  expect(sheet).toMatch(/createCheckSeries\(scheduleCreateBody\(/);
  expect(sheet).toMatch(/updateCheckSeries\(schedule\.taskId, scheduleEditPatch\(/);
  expect(src('components/inspections/SchedulesSection.tsx')).toMatch(/recurrenceRule: null, expectedVersion: [^,]+\.version, requireNewest: true/);
  expect(src('components/project/InspectionsTab.tsx')).toMatch(/<SchedulesSection/);
});
