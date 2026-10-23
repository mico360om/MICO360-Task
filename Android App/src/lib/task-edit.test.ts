import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, NetworkError } from './api-client';
import { EDIT_TEXT, checkEditTask, editLeaveWarning, editSubmitLabel, editTaskDraft, formColumns, saveTaskEdit, scopeNote, startProblem, type EditDeps, type TaskDraft } from './task-form';
import type { ApiColumn, ApiTask } from './types';

const TZ = 'Asia/Muscat';
const task = (patch: Partial<ApiTask> = {}): ApiTask => ({
  id: 't1',
  key: 'MICO-7',
  title: 'Fix pump',
  description: 'Old seals',
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: '2026-10-19T09:30:00.000Z',
  dueDate: '2026-10-24T00:00:00.000Z',
  estimatedHours: null,
  progress: 0,
  completedAt: null,
  version: 7,
  ...patch,
});
const opened = editTaskDraft(task(), ['u1', 'u2'], TZ);
const deps = (over: Partial<EditDeps> = {}) => {
  const calls: unknown[][] = [];
  const d: EditDeps = {
    update: vi.fn(async (patch) => void calls.push(['update', patch])),
    move: vi.fn(async (columnId) => void calls.push(['move', columnId])),
    assign: vi.fn(async (ids) => void calls.push(['assign', ids])),
    unassign: vi.fn(async (id) => void calls.push(['unassign', id])),
    ...over,
  };
  return { d, calls };
};

describe('Edit task (4d): New task’s form with what the task holds, as the website’s Edit task', () => {
  it('opens with the task’s place, words, priority, days (company calendar days), repeat, people and milestone', () => {
    expect(opened).toEqual({
      projectId: 'p1',
      columnId: 'c1',
      title: 'Fix pump',
      description: 'Old seals',
      priority: 'NORMAL',
      dueDate: '2026-10-24',
      startDate: '2026-10-19',
      rule: null,
      assigneeIds: ['u1', 'u2'],
      milestone: false,
    });
  });

  it('checks the title, the repeat’s end and that the start is on or before the due date (the server’s words)', () => {
    expect(checkEditTask({ ...opened, title: '  ' }, opened)).toEqual({ ok: false, field: 'title', message: 'Give the task a title.' });
    expect(checkEditTask({ ...opened, startDate: '2026-10-25' }, opened)).toEqual({ ok: false, field: 'start', message: 'The start date must be on or before the due date.' });
    expect(startProblem('2026-10-24', '2026-10-24')).toBeNull();
    expect(startProblem('2026-10-25', '')).toBeNull();
    expect(checkEditTask({ ...opened, rule: { freq: 'DAILY', interval: 1, until: '2026-10-20' } }, opened)).toMatchObject({ ok: false, field: 'repeat' });
    expect(checkEditTask(opened, opened)).toEqual({ ok: true });
  });

  it('an older task whose start is after its due date can still be saved: the order is checked only when a date changes, as the server does (final review A4)', () => {
    const older = editTaskDraft(task({ startDate: '2026-10-26T09:30:00.000Z' }), ['u1'], TZ);
    expect([older.startDate, older.dueDate]).toEqual(['2026-10-26', '2026-10-24']);
    expect(checkEditTask({ ...older, title: 'Fix the pump' }, older)).toEqual({ ok: true });
    expect(checkEditTask({ ...older, dueDate: '2026-10-25' }, older)).toMatchObject({ ok: false, field: 'start' });
    expect(checkEditTask({ ...older, startDate: '2026-10-27' }, older)).toMatchObject({ ok: false, field: 'start' });
    expect(checkEditTask({ ...older, dueDate: '2026-10-28' }, older)).toEqual({ ok: true });
    const screen = readFileSync(resolve(__dirname, '../screens/NewTaskScreen.tsx'), 'utf8');
    expect(screen).toMatch(/const check = checkEditTask\(draft, saved\);/);
    // The note under the start date follows the same rule.
    expect(screen).toMatch(/\{startError \?\? editStartProblem\(draft, saved\) \? \(/);
    expect(screen).not.toMatch(/startProblem\(draft\.startDate, draft\.dueDate\)/);
  });

  it('sends only what changed, in one edit (with the series when chosen), then the column, then the people added and taken off', async () => {
    const { d, calls } = deps();
    const draft: TaskDraft = { ...opened, title: 'Fix the pump ', priority: 'HIGH', startDate: '', columnId: 'c2', assigneeIds: ['u2', 'u3'] };
    const out = await saveTaskEdit(d, draft, opened, { series: true, canRepeat: true });
    expect(calls).toEqual([
      ['update', { title: 'Fix the pump', priority: 'HIGH', startDate: null, scope: 'series' }],
      ['move', 'c2'],
      ['assign', ['u3']],
      ['unassign', 'u1'],
    ]);
    expect(out).toEqual({ kind: 'saved', saved: { ...draft } });
  });

  it('a new repeat for the whole series goes on its own (the rule lives on the newest copy only)', async () => {
    const { d, calls } = deps();
    const rule = { freq: 'WEEKLY' as const, interval: 1 };
    await saveTaskEdit(d, { ...opened, rule, priority: 'LOW' }, opened, { series: true, canRepeat: true });
    expect(calls).toEqual([
      ['update', { priority: 'LOW', scope: 'series' }],
      ['update', { recurrenceRule: rule }],
    ]);
    const one = deps();
    await saveTaskEdit(one.d, { ...opened, rule }, opened, { series: false, canRepeat: true });
    expect(one.calls).toEqual([['update', { recurrenceRule: rule }]]);
    // An earlier copy of a series can't change the repeat.
    const early = deps();
    await saveTaskEdit(early.d, { ...opened, rule }, opened, { series: false, canRepeat: false });
    expect(early.calls).toEqual([]);
  });

  it('what went is kept when a later step fails, so the next try sends only the rest; a colleague’s change is said plainly', async () => {
    const { d } = deps({ move: vi.fn(async () => Promise.reject(new ApiError(400, 'VALIDATION', 'That column is in another project.'))) });
    const draft = { ...opened, title: 'New title', columnId: 'c9' };
    const out = await saveTaskEdit(d, draft, opened, { series: false, canRepeat: true });
    expect(out).toEqual({ kind: 'failed', saved: { ...opened, title: 'New title' }, message: 'Couldn’t save all of the changes. That column is in another project.' });
    const conflict = await saveTaskEdit(deps({ update: vi.fn(async () => Promise.reject(new ApiError(409, 'VERSION_CONFLICT', 'x'))) }).d, draft, opened, { series: false, canRepeat: true });
    expect(conflict).toMatchObject({ kind: 'failed', message: EDIT_TEXT.conflict });
  });

  it('with no answer the changes are kept on this phone and sent later (all of them)', async () => {
    const { d, calls } = deps({ update: vi.fn(async () => Promise.reject(new NetworkError('offline'))) });
    const out = await saveTaskEdit(d, { ...opened, title: 'Offline title', assigneeIds: ['u1'] }, opened, { series: false, canRepeat: true });
    expect(out).toMatchObject({ kind: 'kept', message: 'Saved on this phone — will sync when you’re online.' });
    expect(calls).toEqual([['unassign', 'u2']]);
  });

  it('nothing changed: nothing is sent', async () => {
    const { d, calls } = deps();
    expect(await saveTaskEdit(d, opened, opened, { series: false, canRepeat: true })).toEqual({ kind: 'saved', saved: opened });
    expect(calls).toEqual([]);
  });

  it('its words: the website’s, and the series note says what really goes to every copy', () => {
    expect(editSubmitLabel(false)).toBe('Save changes');
    expect(editSubmitLabel(true)).toBe('Saving…');
    expect(editLeaveWarning()).toEqual({ title: 'Discard your changes?', message: 'Your changes to this task haven’t been saved.', stay: 'Keep editing', leave: 'Discard' });
    // The server shares only these with the other copies (SERIES_FIELDS): the start and due dates stay this task's.
    expect(scopeNote()).toBe('The title, description and priority go to every copy when you choose the series. Dates, the column and people change on this task only.');
    const web = readFileSync(resolve(__dirname, '../../../Web Portal/frontend/src/components/task-form/TaskFormDialog.tsx'), 'utf8');
    for (const w of [EDIT_TEXT.conflict, 'Discard your changes?', 'Your changes to this task haven’t been saved.', 'Save changes', 'Apply changes to', 'Entire series', 'This task']) expect(web).toContain(w);
    expect(EDIT_TEXT.legend).toBe('Apply changes to');
  });

  it('keeps the task’s own column on offer even when it is switched off', () => {
    const col = (id: string, enabled: boolean, position: number): ApiColumn => ({ id, projectId: 'p1', name: id, category: 'TODO', position, color: '#000', enabled });
    const cols = [col('c2', true, 1), col('c1', false, 0), col('c3', false, 2)];
    expect(formColumns(cols).map((c) => c.id)).toEqual(['c2']);
    expect(formColumns(cols, 'c1').map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});

describe('the Edit form on screen (4d)', () => {
  const src = (p: string) => {
    const full = resolve(__dirname, '..', p);
    return existsSync(full) ? readFileSync(full, 'utf8') : '';
  };

  it('is New task’s screen in an edit mode, opened from the task’s details', () => {
    const screen = src('screens/NewTaskScreen.tsx');
    expect(screen).toMatch(/const editId = params\.taskId \?\? '';/);
    expect(screen).toMatch(/editTaskDraft\(taskQ\.data, /);
    expect(screen).toMatch(/useSaveTaskEdit\(editId\)/);
    expect(screen).toMatch(/label="Start date \(optional\)"/);
    expect(screen).toMatch(/legend=\{EDIT_TEXT\.legend\}/);
    expect(screen).toMatch(/\{!editing && !noProjects && !created \? <DescribeTask/);
    expect(screen).toMatch(/\{!editing \? <FilesField/);
    expect(src('navigation/types.ts')).toMatch(/taskId\?: string/);
    expect(src('navigation/RootNavigator.tsx')).toMatch(/title: route\.params\?\.taskId \? 'Edit task' : 'New task'/);
    expect(src('components/task-detail/HeaderCard.tsx')).toMatch(/accessibilityLabel="Edit task"/);
    expect(src('screens/TaskDetailScreen.tsx')).toMatch(/navigation\.navigate\('NewTask', \{ taskId: task\.id \}\)/);
  });

  it('who is on the task, arriving after the form was filled without them (offline at first), is filled in — never “Nobody is assigned.” while people are (final review A8)', () => {
    const screen = src('screens/NewTaskScreen.tsx');
    expect(screen).toMatch(/peopleFilled\.current = !!assigneesQ\.data;/);
    expect(screen).toMatch(/if \(!editing \|\| !filled\.current \|\| peopleFilled\.current \|\| !assigneesQ\.data \|\| saving\) return;\s+peopleFilled\.current = true;\s+settle\(\{ assigneeIds: assigneesQ\.data\.map\(\(a\) => a\.id\) \}\);/);
  });

  it('saves each change through the task write path, against the version the form opened with', () => {
    const core = src('core/new-task.ts');
    expect(core).toMatch(/sendTaskEdit\(services, qc, taskId, patch, undefined, openedVersion\)/);
    expect(core).toMatch(/sendTaskMove\(services, \{ id: taskId, columnId, projectId, category \}\)/);
    expect(core).toMatch(/kind: 'task\.assign'/);
    expect(core).toMatch(/kind: 'task\.unassign'/);
  });
});
