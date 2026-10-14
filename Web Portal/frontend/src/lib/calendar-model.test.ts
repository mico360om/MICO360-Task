import { describe, it, expect } from 'vitest';
import type { ApiTask } from '../api/tasks';
import {
  DEFAULT_FILTERS,
  applyFilters,
  buildItems,
  filtersFromParams,
  filtersToParams,
  groupByDay,
  activeFilterCount,
  statusOf,
  type CalendarFilters,
} from './calendar-model';

const task = (over: Partial<ApiTask>): ApiTask => ({
  id: 't', key: 'MICO-1', title: 'Task', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: '2026-10-12T00:00:00.000Z', progress: 0, completedAt: null, createdAt: '', updatedAt: '',
  assignees: [], ...over,
});

const ctx = { today: '2026-10-10', timeZone: 'Asia/Muscat', projectStatus: (id: string) => (id === 'old' ? 'ARCHIVED' : id === 'shipped' ? 'COMPLETED' : 'ACTIVE') };

describe('statusOf — one status per task, red only for overdue', () => {
  it('finished tasks are done, never overdue', () => {
    expect(statusOf(task({ columnCategory: 'DONE' }), '2026-10-01', '2026-10-10')).toBe('done');
    expect(statusOf(task({ completedAt: '2026-10-02T10:00:00Z', columnCategory: 'IN_PROGRESS' }), '2026-10-01', '2026-10-10')).toBe('done');
  });
  it('open tasks past their day are overdue; otherwise blocked, in progress or to do', () => {
    expect(statusOf(task({ columnCategory: 'BLOCKED' }), '2026-10-09', '2026-10-10')).toBe('overdue');
    expect(statusOf(task({ columnCategory: 'BLOCKED' }), '2026-10-10', '2026-10-10')).toBe('blocked');
    expect(statusOf(task({ columnCategory: 'IN_PROGRESS' }), '2026-10-12', '2026-10-10')).toBe('in-progress');
    expect(statusOf(task({ columnCategory: 'REVIEW' }), '2026-10-12', '2026-10-10')).toBe('in-progress');
    expect(statusOf(task({ columnCategory: 'BACKLOG' }), '2026-10-12', '2026-10-10')).toBe('todo');
  });
});

describe('buildItems — real tasks and projected copies on their calendar days', () => {
  it('keeps a date-only due date on its day and reads a timed one in the calendar’s time zone', () => {
    const items = buildItems({ tasks: [task({ id: 'a', dueDate: '2026-10-05T00:00:00.000Z' }), task({ id: 'b', dueDate: '2026-10-04T21:30:00.000Z' })], occurrences: [], series: [] }, ctx);
    expect(items.map((i) => [i.task.id, i.date])).toEqual([['a', '2026-10-05'], ['b', '2026-10-05']]); // 01:30 on the 5th in Muscat
  });

  it('adds projected copies from their series (not for archived or completed projects)', () => {
    const head = task({ id: 'h', title: 'Weekly check', recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const archived = task({ id: 'x', projectId: 'old', recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const items = buildItems({ tasks: [head], occurrences: [{ taskId: 'h', seriesId: 'h', date: '2026-10-19' }, { taskId: 'x', seriesId: 'x', date: '2026-10-19' }], series: [head, archived] }, ctx);
    const projected = items.filter((i) => i.kind === 'projected');
    expect(projected.map((i) => [i.key, i.date, i.status])).toEqual([['proj:h:2026-10-19', '2026-10-19', 'projected']]);
    expect(items.find((i) => i.kind === 'task')!.recurring).toBe(true);
  });
});

describe('applyFilters', () => {
  const items = buildItems(
    {
      tasks: [
        task({ id: '1', key: 'MICO-1', title: 'Budget review', projectId: 'p1', priority: 'HIGH', assignees: [{ id: 'me', name: 'Me' }] }),
        task({ id: '2', key: 'RIG-7', title: 'مراجعة الميزانية', projectId: 'p2', priority: 'LOW', assignees: [{ id: 'u2', name: 'Omar' }] }),
        task({ id: '3', title: 'Shipped', columnCategory: 'DONE', projectId: 'p1' }),
        task({ id: '4', title: 'Old project work', projectId: 'old' }),
        task({ id: '5', title: 'Late', dueDate: '2026-10-01T00:00:00.000Z' }),
      ],
      occurrences: [{ taskId: '1', seriesId: '1', date: '2026-10-19' }],
      series: [task({ id: '1', key: 'MICO-1', title: 'Budget review', projectId: 'p1', priority: 'HIGH', assignees: [{ id: 'me', name: 'Me' }] })],
    },
    ctx,
  );
  const ids = (f: Partial<CalendarFilters>) => applyFilters(items, { ...DEFAULT_FILTERS, ...f }, { myId: 'me' }).map((i) => i.key);

  it('by default hides archived projects’ tasks and shows completed and projected ones', () => {
    expect(ids({})).toEqual(['1', '2', '3', '5', 'proj:1:2026-10-19']);
    expect(ids({ showArchived: true })).toContain('4');
    expect(ids({ showCompleted: false })).not.toContain('3');
    expect(ids({ showProjected: false })).not.toContain('proj:1:2026-10-19');
  });
  it('by project, person, “my tasks”, words (any script, title or key), status and priority', () => {
    expect(ids({ projectId: 'p2' })).toEqual(['2']);
    expect(ids({ assigneeId: 'u2' })).toEqual(['2']);
    expect(ids({ mine: true })).toEqual(['1', 'proj:1:2026-10-19']);
    expect(ids({ q: 'الميزانية' })).toEqual(['2']);
    expect(ids({ q: 'rig-7' })).toEqual(['2']);
    expect(ids({ statuses: ['overdue'] })).toEqual(['5']);
    expect(ids({ priorities: ['HIGH'] })).toEqual(['1', 'proj:1:2026-10-19']);
  });
  it('counts the filters in use', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, projectId: 'p1', mine: true, showCompleted: false })).toBe(3);
  });
});

describe('groupByDay — the most urgent first', () => {
  it('orders a day: overdue, blocked, in progress, to do, projected, done; then by priority', () => {
    const items = buildItems(
      {
        tasks: [
          task({ id: 'done', columnCategory: 'DONE', dueDate: '2026-10-12T00:00:00.000Z' }),
          task({ id: 'low', priority: 'LOW', dueDate: '2026-10-12T00:00:00.000Z' }),
          task({ id: 'urgent', priority: 'URGENT', dueDate: '2026-10-12T00:00:00.000Z' }),
          task({ id: 'blocked', columnCategory: 'BLOCKED', dueDate: '2026-10-12T00:00:00.000Z' }),
          task({ id: 'doing', columnCategory: 'IN_PROGRESS', dueDate: '2026-10-12T00:00:00.000Z' }),
        ],
        occurrences: [{ taskId: 'low', seriesId: 'low', date: '2026-10-12' }],
        series: [task({ id: 'low', priority: 'LOW' })],
      },
      ctx,
    );
    expect(groupByDay(items).get('2026-10-12')!.map((i) => i.key)).toEqual(['blocked', 'doing', 'urgent', 'low', 'proj:low:2026-10-12', 'done']);
  });
});

describe('filters in the address', () => {
  it('round-trips what differs from the defaults, and reads garbage as the defaults', () => {
    const f: CalendarFilters = { ...DEFAULT_FILTERS, projectId: 'p1', assigneeId: 'u2', mine: true, q: 'budget', statuses: ['overdue', 'blocked'], priorities: ['HIGH'], showCompleted: false, showArchived: true, showProjected: false };
    const params = filtersToParams(f);
    expect(Object.fromEntries(params)).toEqual({ project: 'p1', assignee: 'u2', mine: '1', q: 'budget', status: 'overdue,blocked', priority: 'HIGH', done: '0', archived: '1', repeats: '0' });
    expect(filtersFromParams(params)).toEqual(f);
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe('');
    expect(filtersFromParams(new URLSearchParams('status=nope&priority=MEGA'))).toEqual(DEFAULT_FILTERS);
  });
});
