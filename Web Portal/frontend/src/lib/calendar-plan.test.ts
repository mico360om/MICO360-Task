import { describe, it, expect } from 'vitest';
import type { ApiTask } from '../api/tasks';
import {
  blockMovePlan,
  blockResizePlan,
  canDragMeeting,
  meetingMovePlan,
  planDatesUndo,
  planDueAt,
  planEdge,
  planShift,
  waitWords,
} from './calendar-plan';

const TZ = 'Asia/Muscat';
const task = (extra: Partial<ApiTask>): ApiTask =>
  ({ id: 't', key: 'RIG-1', title: 'Task', projectId: 'p1', columnId: 'c', position: 0, priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', columnCategory: 'TODO', version: 4, ...extra }) as ApiTask;

describe('dragging a task’s bar: start and due together (owner)', () => {
  it('keeps its length; a timed due date keeps its time', () => {
    expect(planShift(task({ startDate: '2026-11-03T00:00:00.000Z', dueDate: '2026-11-06T00:00:00.000Z' }), 3, 'occurrence', TZ)).toEqual({ startDate: '2026-11-06', dueDate: '2026-11-09', expectedVersion: 4 });
    // Due 14:30 Muscat on the 6th → the 9th at 14:30.
    expect(planShift(task({ startDate: '2026-11-03', dueDate: '2026-11-06T10:30:00.000Z' }), 3, 'occurrence', TZ)).toEqual({ startDate: '2026-11-06', dueDate: '2026-11-09T10:30:00.000Z', expectedVersion: 4 });
    // Due only: only the due date.
    expect(planShift(task({ dueDate: '2026-11-06' }), -1, 'occurrence', TZ)).toEqual({ dueDate: '2026-11-05', expectedVersion: 4 });
  });

  it('a repeating newest copy: this occurrence notes the day it replaced; the series moves its schedule', () => {
    const t = task({ startDate: '2026-11-02', dueDate: '2026-11-05', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [4] } });
    expect(planShift(t, 1, 'occurrence', TZ).recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [4], resumeFrom: '2026-11-05' });
    expect(planShift(t, 1, 'series', TZ).recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 1, weekdays: [5] });
  });
});

describe('dragging one end: the start or the due date alone', () => {
  const t = task({ startDate: '2026-11-03', dueDate: '2026-11-06' });
  it('changes that date only, never past the other', () => {
    expect(planEdge(t, 'due', '2026-11-10', TZ)).toEqual({ dueDate: '2026-11-10', expectedVersion: 4 });
    expect(planEdge(t, 'start', '2026-11-01', TZ)).toEqual({ startDate: '2026-11-01', expectedVersion: 4 });
    expect(planEdge(t, 'start', '2026-11-06', TZ)).toEqual({ startDate: '2026-11-06', expectedVersion: 4 });
    expect(planEdge(t, 'start', '2026-11-07', TZ)).toBeNull();
    expect(planEdge(t, 'due', '2026-11-02', TZ)).toBeNull();
    // A timed due keeps its time on its new day.
    expect(planEdge(task({ dueDate: '2026-11-06T10:30:00.000Z' }), 'due', '2026-11-08', TZ)).toEqual({ dueDate: '2026-11-08T10:30:00.000Z', expectedVersion: 4 });
  });

  it('the ⚑ dropped on an hour: due then (call 4)', () => {
    expect(planDueAt(task({ dueDate: '2026-11-06' }), '2026-11-06', 15 * 60, TZ)).toEqual({ dueDate: '2026-11-06T11:00:00.000Z', expectedVersion: 4 });
  });

  it('Undo puts back what moved (both dates, or the one), as it was, and the repeat', () => {
    const r = { freq: 'WEEKLY' as const, interval: 1 };
    const t = task({ startDate: '2026-11-03T00:00:00.000Z', dueDate: '2026-11-06T10:30:00.000Z', recurrenceRule: r });
    expect(planDatesUndo(t, 7)).toEqual({ startDate: '2026-11-03', dueDate: '2026-11-06T10:30:00.000Z', recurrenceRule: r, expectedVersion: 7 });
    // Only the due date moved (no repeat change): only it goes back.
    expect(planDatesUndo(t, 7, { dueDate: '2026-11-08T10:30:00.000Z' })).toEqual({ dueDate: '2026-11-06T10:30:00.000Z', expectedVersion: 7 });
    expect(planDatesUndo(task({ dueDate: '2026-11-06T00:00:00.000Z' }), 7, { dueDate: '2026-11-07' })).toEqual({ dueDate: '2026-11-06', expectedVersion: 7 });
  });
});

describe('a task nobody has started waits for a later start day (call 6)', () => {
  it('“It will wait until 20 Nov.” — only for a not-started task moved to start after today', () => {
    const t = task({ columnCategory: 'TODO' });
    expect(waitWords(t, '2026-11-20', '2026-11-11')).toBe('It will wait until Fri 20 Nov.');
    expect(waitWords(t, '2027-01-04', '2026-11-11')).toBe('It will wait until Mon 4 Jan 2027.');
    expect(waitWords(t, '2026-11-11', '2026-11-11')).toBeNull();
    expect(waitWords(task({ columnCategory: 'IN_PROGRESS' }), '2026-11-20', '2026-11-11')).toBeNull();
    expect(waitWords(task({ columnCategory: 'TODO', approvalRequestedAt: '2026-11-10T00:00:00Z' }), '2026-11-20', '2026-11-11')).toBeNull();
    expect(waitWords(task({ columnCategory: 'DONE', completedAt: '2026-11-10T00:00:00Z' }), '2026-11-20', '2026-11-11')).toBeNull();
    expect(waitWords(t, null, '2026-11-11')).toBeNull();
  });
});

describe('work blocks and meetings', () => {
  const block = { startAt: '2026-11-12T05:00:00.000Z', endAt: '2026-11-12T06:30:00.000Z' };
  it('a block moved keeps its length; resized from its end, never under 15 minutes', () => {
    expect(blockMovePlan(block, '2026-11-13T07:00:00.000Z')).toEqual({ startAt: '2026-11-13T07:00:00.000Z', endAt: '2026-11-13T08:30:00.000Z' });
    expect(blockResizePlan(block, '2026-11-12T07:00:00.000Z')).toEqual({ startAt: block.startAt, endAt: '2026-11-12T07:00:00.000Z' });
    expect(blockResizePlan(block, '2026-11-12T05:10:00.000Z')).toBeNull();
  });

  it('a meeting moved keeps its length (one without an end lasts an hour)', () => {
    expect(meetingMovePlan({ startAt: '2026-11-12T05:00:00.000Z', endAt: '2026-11-12T05:45:00.000Z' }, '2026-11-12T08:00:00.000Z')).toEqual({ startAt: '2026-11-12T08:00:00.000Z', endAt: '2026-11-12T08:45:00.000Z' });
    expect(meetingMovePlan({ startAt: '2026-11-12T05:00:00.000Z', endAt: null }, '2026-11-12T08:00:00.000Z')).toEqual({ startAt: '2026-11-12T08:00:00.000Z', endAt: '2026-11-12T09:00:00.000Z' });
  });

  it('only its organizer drags a meeting still to come — never a cancelled or finished one', () => {
    const now = new Date('2026-11-12T04:00:00.000Z');
    const m = { organizerId: 'me', cancelled: false, status: 'SCHEDULED' as const, startAt: '2026-11-12T05:00:00.000Z' };
    expect(canDragMeeting(m, 'me', now)).toBe(true);
    expect(canDragMeeting(m, 'you', now)).toBe(false);
    expect(canDragMeeting({ ...m, cancelled: true, status: 'CANCELLED' }, 'me', now)).toBe(false);
    expect(canDragMeeting({ ...m, status: 'COMPLETED' }, 'me', now)).toBe(false);
    expect(canDragMeeting({ ...m, startAt: '2026-11-12T03:00:00.000Z' }, 'me', now)).toBe(false);
  });
});
