import { describe, it, expect } from 'vitest';
import type { ApiTask } from '../api/tasks';
import { canReschedule, needsSeriesChoice, planMove, planUndo, shiftRule } from './calendar-reschedule';

const task = (over: Partial<ApiTask>): ApiTask => ({
  id: 't1', key: 'MICO-1', title: 'Task', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: '2026-10-12T00:00:00.000Z', progress: 0, completedAt: null, createdAt: '', updatedAt: '', version: 4, ...over,
});

describe('who can be moved', () => {
  it('open tasks of active projects; not finished ones, archived projects or projected copies', () => {
    expect(canReschedule({ kind: 'task', status: 'todo', projectArchived: false })).toBe(true);
    expect(canReschedule({ kind: 'task', status: 'overdue', projectArchived: false })).toBe(true);
    expect(canReschedule({ kind: 'task', status: 'done', projectArchived: false })).toBe(false);
    expect(canReschedule({ kind: 'task', status: 'todo', projectArchived: true })).toBe(false);
    expect(canReschedule({ kind: 'projected', status: 'projected', projectArchived: false })).toBe(false);
  });
  it('asks “this occurrence or the series?” only for the newest copy of a repeating task', () => {
    expect(needsSeriesChoice(task({ recurrenceRule: { freq: 'WEEKLY', interval: 1 } }))).toBe(true);
    expect(needsSeriesChoice(task({ recurrenceParentId: 's1' }))).toBe(false); // an earlier copy: just itself
    expect(needsSeriesChoice(task({}))).toBe(false);
  });
});

describe('planMove — what is saved', () => {
  it('a one-off task: its new day (with the version it was read at)', () => {
    expect(planMove(task({}), '2026-10-12', '2026-10-14', 'occurrence')).toEqual({ dueDate: '2026-10-14', expectedVersion: 4 });
  });

  it('this occurrence only: the series remembers the day it replaced, so the next copies stay on schedule', () => {
    const t = task({ recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] }, dueDate: '2026-10-12T00:00:00.000Z' });
    expect(planMove(t, '2026-10-12', '2026-10-14', 'occurrence')).toEqual({ dueDate: '2026-10-14', expectedVersion: 4, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], resumeFrom: '2026-10-12' } });
    // Moved again: it still replaced the original day.
    const moved = task({ recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], resumeFrom: '2026-10-12' }, dueDate: '2026-10-14T00:00:00.000Z' });
    expect(planMove(moved, '2026-10-14', '2026-10-15', 'occurrence').recurrenceRule?.resumeFrom).toBe('2026-10-12');
  });

  it('this and future occurrences: the schedule moves with it', () => {
    const t = task({ recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], resumeFrom: '2026-10-12' } });
    expect(planMove(t, '2026-10-12', '2026-10-14', 'series')).toEqual({ dueDate: '2026-10-14', expectedVersion: 4, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [3] } });
  });

  it('undo puts back the day and the rule exactly as they were', () => {
    const rule = { freq: 'WEEKLY' as const, interval: 1, weekdays: [1] };
    const t = task({ recurrenceRule: rule });
    expect(planUndo(t, '2026-10-12', 7)).toEqual({ dueDate: '2026-10-12', expectedVersion: 7, recurrenceRule: rule });
    expect(planUndo(task({}), '2026-10-12', 5)).toEqual({ dueDate: '2026-10-12', expectedVersion: 5 });
  });
});

describe('shiftRule — moving a schedule to another day', () => {
  it('weekly: the moved weekday becomes the new one', () => {
    expect(shiftRule({ freq: 'WEEKLY', interval: 1, weekdays: [1, 3] }, '2026-10-12', '2026-10-13')).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [2, 3] });
    expect(shiftRule({ freq: 'WEEKLY', interval: 2 }, '2026-10-12', '2026-10-13')).toEqual({ freq: 'WEEKLY', interval: 2 });
  });
  it('monthly: the day of the month, or “the nth weekday”', () => {
    expect(shiftRule({ freq: 'MONTHLY', interval: 1, dayOfMonth: 15 }, '2026-10-15', '2026-10-18')).toEqual({ freq: 'MONTHLY', interval: 1, dayOfMonth: 18 });
    expect(shiftRule({ freq: 'MONTHLY', interval: 1, anchorDay: 15 }, '2026-10-15', '2026-10-18')).toEqual({ freq: 'MONTHLY', interval: 1, anchorDay: 18 });
    // 2nd Tuesday (13 Oct) → Thursday 15 Oct, the 3rd Thursday.
    expect(shiftRule({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } }, '2026-10-13', '2026-10-15')).toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 3, day: 4 } });
    // "The last Friday" moved to a Thursday stays "the last".
    expect(shiftRule({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } }, '2026-10-30', '2026-10-29')).toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 4 } });
  });
  it('yearly: the new day of the month; daily: nothing to change', () => {
    expect(shiftRule({ freq: 'YEARLY', interval: 1, anchorDay: 12 }, '2026-10-12', '2026-10-20')).toEqual({ freq: 'YEARLY', interval: 1, anchorDay: 20 });
    expect(shiftRule({ freq: 'DAILY', interval: 1 }, '2026-10-12', '2026-10-20')).toEqual({ freq: 'DAILY', interval: 1 });
  });
});
