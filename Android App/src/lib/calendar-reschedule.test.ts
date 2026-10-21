import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  canReschedule,
  moveBlockReason,
  moveFailedText,
  movedText,
  needsSeriesChoice,
  planMove,
  planUndo,
  projectedNote,
  queuedMoveText,
  quickDays,
  shiftRule,
  splitVersion,
  undoneText,
} from './calendar-reschedule';
import { ApiError, NetworkError } from './api-client';
import type { CalendarTask, CalItem } from './calendar-model';
import type { RecurrenceRule } from './recurrence';

const task = (over: Partial<CalendarTask>): CalendarTask => ({
  id: 't1', key: 'MICO-1', title: 'Task', description: null, projectId: 'p1', columnId: 'c1', columnCategory: 'TODO', position: 0,
  priority: 'NORMAL', startDate: null, dueDate: '2026-10-12T00:00:00.000Z', estimatedHours: null, progress: 0, completedAt: null, version: 4, ...over,
});
const item = (over: Partial<CalItem>): CalItem => ({ key: 't1', kind: 'task', task: task({}), date: '2026-10-12', status: 'todo', projectArchived: false, recurring: false, ...over });

describe('who can be moved', () => {
  it('open tasks of active projects; not finished ones, archived projects or projected copies', () => {
    expect(canReschedule({ kind: 'task', status: 'todo', projectArchived: false })).toBe(true);
    expect(canReschedule({ kind: 'task', status: 'overdue', projectArchived: false })).toBe(true);
    expect(canReschedule({ kind: 'task', status: 'done', projectArchived: false })).toBe(false);
    expect(canReschedule({ kind: 'task', status: 'todo', projectArchived: true })).toBe(false);
    expect(canReschedule({ kind: 'projected', status: 'projected', projectArchived: false })).toBe(false);
  });

  it('says why one can’t be moved', () => {
    expect(moveBlockReason(item({}))).toBeNull();
    expect(moveBlockReason(item({ kind: 'projected', status: 'projected' }))).toBe('This copy isn’t a task yet, so it can’t be moved. Open the current copy to change the series.');
    expect(moveBlockReason(item({ status: 'done' }))).toBe('A finished task stays on the day it was due.');
    expect(moveBlockReason(item({ projectArchived: true }))).toBe('Tasks of an archived project can’t be moved.');
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
    const t = task({ recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1] } });
    expect(planMove(t, '2026-10-12', '2026-10-14', 'occurrence')).toEqual({ dueDate: '2026-10-14', expectedVersion: 4, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], resumeFrom: '2026-10-12' } });
    const moved = task({ recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], resumeFrom: '2026-10-12' }, dueDate: '2026-10-14T00:00:00.000Z' });
    expect(planMove(moved, '2026-10-14', '2026-10-15', 'occurrence').recurrenceRule?.resumeFrom).toBe('2026-10-12');
  });

  it('this and future occurrences: the schedule moves with it', () => {
    const t = task({ recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [1], resumeFrom: '2026-10-12' } });
    expect(planMove(t, '2026-10-12', '2026-10-14', 'series')).toEqual({ dueDate: '2026-10-14', expectedVersion: 4, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [3] } });
  });

  it('undo puts back the day and the rule exactly as they were', () => {
    const rule: RecurrenceRule = { freq: 'WEEKLY', interval: 1, weekdays: [1] };
    expect(planUndo(task({ recurrenceRule: rule }), '2026-10-12', 7)).toEqual({ dueDate: '2026-10-12', expectedVersion: 7, recurrenceRule: rule });
    expect(planUndo(task({}), '2026-10-12', 5)).toEqual({ dueDate: '2026-10-12', expectedVersion: 5 });
  });

  it('hands the edit and the version it was read at apart (the app’s task writes add the newest version)', () => {
    expect(splitVersion({ dueDate: '2026-10-14', expectedVersion: 4 })).toEqual({ patch: { dueDate: '2026-10-14' }, version: 4 });
    expect(splitVersion({ dueDate: '2026-10-14' })).toEqual({ patch: { dueDate: '2026-10-14' }, version: undefined });
  });
});

describe('shiftRule — moving a schedule to another day', () => {
  it('weekly: the moved weekday becomes the new one', () => {
    expect(shiftRule({ freq: 'WEEKLY', interval: 1, weekdays: [1, 3] }, '2026-10-12', '2026-10-13')).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [2, 3] });
    expect(shiftRule({ freq: 'WEEKLY', interval: 2 }, '2026-10-12', '2026-10-13')).toEqual({ freq: 'WEEKLY', interval: 2 });
  });
  it('monthly: the day of the month, or “the nth weekday”', () => {
    expect(shiftRule({ freq: 'MONTHLY', interval: 1, dayOfMonth: 15 }, '2026-10-15', '2026-10-18')).toEqual({ freq: 'MONTHLY', interval: 1, dayOfMonth: 18 });
    expect(shiftRule({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 2 } }, '2026-10-13', '2026-10-15')).toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: 3, day: 4 } });
    expect(shiftRule({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 5 } }, '2026-10-30', '2026-10-29')).toEqual({ freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 4 } });
  });
});

describe('what the screen says', () => {
  const rule: RecurrenceRule = { freq: 'WEEKLY', interval: 1 };
  it('after a move, and after its undo', () => {
    expect(movedText(task({}), '2026-10-13', 'occurrence')).toBe('Moved MICO-1 to Tue 13 Oct.');
    expect(movedText(task({ recurrenceRule: rule }), '2026-10-13', 'occurrence')).toBe('Moved MICO-1 to Tue 13 Oct (this occurrence only).');
    expect(movedText(task({ recurrenceRule: rule }), '2026-10-13', 'series')).toBe('Moved MICO-1 to Tue 13 Oct (and the occurrences after it).');
    expect(undoneText(task({}), '2026-10-12')).toBe('MICO-1 is back on Mon 12 Oct.');
  });

  it('when the move is kept on the phone, or refused', () => {
    expect(queuedMoveText(task({}), '2026-10-13')).toBe('Saved on this phone — MICO-1 moves to Tue 13 Oct when you’re online.');
    expect(moveFailedText(task({}), '2026-10-12', new ApiError(400, 'VALIDATION', 'The due date is not valid.'))).toBe('Couldn’t move MICO-1 — The due date is not valid. It’s back on Mon 12 Oct.');
    expect(moveFailedText(task({}), '2026-10-12', new ApiError(409, 'VERSION_CONFLICT', 'Changed'))).toBe('Couldn’t move MICO-1 — someone else changed it; pull down to reload. It’s back on Mon 12 Oct.');
    expect(moveFailedText(task({}), '2026-10-12', new ApiError(500, 'HTTP_500', 'Request failed (500)'))).toBe('Couldn’t move MICO-1 — the server had a problem. It’s back on Mon 12 Oct.');
    expect(moveFailedText(task({}), '2026-10-12', new NetworkError('offline'))).toBe('Couldn’t move MICO-1 — the server couldn’t be reached. It’s back on Mon 12 Oct.');
  });

  it('explains a projected copy, as the website does', () => {
    const head = task({ recurrenceRule: rule, dueDate: '2026-10-12T00:00:00.000Z' });
    const copy = item({ kind: 'projected', status: 'projected', task: head, date: '2026-10-19', key: 'proj:t1:2026-10-19' });
    expect(projectedNote(copy, 'Asia/Muscat')).toBe('This copy will be created when the current one is completed — it isn’t a task yet. The current copy is due Mon 12 Oct.');
    const scheduled = { ...copy, task: { ...head, recurrenceRule: { ...rule, createNext: 'ON_SCHEDULE' as const } } };
    expect(projectedNote(scheduled, 'Asia/Muscat')).toBe('This copy will be created on Mon 19 Oct — it isn’t a task yet. The current copy is due Mon 12 Oct.');
  });

  it('offers quick days: today, tomorrow and a week later than now', () => {
    expect(quickDays('2026-10-21', '2026-10-12')).toEqual([
      { label: 'Today', day: '2026-10-21' },
      { label: 'Tomorrow', day: '2026-10-22' },
      { label: 'A week later', day: '2026-10-19' },
    ]);
  });
});

/**
 * The website's rescheduling (Web Portal/frontend/src/lib/calendar-reschedule.ts) and this one must
 * save the same change for every kind of repeat.
 */
const webMove = resolve(__dirname, '../../../Web Portal/frontend/src/lib/calendar-reschedule.ts');
describe.skipIf(!existsSync(webMove))('the same as the website', () => {
  type Fn = (...args: unknown[]) => unknown;
  const load = async () => (await import(/* @vite-ignore */ webMove)) as Record<string, Fn>;
  const rules: (RecurrenceRule | null)[] = [
    null,
    { freq: 'DAILY', interval: 1 },
    { freq: 'WEEKLY', interval: 1, weekdays: [1, 4] },
    { freq: 'WEEKLY', interval: 2, weekdays: [1], resumeFrom: '2026-10-05' },
    { freq: 'MONTHLY', interval: 1, dayOfMonth: 12 },
    { freq: 'MONTHLY', interval: 1, nthWeekday: { week: 2, day: 1 } },
    { freq: 'MONTHLY', interval: 1, nthWeekday: { week: -1, day: 1 } },
    { freq: 'QUARTERLY', interval: 1, anchorDay: 12 },
    { freq: 'YEARLY', interval: 1, anchorDay: 12, count: 5, until: '2030-01-01', createNext: 'ON_SCHEDULE' },
  ];
  const moves = [['2026-10-12', '2026-10-14'], ['2026-10-12', '2026-10-31'], ['2026-10-12', '2026-10-26'], ['2026-10-12', '2026-11-02']];

  it('plans moves and undos alike', async () => {
    const web = await load();
    for (const rule of rules) {
      for (const version of [undefined, 3]) {
        const t = task({ recurrenceRule: rule, version });
        expect(needsSeriesChoice(t)).toBe(web.needsSeriesChoice!(t));
        for (const [from, to] of moves) {
          for (const scope of ['occurrence', 'series'] as const) {
            expect(planMove(t, from!, to!, scope), `${JSON.stringify(rule)} ${from}→${to} ${scope}`).toEqual(web.planMove!(t, from, to, scope));
          }
          expect(planUndo(t, from!, 9)).toEqual(web.planUndo!(t, from, 9));
        }
      }
    }
    for (const kind of ['task', 'projected'] as const) {
      for (const status of ['todo', 'done', 'overdue', 'projected'] as const) {
        for (const projectArchived of [false, true]) expect(canReschedule({ kind, status, projectArchived })).toBe(web.canReschedule!({ kind, status, projectArchived }));
      }
    }
  });
});
