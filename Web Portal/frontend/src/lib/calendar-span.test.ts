import { describe, it, expect } from 'vitest';
import type { ApiTask } from '../api/tasks';
import { MAX_SPAN_DAYS, buildSpanItems, spanOf, weekSegments, packLanes, laneView } from './calendar-span';

const TZ = 'Asia/Muscat';
const task = (extra: Partial<ApiTask>): ApiTask =>
  ({ id: 't', key: 'RIG-1', title: 'Task', projectId: 'p1', columnId: 'c', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', columnCategory: 'TODO', ...extra }) as ApiTask;
const ctx = { today: '2026-11-11', timeZone: TZ, projectStatus: () => 'ACTIVE' };

describe('a task from its start to its due day (owner, 11 Nov) — the same rule as the server’s', () => {
  it('bar, marks only (over three weeks), due-only, start-only', () => {
    expect(MAX_SPAN_DAYS).toBe(21);
    expect(spanOf(task({ startDate: '2026-11-03', dueDate: '2026-11-06' }), TZ)).toEqual({ start: '2026-11-03', due: '2026-11-06', mode: 'bar' });
    expect(spanOf(task({ startDate: '2026-11-01', dueDate: '2026-11-23' }), TZ)!.mode).toBe('markers');
    expect(spanOf(task({ dueDate: '2026-11-06' }), TZ)).toEqual({ start: null, due: '2026-11-06', mode: 'due' });
    expect(spanOf(task({ startDate: '2026-11-06', dueDate: '2026-11-06' }), TZ)!.mode).toBe('due');
    expect(spanOf(task({ startDate: '2026-11-03' }), TZ)).toEqual({ start: '2026-11-03', due: null, mode: 'start' });
    expect(spanOf(task({}), TZ)).toBeNull();
    // R11: the automatic start (the moment the task was made, an instant) draws nothing: due-only.
    expect(spanOf(task({ startDate: '2026-11-02T07:13:41.512Z', dueDate: '2026-11-06' }), TZ)).toEqual({ start: null, due: '2026-11-06', mode: 'due' });
  });

  it('builds each task once (due ones and those shown by their span), with its due time when it has one, and projected repeats', () => {
    const items = buildSpanItems(
      {
        tasks: [task({ id: 'a', startDate: '2026-11-03', dueDate: '2026-11-06' }), task({ id: 'b', dueDate: '2026-11-12T10:30:00.000Z' })],
        spanning: [task({ id: 'c', startDate: '2026-11-10', dueDate: '2026-11-30' }), task({ id: 'a', startDate: '2026-11-03', dueDate: '2026-11-06' })],
        occurrences: [{ taskId: 'b', seriesId: 'b', date: '2026-11-19' }],
        series: [task({ id: 'b', dueDate: '2026-11-12T10:30:00.000Z', recurrenceRule: { freq: 'WEEKLY', interval: 1 } })],
      },
      ctx,
    );
    expect(items.map((i) => [i.key, i.kind, i.start, i.due, i.mode, i.date, i.dueMinutes])).toEqual([
      ['a', 'task', '2026-11-03', '2026-11-06', 'bar', '2026-11-06', null],
      ['b', 'task', null, '2026-11-12', 'due', '2026-11-12', 14 * 60 + 30],
      ['c', 'task', '2026-11-10', '2026-11-30', 'bar', '2026-11-30', null],
      ['proj:b:2026-11-19', 'projected', null, '2026-11-19', 'due', '2026-11-19', null],
    ]);
    // Overdue by its due day (red ⚑), as everywhere.
    expect(items[0]!.status).toBe('overdue');
  });
});

describe('a week of the month: each item as a segment, packed in lanes', () => {
  const week = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
  const items = buildSpanItems(
    {
      tasks: [task({ id: 'due', dueDate: '2026-11-10' })],
      spanning: [
        task({ id: 'across', startDate: '2026-11-05', dueDate: '2026-11-17' }),
        task({ id: 'inside', startDate: '2026-11-09', dueDate: '2026-11-11' }),
        task({ id: 'long', startDate: '2026-11-12', dueDate: '2026-12-30' }),
      ],
      occurrences: [],
      series: [],
    },
    ctx,
  );

  it('a bar is cut to the week, its ▶ / ⚑ only where it really starts / ends; a long task’s marks are one-day segments', () => {
    const segs = weekSegments(week, items);
    const of = (id: string) => segs.filter((s) => s.item.key === id).map((s) => [s.startCol, s.endCol, s.role, s.startsHere, s.endsHere]);
    expect(of('across')).toEqual([[0, 6, 'bar', false, false]]);
    expect(of('inside')).toEqual([[1, 3, 'bar', true, true]]);
    expect(of('due')).toEqual([[2, 2, 'single', false, true]]);
    expect(of('long')).toEqual([[4, 4, 'start', true, false]]);
  });

  it('packs the longest first into the lowest free lane; a one-day item fills a gap', () => {
    const placed = packLanes(weekSegments(week, items).map((s, i) => ({ ...s, order: i })));
    const lane = (id: string) => placed.find((p) => p.item.key === id)!.lane;
    expect(lane('across')).toBe(0);
    expect(lane('inside')).toBe(1);
    expect(lane('due')).toBe(2);
    expect(lane('long')).toBe(1);
  });

  it('with room for fewer lanes: the last lane says “+N more” on each day with more', () => {
    const placed = packLanes(weekSegments(week, items).map((s, i) => ({ ...s, order: i })));
    // Room for 2 rows: lane 0 shown, the second row is "+N more" on each day with more.
    expect(laneView(placed, 2)).toEqual({ lanes: 1, more: [0, 1, 2, 1, 1, 0, 0] });
    // Room for all three: every lane, nothing hidden.
    expect(laneView(placed, 3)).toEqual({ lanes: 3, more: [0, 0, 0, 0, 0, 0, 0] });
    // Unknown height: everything.
    expect(laneView(placed, undefined).lanes).toBe(3);
  });
});
