import { describe, expect, it, vi } from 'vitest';
import type { ApiTask } from '../api/tasks';
import { EMPTY_TABLE_FILTERS, ME, NO_PERSON } from './data-table';
import { filterTaskRows, myTasksSort, myTasksSortLabel, myTasksSortValue, taskRowEditable, taskSortValue, type TaskTableContext } from './task-table';

const base: ApiTask = {
  id: 't1',
  key: 'MICO-9',
  title: 'Pour slab B',
  description: null,
  projectId: 'p1',
  columnId: 'c-todo',
  columnCategory: 'TODO',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  progress: 0,
  completedAt: null,
  createdAt: '',
  updatedAt: '',
  assignees: [],
};
const t = (patch: Partial<ApiTask>): ApiTask => ({ ...base, ...patch });

const tasks = [
  t({ id: 'a', key: 'MICO-9', title: 'Pour slab B', priority: 'HIGH', dueDate: '2026-11-03T00:00:00.000Z', assignees: [{ id: 'u1', name: 'Ada' }] }),
  t({ id: 'b', key: 'MICO-10', title: 'Order rebar', priority: 'URGENT', dueDate: '2026-11-05T00:00:00.000Z', columnId: 'c-ip', columnCategory: 'IN_PROGRESS', assignees: [{ id: 'u2', name: 'Omar' }] }),
  t({ id: 'c', key: 'OPS-2', title: 'Site walk', priority: 'LOW', dueDate: null, columnId: 'c-done', columnCategory: 'DONE', formerKeys: ['MICO-4'] }),
  t({ id: 'd', key: 'MICO-11', title: 'Check pumps', dueDate: '2026-11-01T00:00:00.000Z', approvalRequestedAt: '2026-11-02T00:00:00.000Z' }),
];
const ctx: TaskTableContext = {
  timeZone: 'UTC',
  today: '2026-11-05',
  weekStart: '2026-11-01',
  weekEnd: '2026-11-07',
  myId: 'u1',
  statusOf: (task) => ({ value: task.columnId, label: task.columnCategory ?? '', rank: ['c-todo', 'c-ip', 'c-done'].indexOf(task.columnId) }),
  projectName: (task) => (task.projectId === 'p1' ? 'Platform' : 'Ops'),
};
const ids = (rows: ApiTask[]) => rows.map((r) => r.id);

describe('filterTaskRows', () => {
  it('keeps every row with no filters', () => {
    expect(ids(filterTaskRows(tasks, EMPTY_TABLE_FILTERS, ctx))).toEqual(['a', 'b', 'c', 'd']);
  });
  it('finds words in the title, and a task number however it is typed (old numbers too)', () => {
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, text: 'REBAR' }, ctx))).toEqual(['b']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, text: 'mico 10' }, ctx))).toEqual(['b']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, text: '#9' }, ctx))).toEqual(['a']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, text: 'MICO4' }, ctx))).toEqual(['c']);
  });
  it('by status, person (Me, Unassigned), priority and due', () => {
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, status: 'c-ip' }, ctx))).toEqual(['b']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, person: ME }, ctx))).toEqual(['a']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, person: NO_PERSON }, ctx))).toEqual(['c', 'd']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, person: 'u2' }, ctx))).toEqual(['b']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, priority: 'LOW' }, ctx))).toEqual(['c']);
    // Overdue: late work only — not the one waiting for approval, nor the finished one.
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, due: 'overdue' }, ctx))).toEqual(['a']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, due: 'today' }, ctx))).toEqual(['b']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, due: 'week' }, ctx))).toEqual(['a', 'b', 'd']);
    expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, due: 'none' }, ctx))).toEqual(['c']);
  });
  it('decides "overdue" by the table’s own today, never the computer’s clock (1.23.3)', () => {
    vi.useFakeTimers();
    try {
      // Long after every due day: only what is late on the table's today counts.
      vi.setSystemTime(new Date('2027-03-01T12:00:00Z'));
      expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, due: 'overdue' }, ctx))).toEqual(['a']);
      // Long before them: still the same.
      vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
      expect(ids(filterTaskRows(tasks, { ...EMPTY_TABLE_FILTERS, due: 'overdue' }, ctx))).toEqual(['a']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('taskSortValue', () => {
  it('orders by number, title, project, first person, priority rank, due day, status place and progress', () => {
    expect(taskSortValue(tasks[1]!, 'key', ctx)).toBe('MICO-10');
    expect(taskSortValue(tasks[0]!, 'title', ctx)).toBe('Pour slab B');
    expect(taskSortValue(tasks[0]!, 'project', ctx)).toBe('Platform');
    expect(taskSortValue(tasks[1]!, 'assignee', ctx)).toBe('Omar');
    expect(taskSortValue(tasks[2]!, 'assignee', ctx)).toBe('');
    expect(taskSortValue(tasks[1]!, 'priority', ctx)).toBe(0);
    expect(taskSortValue(tasks[2]!, 'priority', ctx)).toBe(3);
    expect(taskSortValue(tasks[0]!, 'due', ctx)).toBe('2026-11-03');
    expect(taskSortValue(tasks[2]!, 'due', ctx)).toBeNull();
    expect(taskSortValue(tasks[1]!, 'status', ctx)).toBe(1);
  });
});

describe('My Tasks: the page’s Sort menu and the table’s headers are one sort', () => {
  it('reads today’s values as before', () => {
    expect(myTasksSort('due')).toEqual({ column: 'due', dir: 'asc' });
    expect(myTasksSort('priority')).toEqual({ column: 'priority', dir: 'asc' });
    // Progress has always meant "most done first".
    expect(myTasksSort('progress')).toEqual({ column: 'progress', dir: 'desc' });
    expect(myTasksSort('title')).toEqual({ column: 'title', dir: 'asc' });
  });
  it('reads a header’s other way round and the table-only columns', () => {
    expect(myTasksSort('due:desc')).toEqual({ column: 'due', dir: 'desc' });
    expect(myTasksSort('progress:asc')).toEqual({ column: 'progress', dir: 'asc' });
    expect(myTasksSort('status')).toEqual({ column: 'status', dir: 'asc' });
    expect(myTasksSort('nonsense')).toEqual({ column: 'due', dir: 'asc' });
  });
  it('writes a header click back as a Sort value (no sort: the page’s usual order, Due date)', () => {
    expect(myTasksSortValue({ column: 'title', dir: 'asc' })).toBe('title');
    expect(myTasksSortValue({ column: 'title', dir: 'desc' })).toBe('title:desc');
    expect(myTasksSortValue({ column: 'progress', dir: 'desc' })).toBe('progress');
    expect(myTasksSortValue({ column: 'progress', dir: 'asc' })).toBe('progress:asc');
    expect(myTasksSortValue(null)).toBe('due');
  });
});

describe('taskRowEditable', () => {
  const open = { status: 'ACTIVE' };
  it('lets anyone on an open project change its tasks (today’s rule)', () => {
    expect(taskRowEditable(open, null)).toBe(true);
  });
  it('keeps archived and completed projects read-only, and a project the page doesn’t know', () => {
    expect(taskRowEditable({ status: 'ARCHIVED' }, null)).toBe(false);
    expect(taskRowEditable({ status: 'ACTIVE', archived: true }, null)).toBe(false);
    expect(taskRowEditable({ status: 'COMPLETED' }, null)).toBe(false);
    expect(taskRowEditable(undefined, null)).toBe(false);
    // The whole table read-only (an archived project's Board tab).
    expect(taskRowEditable(open, 'archived')).toBe(false);
  });
});

describe('myTasksSortLabel: a header sort shown in the Sort menu', () => {
  it('words for each column and way round', () => {
    expect(myTasksSortLabel('title')).toBe('Title (A–Z)');
    expect(myTasksSortLabel('title:desc')).toBe('Title (Z–A)');
    expect(myTasksSortLabel('due:desc')).toBe('Due date (latest first)');
    expect(myTasksSortLabel('priority:desc')).toBe('Priority (lowest first)');
    expect(myTasksSortLabel('progress:asc')).toBe('Progress (least first)');
    expect(myTasksSortLabel('status')).toBe('Status');
    expect(myTasksSortLabel('status:desc')).toBe('Status (reversed)');
    expect(myTasksSortLabel('key')).toBe('Number');
    expect(myTasksSortLabel('key:desc')).toBe('Number (highest first)');
    expect(myTasksSortLabel('project')).toBe('Project (A–Z)');
    expect(myTasksSortLabel('assignee:desc')).toBe('Assignee (Z–A)');
    expect(myTasksSortLabel('start')).toBe('Start date');
  });
});

describe('1.24 the Guests and Categories columns', () => {
  const t = (patch: Partial<ApiTask>) => ({ ...tasks[0]!, ...patch }) as ApiTask;
  it('sort by the first guest (name (company); an older server’s first contact) and the first category', () => {
    expect(taskSortValue(t({ guests: [{ id: 'g', name: 'Sara', company: 'NWT' }, { id: 'h', name: 'Ali', company: null }] }), 'guests', ctx)).toBe('Sara (NWT)');
    expect(taskSortValue(t({ guests: [], externalSummary: { count: 1, name: 'Salim', company: null, names: ['Salim'], companies: [] } }), 'guests', ctx)).toBe('Salim');
    expect(taskSortValue(t({ guests: [] }), 'guests', ctx)).toBe('');
    expect(taskSortValue(t({ categories: [{ id: 'k', name: 'HSE', color: 'pink', retired: false }] }), 'categories', ctx)).toBe('HSE');
    expect(taskSortValue(t({}), 'categories', ctx)).toBe('');
  });
  it('My Tasks: a header sort on them is kept and named in the Sort menu', () => {
    expect(myTasksSort('guests')).toEqual({ column: 'guests', dir: 'asc' });
    expect(myTasksSort('categories:desc')).toEqual({ column: 'categories', dir: 'desc' });
    expect(myTasksSortLabel('guests')).toBe('Guests (A–Z)');
    expect(myTasksSortLabel('categories:desc')).toBe('Categories (Z–A)');
  });
});
