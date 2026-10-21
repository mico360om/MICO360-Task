import { describe, it, expect } from 'vitest';
import {
  copyCovers,
  fitRange,
  listWithPendingDueDates,
  meetingsInRange,
  movedInCached,
  movedInList,
  rangeView,
  slimRange,
  withMovedTask,
  withPendingDueDates,
  type CalendarRange,
} from './calendar-data';
import type { CalendarTask } from './calendar-model';
import type { ApiMeeting } from './types';
import type { QueuedMutation } from './sync-queue';

const task = (over: Partial<CalendarTask>): CalendarTask => ({
  id: 't', key: 'MICO-1', title: 'Task', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: '2026-10-12T00:00:00.000Z', estimatedHours: null, progress: 0, completedAt: null, ...over,
});

const range = (over: Partial<CalendarRange> = {}): CalendarRange => ({
  from: '2026-09-27',
  to: '2026-10-31',
  timeZone: 'Asia/Muscat',
  tasks: [
    task({ id: 'a', dueDate: '2026-09-28T00:00:00.000Z' }),
    task({ id: 'b', dueDate: '2026-10-12T00:00:00.000Z' }),
    task({ id: 'c', dueDate: '2026-10-30T21:00:00.000Z' }), // 01:00 on the 31st in Muscat
  ],
  occurrences: [
    { taskId: 'h', seriesId: 'h', date: '2026-09-30' },
    { taskId: 'h', seriesId: 'h', date: '2026-10-28' },
    { taskId: 'k', seriesId: 'k', date: '2026-10-01' },
  ],
  series: [task({ id: 'h', recurrenceRule: { freq: 'WEEKLY', interval: 4 } }), task({ id: 'k', recurrenceRule: { freq: 'MONTHLY', interval: 1 } })],
  ...over,
});

describe('the offline copy of the last range seen', () => {
  it('answers its own range as it is', () => {
    const saved = range();
    expect(copyCovers(saved, '2026-09-27', '2026-10-31')).toBe(true);
    expect(fitRange(saved, '2026-09-27', '2026-10-31')).toBe(saved);
  });

  it('answers another range with the days they share, and says it doesn’t cover it', () => {
    const saved = range();
    expect(copyCovers(saved, '2026-10-25', '2026-10-31')).toBe(true);
    expect(copyCovers(saved, '2026-10-25', '2026-11-07')).toBe(false);
    const week = fitRange(saved, '2026-10-25', '2026-11-07');
    expect(week.from).toBe('2026-10-25');
    expect(week.to).toBe('2026-11-07');
    expect(week.tasks.map((t) => t.id)).toEqual(['c']);
    expect(week.occurrences.map((o) => o.date)).toEqual(['2026-10-28']);
    expect(week.series.map((s) => s.id)).toEqual(['h']);
    expect(fitRange(saved, '2026-12-01', '2026-12-31').tasks).toEqual([]);
  });

  it('keeps a meetings copy to the instants asked for', () => {
    const m = (id: string, startAt: string) => ({ id, startAt }) as ApiMeeting;
    const list = [m('a', '2026-09-30T19:59:00.000Z'), m('b', '2026-09-30T20:00:00.000Z'), m('c', '2026-10-31T19:59:59.000Z'), m('d', '2026-10-31T20:00:00.000Z')];
    expect(meetingsInRange(list, '2026-09-30T20:00:00.000Z', '2026-10-31T20:00:00.000Z').map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('leaves out long-finished tasks when the copy is too long to keep whole', () => {
    const now = Date.parse('2026-10-21T00:00:00.000Z');
    const saved = range({ tasks: [task({ id: 'old', completedAt: '2026-08-01T00:00:00.000Z' }), task({ id: 'recent', completedAt: '2026-10-15T00:00:00.000Z' }), task({ id: 'open' })] });
    expect(slimRange(now)(saved).tasks.map((t) => t.id)).toEqual(['recent', 'open']);
  });
});

describe('a task moved on the calendar', () => {
  it('shows on its new day at once, with its new repeat, in the range and as a series head', () => {
    const saved = range();
    const moved = withMovedTask(saved, 'b', { dueDate: '2026-10-14' });
    expect(moved.tasks.find((t) => t.id === 'b')!.dueDate).toBe('2026-10-14T00:00:00.000Z');
    expect(saved.tasks.find((t) => t.id === 'b')!.dueDate).toBe('2026-10-12T00:00:00.000Z');
    const rule = { freq: 'WEEKLY' as const, interval: 4, resumeFrom: '2026-10-12' };
    const head = withMovedTask(saved, 'h', { dueDate: '2026-10-14', recurrenceRule: rule });
    expect(head.series.find((t) => t.id === 'h')).toMatchObject({ dueDate: '2026-10-14T00:00:00.000Z', recurrenceRule: rule });
    expect(withMovedTask(saved, 'nope', { dueDate: '2026-10-14' })).toBe(saved);
  });

  it('stays on its new day while its move waits on this phone (a refresh brings the old day back otherwise)', () => {
    const saved = range();
    const pending = [
      { kind: 'task.update', payload: { id: 'b', patch: { dueDate: '2026-10-20', expectedVersion: 3 } } },
      { kind: 'task.update', payload: { id: 'a', patch: { title: 'Renamed' } } },
      { kind: 'task.move', payload: { id: 'c', columnId: 'x' } },
      { kind: 'task.update', payload: { id: 'b', patch: { dueDate: '2026-10-21' } } },
    ] as Pick<QueuedMutation, 'kind' | 'payload'>[];
    const shown = withPendingDueDates(saved, pending);
    expect(shown.tasks.map((t) => t.dueDate)).toEqual(['2026-09-28T00:00:00.000Z', '2026-10-21T00:00:00.000Z', '2026-10-30T21:00:00.000Z']);
    expect(withPendingDueDates(saved, [])).toBe(saved);
    expect(withPendingDueDates(saved, [pending[1]!, pending[2]!])).toBe(saved);
  });
});

describe('what the calendar shows for a range', () => {
  const pending = [{ kind: 'task.update', payload: { id: 'b', patch: { dueDate: '2026-10-20' } } }] as Pick<QueuedMutation, 'kind' | 'payload'>[];

  it('the server’s answer, with the moves still waiting on this phone', () => {
    const view = rangeView(range(), '2026-09-27', '2026-10-31', { fromCopy: false, pending });
    expect(view.savedCopy).toBeNull();
    expect(view.tasks.find((t) => t.id === 'b')!.dueDate).toBe('2026-10-20T00:00:00.000Z');
  });

  it('offline: the copy kept on this phone, fitted to the range asked, saying which days it holds', () => {
    const view = rangeView(range(), '2026-10-25', '2026-11-07', { fromCopy: true, pending: [] });
    expect(view.savedCopy).toEqual({ from: '2026-09-27', to: '2026-10-31', covers: false });
    expect(view.tasks.map((t) => t.id)).toEqual(['c']);
    expect(rangeView(range(), '2026-09-27', '2026-10-31', { fromCopy: true, pending: [] }).savedCopy).toEqual({ from: '2026-09-27', to: '2026-10-31', covers: true });
  });

  it('a list of tasks (the overdue ones) gets the waiting moves too, and a move shows in it at once', () => {
    const list = [task({ id: 'b', dueDate: '2026-10-01T00:00:00.000Z' })];
    expect(listWithPendingDueDates(list, pending)[0]!.dueDate).toBe('2026-10-20T00:00:00.000Z');
    expect(listWithPendingDueDates(list, [])).toBe(list);
    expect(movedInList(list, 'b', { dueDate: '2026-10-22' })[0]!.dueDate).toBe('2026-10-22T00:00:00.000Z');
    expect(movedInList(list, 'x', { dueDate: '2026-10-22' })).toBe(list);
  });
});

describe('a move shown at once in every calendar answer that is cached', () => {
  it('a range, the overdue list, and anything else left alone', () => {
    const saved = range();
    expect(movedInCached(saved, 'b', { dueDate: '2026-10-14' })).toEqual(withMovedTask(saved, 'b', { dueDate: '2026-10-14' }));
    const list = [task({ id: 'b' })];
    expect((movedInCached(list, 'b', { dueDate: '2026-10-14' }) as CalendarTask[])[0]!.dueDate).toBe('2026-10-14T00:00:00.000Z');
    expect(movedInCached(undefined, 'b', { dueDate: '2026-10-14' })).toBeUndefined();
    const other = { hello: 'world' };
    expect(movedInCached(other, 'b', { dueDate: '2026-10-14' })).toBe(other);
  });
});

describe('putting a task back as it was', () => {
  it('takes a whole instant as it is (a due date with a time), a day as that day', () => {
    const list = [task({ id: 'b', dueDate: '2026-10-20T00:00:00.000Z' })];
    expect(movedInList(list, 'b', { dueDate: '2026-10-12T09:30:00.000Z' })[0]!.dueDate).toBe('2026-10-12T09:30:00.000Z');
    expect(movedInList(list, 'b', { dueDate: null })[0]!.dueDate).toBeNull();
  });
});
