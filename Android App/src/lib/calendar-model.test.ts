import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  buildItems,
  countLabel,
  dayCellLabel,
  groupByDay,
  itemMeta,
  itemName,
  statusOf,
  type CalendarFilters,
  type CalendarTask,
} from './calendar-model';

const task = (over: Partial<CalendarTask>): CalendarTask => ({
  id: 't', key: 'MICO-1', title: 'Task', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: '2026-10-12T00:00:00.000Z', estimatedHours: null, progress: 0, completedAt: null,
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

  it('adds projected copies of other people’s repeating tasks too (not for archived or completed projects)', () => {
    const head = task({ id: 'h', title: 'Weekly check', recurrenceRule: { freq: 'WEEKLY', interval: 1 }, assignees: [{ id: 'u2', name: 'Omar' }] });
    const archived = task({ id: 'x', projectId: 'old', recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const done = task({ id: 'y', projectId: 'shipped', recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const items = buildItems(
      { tasks: [head], occurrences: [{ taskId: 'h', seriesId: 'h', date: '2026-10-19' }, { taskId: 'x', seriesId: 'x', date: '2026-10-19' }, { taskId: 'y', seriesId: 'y', date: '2026-10-19' }, { taskId: 'gone', seriesId: 'gone', date: '2026-10-19' }], series: [head, archived, done] },
      ctx,
    );
    const projected = items.filter((i) => i.kind === 'projected');
    expect(projected.map((i) => [i.key, i.date, i.status, i.task.id])).toEqual([['proj:h:2026-10-19', '2026-10-19', 'projected', 'h']]);
    expect(items.find((i) => i.kind === 'task')!.recurring).toBe(true);
  });

  it('marks tasks of archived projects and leaves out tasks without a due day', () => {
    const items = buildItems({ tasks: [task({ id: 'a', projectId: 'old' }), task({ id: 'b', dueDate: null })], occurrences: [], series: [] }, ctx);
    expect(items.map((i) => [i.key, i.projectArchived])).toEqual([['a', true]]);
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

  it('by default shows everyone’s tasks, completed and projected ones, but not archived projects’', () => {
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
    expect(ids({ statuses: ['todo'] })).toContain('proj:1:2026-10-19');
    expect(ids({ priorities: ['HIGH'] })).toEqual(['1', 'proj:1:2026-10-19']);
  });
  it('counts the filters in use', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, projectId: 'p1', mine: true, showCompleted: false })).toBe(3);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, q: '   ' })).toBe(0);
  });
});

describe('groupByDay — the most urgent first', () => {
  it('orders a day: overdue, blocked, in progress, to do, projected, done; then by priority', () => {
    const items = buildItems(
      {
        tasks: [
          task({ id: 'done', columnCategory: 'DONE' }),
          task({ id: 'low', priority: 'LOW' }),
          task({ id: 'urgent', priority: 'URGENT' }),
          task({ id: 'blocked', columnCategory: 'BLOCKED' }),
          task({ id: 'doing', columnCategory: 'IN_PROGRESS' }),
        ],
        occurrences: [{ taskId: 'low', seriesId: 'low', date: '2026-10-12' }],
        series: [task({ id: 'low', priority: 'LOW' })],
      },
      ctx,
    );
    expect(groupByDay(items).get('2026-10-12')!.map((i) => i.key)).toEqual(['blocked', 'doing', 'urgent', 'low', 'proj:low:2026-10-12', 'done']);
  });
});

describe('what TalkBack reads (the website’s words)', () => {
  const [real] = buildItems({ tasks: [task({ id: 'a', title: 'Pour the slab', priority: 'URGENT', recurrenceRule: { freq: 'WEEKLY', interval: 1 }, assignees: [{ id: 'u1', name: 'Mariam' }, { id: 'u2', name: 'Omar' }] })], occurrences: [], series: [] }, ctx);
  const [copy] = buildItems({ tasks: [], occurrences: [{ taskId: 'a', seriesId: 'a', date: '2026-10-19' }], series: [real!.task] }, ctx);

  it('names a task, a projected copy and how urgent it is', () => {
    expect(itemName(real!)).toBe('Pour the slab, to do, repeats, urgent priority');
    expect(itemName(copy!)).toBe('Pour the slab, repeat, not created yet, Mon 19 Oct, urgent priority');
    const [late] = buildItems({ tasks: [task({ title: 'Late', dueDate: '2026-10-01T00:00:00.000Z' })], occurrences: [], series: [] }, ctx);
    expect(itemName(late!)).toBe('Late, overdue');
  });

  it('gives the line under the title: key (or “Not created yet”), project, people', () => {
    expect(itemMeta(real!, 'Tower A')).toBe('MICO-1 · Tower A · Mariam, Omar');
    expect(itemMeta(copy!, undefined)).toBe('Not created yet · Mariam, Omar');
  });

  it('names a day of the grid with what is on it', () => {
    expect(countLabel(0, 0)).toBe('');
    expect(countLabel(1, 0)).toBe(', 1 task');
    expect(countLabel(3, 2)).toBe(', 2 meetings, 3 tasks');
    expect(dayCellLabel('2026-10-10', { tasks: 2, meetings: 1, today: true })).toBe('Sat 10 Oct, today, 1 meeting, 2 tasks');
    expect(dayCellLabel('2026-10-11', { tasks: 0, meetings: 0, today: false })).toBe('Sun 11 Oct, nothing due');
  });
});

/**
 * The website's calendar model (Web Portal/frontend/src/lib/calendar-model.ts) and this one must
 * show, filter and order the same items. Skipped when the website's code isn't next to the app.
 */
const webModel = resolve(__dirname, '../../../Web Portal/frontend/src/lib/calendar-model.ts');
describe.skipIf(!existsSync(webModel))('the same as the website', () => {
  type Fn = (...args: unknown[]) => unknown;
  const load = async () => (await import(/* @vite-ignore */ webModel)) as Record<string, Fn>;
  const data = {
    tasks: [
      task({ id: '1', key: 'MICO-1', title: 'Budget review', priority: 'HIGH', assignees: [{ id: 'me', name: 'Me' }], recurrenceRule: { freq: 'WEEKLY', interval: 1 } }),
      task({ id: '2', key: 'RIG-7', title: 'مراجعة', projectId: 'p2', priority: 'LOW', assignees: [{ id: 'u2', name: 'Omar' }], dueDate: '2026-10-04T21:30:00.000Z' }),
      task({ id: '3', title: 'Shipped', columnCategory: 'DONE', completedAt: '2026-10-03T08:00:00.000Z' }),
      task({ id: '4', title: 'Old', projectId: 'old', columnCategory: 'BLOCKED' }),
      task({ id: '5', title: 'Late', dueDate: '2026-10-01T00:00:00.000Z', columnCategory: 'REVIEW', recurrenceParentId: 'x' }),
      task({ id: '6', title: 'Doing', columnCategory: 'IN_PROGRESS', priority: 'URGENT' }),
    ],
    occurrences: [{ taskId: '1', seriesId: '1', date: '2026-10-19' }, { taskId: '9', seriesId: '9', date: '2026-10-19' }, { taskId: '8', seriesId: '8', date: '2026-10-12' }],
    series: [task({ id: '1', key: 'MICO-1', title: 'Budget review', priority: 'HIGH' }), task({ id: '9', projectId: 'shipped' }), task({ id: '8', projectId: 'p2', priority: 'URGENT' })],
  };
  const filters: Partial<CalendarFilters>[] = [
    {}, { projectId: 'p2' }, { assigneeId: 'u2' }, { mine: true }, { q: 'mico' }, { q: 'مراجعة' }, { statuses: ['overdue', 'done'] }, { statuses: ['todo'] },
    { priorities: ['URGENT', 'LOW'] }, { showCompleted: false }, { showArchived: true }, { showProjected: false }, { showMeetings: false },
  ];
  const view = (items: unknown[]) => (items as { key: string; kind: string; date: string; status: string; projectArchived: boolean; recurring: boolean }[]).map((i) => [i.key, i.kind, i.date, i.status, i.projectArchived, i.recurring]);

  it('builds, filters, counts and orders alike', async () => {
    const web = await load();
    for (const today of ['2026-10-01', '2026-10-10', '2026-10-30']) {
      const c = { ...ctx, today };
      const mine = buildItems(data, c);
      const theirs = web.buildItems!(data, c) as unknown[];
      expect(view(mine)).toEqual(view(theirs));
      for (const f of filters) {
        const all = { ...DEFAULT_FILTERS, ...f };
        expect(view(applyFilters(mine, all, { myId: 'me' })), JSON.stringify(f)).toEqual(view(web.applyFilters!(theirs, all, { myId: 'me' }) as unknown[]));
        expect(activeFilterCount(all)).toBe(web.activeFilterCount!(all));
      }
      const order = (m: Map<string, unknown[]>) => [...m.entries()].map(([d, list]) => [d, view(list)]);
      expect(order(groupByDay(mine))).toEqual(order(web.groupByDay!(theirs) as Map<string, unknown[]>));
    }
    expect(DEFAULT_FILTERS).toEqual(web.DEFAULT_FILTERS as unknown as CalendarFilters);
  });
});
