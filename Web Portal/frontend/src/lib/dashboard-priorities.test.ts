import { describe, it, expect } from 'vitest';
import {
  chipsShown,
  nextWeekStart,
  planTaskReschedule,
  reasonText,
  rescheduleChoices,
  rowsFor,
  tagsOf,
  PRIORITIES_EMPTY,
  SHOWN_FIRST,
} from './dashboard-priorities';
import type { PriorityRow, PriorityTask } from '../api/dashboard';

// 1.23.4 Smarter Dashboard — "My Priorities Today" in words: each reason, the chips, Reschedule's days and
// what a reschedule (and its Undo) sends.
const task = (o: Partial<PriorityTask> = {}): PriorityTask => ({
  id: 't1',
  key: 'RIG-4',
  title: 'Pump',
  priority: 'NORMAL',
  dueDate: '2026-11-04',
  startDate: '2026-11-01',
  startAt: '2026-11-01T05:00:00.000Z',
  version: 3,
  columnId: 'c-todo',
  project: { id: 'p1', code: 'RIG', name: 'Rig', color: null, icon: null, imageUrl: null },
  assignees: [{ id: 'u1', name: 'Omar Ahmed' }],
  blockers: [],
  doneColumnId: 'c-done',
  recurrenceRule: null,
  can: { complete: true, reschedule: true, assign: true, approve: false },
  ...o,
});
const row = (o: Partial<PriorityRow>): PriorityRow => ({ id: 'task:t1', kind: 'task', reason: { code: 'due-today' }, also: [], chips: ['today'], group: 4, task: task(), ...o });

describe('each reason in words (design: "Overdue 2 days", "Blocks 3 tasks", "Blocked by RIG-4"…)', () => {
  it('says why', () => {
    expect(reasonText({ code: 'overdue', days: 1 })).toBe('Overdue 1 day');
    expect(reasonText({ code: 'overdue', days: 2 })).toBe('Overdue 2 days');
    expect(reasonText({ code: 'approval', since: null })).toBe('Waiting for your approval');
    expect(reasonText({ code: 'blocking', count: 1 })).toBe('Blocks 1 task');
    expect(reasonText({ code: 'blocking', count: 3 })).toBe('Blocks 3 tasks');
    expect(reasonText({ code: 'due-today' })).toBe('Due today');
    expect(reasonText({ code: 'urgent' })).toBe('Urgent');
    expect(reasonText({ code: 'unassigned' })).toBe('No one assigned');
    expect(reasonText({ code: 'blocked-status' })).toBe('Blocked (status)');
    expect(reasonText({ code: 'blocked-by', blockers: [{ id: 'b', key: 'RIG-4' }] })).toBe('Blocked by RIG-4');
    expect(reasonText({ code: 'blocked-by', blockers: [{ id: 'b', key: 'RIG-4' }, { id: 'c', key: 'RIG-9' }, { id: 'd', key: 'OPS-1' }] })).toBe('Blocked by RIG-4 and 2 more');
    expect(reasonText({ code: 'due-soon', days: 1 })).toBe('Due tomorrow');
    expect(reasonText({ code: 'due-soon', days: 2 })).toBe('Due in 2 days');
  });

  it('a team row names whose it is: "Overdue 4 days · Omar Ahmed", two people "· Omar Ahmed +1"', () => {
    expect(reasonText({ code: 'team-overdue', days: 4 }, [{ id: 'u1', name: 'Omar Ahmed' }])).toBe('Overdue 4 days · Omar Ahmed');
    expect(reasonText({ code: 'team-blocked' }, [{ id: 'u1', name: 'Omar Ahmed' }, { id: 'u2', name: 'Sara' }])).toBe('Blocked (status) · Omar Ahmed +1');
    expect(reasonText({ code: 'team-overdue', days: 3 }, [])).toBe('Overdue 3 days');
  });

  it('the strongest reason first, the rest as small tags ("Due today · Blocks 2")', () => {
    expect(tagsOf(row({ reason: { code: 'blocking', count: 2 }, also: [{ code: 'due-today' }, { code: 'urgent' }] }))).toEqual(['Blocks 2 tasks', 'Due today', 'Urgent']);
  });
});

describe('chips and the first ten', () => {
  it('All · Overdue · Today · Approvals · Blocked · Upcoming, and Team for the people who run projects', () => {
    expect(chipsShown(false)).toEqual(['all', 'overdue', 'today', 'approvals', 'blocked', 'upcoming']);
    expect(chipsShown(true)).toEqual(['all', 'overdue', 'today', 'approvals', 'blocked', 'upcoming', 'team']);
  });

  it('a chip keeps the rows that count under it; the list shows the first 10 until Show all', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row({ id: `task:${i}`, chips: i % 2 ? ['overdue'] : ['today'] }));
    expect(SHOWN_FIRST).toBe(10);
    expect(rowsFor(rows, 'all', false)).toHaveLength(10);
    expect(rowsFor(rows, 'all', true)).toHaveLength(14);
    expect(rowsFor(rows, 'overdue', true).every((r) => r.chips.includes('overdue'))).toBe(true);
    expect(rowsFor(rows, 'overdue', false)).toHaveLength(7);
    expect(PRIORITIES_EMPTY).toBe('Nothing urgent — you’re clear for today.');
  });
});

describe('Reschedule: Today · Tomorrow · Next week · Pick a date', () => {
  it('next week starts on the company week’s first day', () => {
    // Friday 6 Nov 2026.
    expect(nextWeekStart('2026-11-06', 0)).toBe('2026-11-08'); // Sunday
    expect(nextWeekStart('2026-11-06', 1)).toBe('2026-11-09'); // Monday
    expect(nextWeekStart('2026-11-06', 6)).toBe('2026-11-07'); // Saturday
    // On the week's first day itself: a week later.
    expect(nextWeekStart('2026-11-08', 0)).toBe('2026-11-15');
  });

  it('the three quick days, each with its date in words', () => {
    expect(rescheduleChoices('2026-11-06', 1)).toEqual([
      { label: 'Today', day: '2026-11-06', hint: 'Fri 6 Nov' },
      { label: 'Tomorrow', day: '2026-11-07', hint: 'Sat 7 Nov' },
      { label: 'Next week', day: '2026-11-09', hint: 'Mon 9 Nov' },
    ]);
  });

  it('sends the new day from the copy it saw; Undo puts the old day back', () => {
    const plan = planTaskReschedule(task(), '2026-11-07');
    expect(plan.patch).toEqual({ dueDate: '2026-11-07', expectedVersion: 3 });
    expect(plan.undo(4)).toEqual({ dueDate: '2026-11-04', expectedVersion: 4 });
  });

  it('keeps the start ≤ due rule: a start after the new day moves to it; Undo puts the start back as it was', () => {
    const plan = planTaskReschedule(task({ startDate: '2026-11-05', startAt: '2026-11-05T05:00:00.000Z' }), '2026-11-03');
    expect(plan.patch).toEqual({ dueDate: '2026-11-03', startDate: '2026-11-03', expectedVersion: 3 });
    expect(plan.undo(4)).toEqual({ dueDate: '2026-11-04', startDate: '2026-11-05T05:00:00.000Z', expectedVersion: 4 });
  });

  it('a repeating task moves only this occurrence (the day it replaced is noted); Undo puts the rule back', () => {
    const rule = { freq: 'WEEKLY' as const, interval: 1, weekdays: [3] };
    const plan = planTaskReschedule(task({ recurrenceRule: rule }), '2026-11-06');
    expect(plan.patch).toEqual({ dueDate: '2026-11-06', recurrenceRule: { ...rule, resumeFrom: '2026-11-04' }, expectedVersion: 3 });
    expect(plan.undo(4)).toEqual({ dueDate: '2026-11-04', recurrenceRule: rule, expectedVersion: 4 });
  });

  it('a task with no date gets one; Undo takes it off again', () => {
    const plan = planTaskReschedule(task({ dueDate: null }), '2026-11-06');
    expect(plan.patch).toEqual({ dueDate: '2026-11-06', expectedVersion: 3 });
    expect(plan.undo(4)).toEqual({ dueDate: null, expectedVersion: 4 });
  });
});
