import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import {
  BUILT_IN_VIEWS,
  DUE_OPTIONS,
  EMPTY_FILTERS,
  MY_TASKS_TEXT,
  OPEN_STATUS,
  PRIORITY_OPTIONS,
  SORT_OPTIONS,
  assigneeFilterOptions,
  chipState,
  dueLabel,
  enrichMyTasks,
  filterMyTasks,
  filtersActive,
  filtersEqual,
  myTaskCounts,
  myTaskLabel,
  projectFilterOptions,
  readSavedViews,
  savedViewsKey,
  selectedOf,
  showingText,
  sortMyTasks,
  statusFilterOptions,
  toggleAllVisible,
  toggleChip,
  withSavedView,
  withoutView,
  type TaskFilters,
} from './my-tasks';
import { BULK_LABELS, bulkResultText, clearDatesQuestion, doneColumnOf, runBulk, type BulkDeps } from './bulk-actions';
import { ApiError, NetworkError } from './api-client';
import type { ApiColumn, ApiProject, ApiTask } from './types';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-21T08:00:00Z'); // 21 Oct in Muscat
const task = (id: string, patch: Partial<ApiTask> & Record<string, unknown> = {}): ApiTask =>
  ({
    id,
    key: `MICO-${id}`,
    title: `Task ${id}`,
    description: null,
    projectId: 'a',
    columnId: 'c1',
    position: 0,
    priority: 'NORMAL',
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    progress: 0,
    completedAt: null,
    columnCategory: 'TODO',
    ...patch,
  }) as ApiTask;
const project = (id: string, name = `Project ${id}`): ApiProject => ({ id, code: id.toUpperCase(), name, description: null, status: 'ACTIVE' });
const f = (patch: Partial<TaskFilters> = {}): TaskFilters => ({ ...EMPTY_FILTERS, ...patch });

const tasks = [
  task('1', { dueDate: '2026-10-20', priority: 'URGENT', assignees: [{ id: 'u1', name: 'Ann Lee' }] as never }),
  task('2', { dueDate: '2026-10-21', priority: 'LOW', projectId: 'b', columnCategory: 'IN_PROGRESS', progress: 50 }),
  task('3', { dueDate: '2026-10-25', title: 'Alpha', assignees: [{ id: 'u2', name: 'Bo' }, { id: 'u1', name: 'Ann Lee' }] as never }),
  task('4', { dueDate: null, columnCategory: 'DONE', completedAt: '2026-10-19T10:00:00Z', progress: 100 }),
  task('5', { dueDate: '2026-11-30', priority: 'HIGH', projectId: 'b' }),
  task('6', { dueDate: '2026-10-01', columnCategory: 'DONE' }),
];
const projects = [project('a', 'Alpha Tower'), project('b', 'Bridge')];
const rows = enrichMyTasks(tasks, projects, { timeZone: TZ, now: NOW });

describe('My Tasks (4d): the website’s filters, chips and sort', () => {
  it('works out each task’s status, done, overdue, due today and day, in company time; a finished task is never overdue', () => {
    const by = Object.fromEntries(rows.map((r) => [r.task.id, r]));
    expect(by['1']).toMatchObject({ cat: 'TODO', done: false, overdue: true, dueToday: false, dueKey: '2026-10-20', dueLabel: 'Oct 20' });
    expect(by['2']).toMatchObject({ cat: 'IN_PROGRESS', overdue: false, dueToday: true });
    expect(by['6']).toMatchObject({ done: true, overdue: false });
    expect(by['1']!.project?.name).toBe('Alpha Tower');
  });

  it('counts All, Open, Overdue and Completed over every task (not the filtered ones)', () => {
    expect(myTaskCounts(rows)).toEqual({ total: 6, open: 4, overdue: 1, done: 2 });
  });

  it('filters by project, status (or Open), priority, assignee and due date, as the website does', () => {
    const ids = (filters: TaskFilters) => filterMyTasks(rows, filters, { timeZone: TZ, now: NOW }).map((r) => r.task.id);
    expect(ids(f({ project: 'b' }))).toEqual(['2', '5']);
    expect(ids(f({ status: OPEN_STATUS }))).toEqual(['1', '2', '3', '5']);
    expect(ids(f({ status: 'DONE' }))).toEqual(['4', '6']);
    expect(ids(f({ priority: 'URGENT' }))).toEqual(['1']);
    expect(ids(f({ assignee: 'u1' }))).toEqual(['1', '3']);
    expect(ids(f({ due: 'overdue' }))).toEqual(['1']);
    expect(ids(f({ due: 'today' }))).toEqual(['2']);
    expect(ids(f({ due: 'week' }))).toEqual(['2', '3']);
    expect(ids(f({ due: 'none' }))).toEqual(['4']);
    // Search (the app's own box) narrows by title, key or description.
    expect(filterMyTasks(rows, f(), { timeZone: TZ, now: NOW, q: 'alph' }).map((r) => r.task.id)).toEqual(['3']);
    expect(filterMyTasks(rows, f(), { timeZone: TZ, now: NOW, q: 'mico-5' }).map((r) => r.task.id)).toEqual(['5']);
  });

  it('sorts by due date (none last), priority, progress (most first) or title', () => {
    const ids = (sort: string) => sortMyTasks(rows, sort).map((r) => r.task.id);
    expect(ids('due')).toEqual(['6', '1', '2', '3', '5', '4']);
    expect(ids('priority')).toEqual(['1', '5', '3', '4', '6', '2']);
    expect(ids('progress')).toEqual(['4', '2', '1', '3', '5', '6']);
    expect(ids('title').slice(0, 1)).toEqual(['3']);
  });

  it('offers the website’s choices: the projects and people of my tasks, the statuses present', () => {
    expect(projectFilterOptions(tasks, projects)).toEqual([
      { value: '', label: 'All projects' },
      { value: 'a', label: 'Alpha Tower' },
      { value: 'b', label: 'Bridge' },
    ]);
    expect(statusFilterOptions(rows)).toEqual([
      { value: '', label: 'All statuses' },
      { value: OPEN_STATUS, label: 'Open (not completed)' },
      { value: 'TODO', label: 'To Do' },
      { value: 'IN_PROGRESS', label: 'In Progress' },
      { value: 'DONE', label: 'Done' },
    ]);
    expect(assigneeFilterOptions(tasks)).toEqual([
      { value: '', label: 'Anyone' },
      { value: 'u1', label: 'Ann Lee' },
      { value: 'u2', label: 'Bo' },
    ]);
    expect(SORT_OPTIONS.map((o) => o.label)).toEqual(['Due date', 'Priority', 'Progress', 'Title (A–Z)']);
    expect(DUE_OPTIONS.map((o) => o.label)).toEqual(['Any due date', 'Overdue', 'Due today', 'Next 7 days', 'No due date']);
    expect(PRIORITY_OPTIONS.map((o) => o.label)).toEqual(['All priorities', 'Urgent', 'High', 'Normal', 'Low']);
  });

  it('the chips: All clears the filters; Open, Overdue and Completed turn on and off', () => {
    expect(toggleChip(f({ priority: 'HIGH' }), 'all')).toEqual(EMPTY_FILTERS);
    expect(toggleChip(f(), 'open')).toEqual(f({ status: OPEN_STATUS }));
    expect(toggleChip(f({ status: OPEN_STATUS }), 'open')).toEqual(f());
    expect(toggleChip(f(), 'overdue')).toEqual(f({ due: 'overdue' }));
    expect(toggleChip(f(), 'completed')).toEqual(f({ status: 'DONE' }));
    expect(chipState(f())).toEqual({ all: true, open: false, overdue: false, completed: false });
    expect(chipState(f({ status: 'DONE' }))).toEqual({ all: false, open: false, overdue: false, completed: true });
    expect(filtersActive(f({ sort: 'title' }))).toBe(false);
    expect(filtersActive(f({ due: 'none' }))).toBe(true);
  });

  it('says how many show, and each task in words for TalkBack', () => {
    expect(showingText(3, 10, true)).toBe('Showing 3 of 10 tasks');
    expect(showingText(1, 1, false)).toBe('Showing 1 task');
    const r1 = rows.find((r) => r.task.id === '1')!;
    expect(dueLabel(r1)).toBe('Overdue · Oct 20');
    expect(dueLabel(rows.find((r) => r.task.id === '2')!)).toBe('Due today');
    expect(dueLabel(rows.find((r) => r.task.id === '4')!)).toBe('No due date');
    expect(myTaskLabel(r1)).toBe('MICO-1, Task 1. Alpha Tower. To Do. Urgent priority. Overdue · Oct 20. 0% done. Ann Lee.');
  });

  it('a selection covers only what is shown; Select all selects (or clears) the shown ones', () => {
    const shown = rows.slice(0, 3);
    expect(selectedOf(shown, new Set(['1', '5'])).map((r) => r.task.id)).toEqual(['1']);
    expect([...toggleAllVisible(shown, new Set(['1']))]).toEqual(['1', '2', '3']);
    expect([...toggleAllVisible(shown, new Set(['1', '2', '3']))]).toEqual([]);
  });
});

describe('saved views (4d), kept on this phone per person, as the website keeps them in the browser', () => {
  it('has the website’s three to start from', () => {
    expect(BUILT_IN_VIEWS.map((v) => v.name)).toEqual(['My overdue', 'This sprint', 'Urgent open']);
  });

  it('saves a view (a name used again replaces it), deletes one, and reads them back safely', () => {
    let views = withSavedView([], 'Bridge work', f({ project: 'b' }), () => 'view:1');
    views = withSavedView(views, 'bridge WORK ', f({ project: 'b', due: 'week' }), () => 'view:2');
    expect(views).toEqual([{ id: 'view:2', name: 'bridge WORK', filters: f({ project: 'b', due: 'week' }) }]);
    expect(withoutView(views, 'view:2')).toEqual([]);
    expect(readSavedViews(JSON.stringify(views))).toEqual(views);
    expect(readSavedViews('{"bad":1}')).toEqual([]);
    expect(readSavedViews('nope')).toEqual([]);
    expect(readSavedViews(JSON.stringify([{ id: 'v', name: 'Old', filters: { project: 'a' } }]))).toEqual([{ id: 'v', name: 'Old', filters: f({ project: 'a' }) }]);
    expect(savedViewsKey('u1')).toBe('mico360.mytasks.views.u1');
    expect(filtersEqual(f({ due: 'overdue' }), BUILT_IN_VIEWS[0]!.filters)).toBe(true);
  });
});

describe('bulk actions (4d), as the website’s: one at a time, each through the task’s own write', () => {
  const refs = [
    { id: '1', projectId: 'a' },
    { id: '2', projectId: 'b' },
    { id: '3', projectId: 'a' },
  ];
  const deps = (over: Partial<BulkDeps> = {}): BulkDeps => ({
    update: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    assign: vi.fn(async () => undefined),
    doneColumnFor: vi.fn(async (t) => (t.projectId === 'a' ? 'done-a' : null)),
    ...over,
  });

  it('completes into each project’s Done column (one without is counted as not done)', async () => {
    const d = deps();
    expect(await runBulk(refs, { type: 'complete' }, d)).toEqual({ succeeded: 2, failed: 1, kept: 0 });
    expect(d.move).toHaveBeenCalledWith(refs[0], 'done-a');
    expect(d.move).toHaveBeenCalledTimes(2);
  });

  it('a change with no answer is kept on this phone (counted apart), a refusal is counted as not done', async () => {
    let n = 0;
    const d = deps({
      update: vi.fn(async () => {
        n += 1;
        if (n === 1) throw new NetworkError('offline');
        if (n === 2) throw new ApiError(409, 'VERSION_CONFLICT', 'Changed by someone else.');
      }),
    });
    expect(await runBulk(refs, { type: 'setPriority', priority: 'HIGH' }, d)).toEqual({ succeeded: 1, failed: 1, kept: 1 });
    expect(d.update).toHaveBeenCalledWith(refs[2], { priority: 'HIGH' });
  });

  it('says how it went, in the website’s words', () => {
    expect(bulkResultText(BULK_LABELS.complete, { succeeded: 3, failed: 0, kept: 0 })).toBe('Completed 3 tasks.');
    expect(bulkResultText(BULK_LABELS.setPriority, { succeeded: 1, failed: 0, kept: 0 })).toBe('Set priority on 1 task.');
    expect(bulkResultText(BULK_LABELS.assign, { succeeded: 2, failed: 1, kept: 0 })).toBe('Assigned 2, 1 couldn’t be updated.');
    expect(bulkResultText(BULK_LABELS.move, { succeeded: 1, failed: 0, kept: 2 })).toBe('Moved 1 task. 2 saved on this phone — will sync when you’re online.');
    expect(clearDatesQuestion(1)).toBe('Clear the due date on 1 task?');
    expect(clearDatesQuestion(4)).toBe('Clear the due date on 4 tasks?');
    expect(MY_TASKS_TEXT.subtitle).toBe('Everything assigned to you, across every project.');
  });

  it('the Done column: a shown one first, else any (the website’s rule)', () => {
    const col = (id: string, category: string, enabled = true): ApiColumn => ({ id, projectId: 'a', name: id, category: category as ApiColumn['category'], position: 0, color: '#000', enabled });
    expect(doneColumnOf([col('x', 'TODO'), col('d1', 'DONE', false), col('d2', 'DONE')])).toBe('d2');
    expect(doneColumnOf([col('d1', 'DONE', false)])).toBe('d1');
    expect(doneColumnOf([col('x', 'TODO')])).toBeNull();
  });
});

describe('My Tasks follows the website (drift)', () => {
  const web = (p: string) => readFileSync(resolve(__dirname, '../../../Web Portal/frontend/src', p), 'utf8');
  const load = (p: string, req: (name: string) => unknown = () => ({})) => {
    const { code } = transformSync(web(p), { loader: 'ts', format: 'cjs' });
    const mod = { exports: {} as Record<string, unknown> };
    new Function('module', 'exports', 'require', code)(mod, mod.exports, req);
    return mod.exports;
  };

  it('the same built-in views, empty filters and the same view comparison', () => {
    const views = load('lib/savedViews.ts', () => ({ useAuthStore: { getState: () => ({ user: null }) }, userStorageKey: () => 'k' }));
    expect(views.BUILT_IN_VIEWS).toEqual(BUILT_IN_VIEWS);
    expect(views.EMPTY_FILTERS).toEqual(EMPTY_FILTERS);
    expect(views.OPEN_STATUS).toBe(OPEN_STATUS);
  });

  it('the website’s bulk runner gives the same results for the same answers', async () => {
    const theirs = load('lib/bulkActions.ts');
    const answers = () => {
      let n = 0;
      return deps2(() => {
        n += 1;
        if (n === 2) throw new ApiError(400, 'VALIDATION', 'No.');
      });
    };
    const refs2 = [
      { id: '1', projectId: 'a' },
      { id: '2', projectId: 'b' },
      { id: '3', projectId: 'a' },
    ];
    for (const action of [{ type: 'complete' }, { type: 'setDueDate', dueDate: null }, { type: 'assign', userId: 'u1' }, { type: 'move', columnId: 'c9' }] as const) {
      const web = (await (theirs.runBulk as (...a: unknown[]) => Promise<{ succeeded: number; failed: number }>)(refs2, action, answers())) as { succeeded: number; failed: number };
      const ours = await runBulk(refs2, action, answers());
      expect({ succeeded: ours.succeeded, failed: ours.failed }).toEqual(web);
    }
  });

  it('the website’s page: its option words, chips and empty states', () => {
    const page = web('pages/MyTasksPage.tsx');
    for (const o of [...SORT_OPTIONS, ...DUE_OPTIONS]) expect(page).toContain(`label: '${o.label}'`);
    for (const w of ['All projects', 'All statuses', 'Open (not completed)', 'All priorities', 'Anyone']) expect(page).toContain(`'${w}'`);
    for (const w of [MY_TASKS_TEXT.subtitle, MY_TASKS_TEXT.emptyTitle, MY_TASKS_TEXT.emptyText, MY_TASKS_TEXT.noMatchTitle, MY_TASKS_TEXT.noMatchText]) expect(page).toContain(w);
    for (const chip of ['label="All"', 'label="Open"', 'label="Overdue"', 'label="Completed"']) expect(page).toContain(chip);
    const bar = web('components/BulkActionBar.tsx');
    expect(bar).toContain('Clear the due date on {count} task{count === 1 ? \'\' : \'s\'}?');
    for (const w of ['Complete', 'Set date', 'Clear date…', 'Clear dates', 'Keep', 'Priority…', 'Assign to…', 'Move to…']) expect(bar).toContain(w);
  });
});

/** Deps whose every write answers with `answer` (thrown errors fail it); every project has a Done column. */
function deps2(answer: () => void): BulkDeps {
  const run = async () => answer();
  return { update: run, move: run, assign: run, doneColumnFor: async () => 'done' };
}
