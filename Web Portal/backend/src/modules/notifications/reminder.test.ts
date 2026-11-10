import { describe, it, expect } from 'vitest';
import { planReminders, planChecklistReminders, reminderKey } from './reminder';

const now = new Date('2026-09-08T12:00:00.000Z');
const inOneHour = new Date('2026-09-08T13:00:00.000Z');
const inThreeDays = new Date('2026-09-11T12:00:00.000Z');
const yesterday = new Date('2026-09-07T12:00:00.000Z');

describe('planReminders', () => {
  it('emits an overdue reminder per assignee of a past-due, not-done task', () => {
    const out = planReminders([{ id: 't1', title: 'Ship', dueDate: yesterday, columnCategory: 'TODO', assigneeIds: ['u1', 'u2'] }], { now });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ userId: 'u1', type: 'TASK_OVERDUE', entityId: 't1', body: 'Ship' });
    expect(out[1]!.userId).toBe('u2');
  });

  it('names the task by its number and title, like every other task notice (1.22.3): "MICO-142 · Ship"', () => {
    const out = planReminders(
      [
        { id: 't1', key: 'MICO-142', title: 'Ship', dueDate: yesterday, assigneeIds: ['u1'] },
        { id: 't2', key: 'MICO-143', title: 'Soon', dueDate: inOneHour, assigneeIds: ['u1'] },
      ],
      { now },
    );
    expect(out.map((n) => [n.type, n.title, n.body])).toEqual([
      ['TASK_OVERDUE', 'A task is overdue', 'MICO-142 · Ship'],
      ['TASK_DUE_SOON', 'A task is due soon', 'MICO-143 · Soon'],
    ]);
  });

  it('emits a due-soon reminder for a task within the window', () => {
    const out = planReminders([{ id: 't1', title: 'Soon', dueDate: inOneHour, assigneeIds: ['u1'] }], { now });
    expect(out[0]).toMatchObject({ type: 'TASK_DUE_SOON', entityId: 't1' });
  });

  it('ignores tasks that are far off, done, or have no due date / no assignees', () => {
    const out = planReminders(
      [
        { id: 'far', title: 'Later', dueDate: inThreeDays, assigneeIds: ['u1'] }, // outside 24h window
        { id: 'done', title: 'Done', dueDate: yesterday, columnCategory: 'DONE', assigneeIds: ['u1'] },
        { id: 'nodue', title: 'No due', dueDate: null, assigneeIds: ['u1'] },
        { id: 'nobody', title: 'Unassigned', dueDate: yesterday, assigneeIds: [] },
      ],
      { now },
    );
    expect(out).toEqual([]);
  });

  it('honours a per-user reminder lead time (earlier reminder for a user who wants more notice)', () => {
    const task = [{ id: 't1', title: 'Later', dueDate: inThreeDays, assigneeIds: ['u1', 'u2'] }]; // due in 3 days
    // u1 wants 4 days (5760 min) notice → reminded now; u2 has no preference → default 24h → not yet.
    const out = planReminders(task, { now, leadMinutesFor: (id) => (id === 'u1' ? 4 * 24 * 60 : undefined) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: 'u1', type: 'TASK_DUE_SOON', entityId: 't1' });
  });

  it('treats due dates as company-time calendar days (not overdue from 04:00 on the due day)', () => {
    const tz = 'Asia/Muscat';
    const tenAm = new Date('2026-09-30T06:00:00Z'); // 10:00 on 30 Sep in Muscat
    const midnight = (d: string) => new Date(`${d}T00:00:00Z`);
    const out = planReminders(
      [
        { id: 'today', title: 'a', dueDate: midnight('2026-09-30'), assigneeIds: ['u1'] },
        { id: 'tomorrow', title: 'b', dueDate: midnight('2026-10-01'), assigneeIds: ['u1'] },
        { id: 'later', title: 'c', dueDate: midnight('2026-10-02'), assigneeIds: ['u1'] },
        { id: 'late', title: 'd', dueDate: midnight('2026-09-29'), assigneeIds: ['u1'] },
      ],
      { now: tenAm, timeZone: tz },
    );
    expect(out.map((n) => `${n.entityId}:${n.type}`)).toEqual(['today:TASK_DUE_SOON', 'tomorrow:TASK_DUE_SOON', 'late:TASK_OVERDUE']);
    // From local midnight the 30th is overdue.
    const nextDay = planReminders([{ id: 'today', title: 'a', dueDate: midnight('2026-09-30'), assigneeIds: ['u1'] }], { now: new Date('2026-09-30T20:30:00Z'), timeZone: tz });
    expect(nextDay[0]!.type).toBe('TASK_OVERDUE');
  });

  it('never reminds about a task that carries a completion time', () => {
    const out = planReminders([{ id: 't', title: 'x', dueDate: yesterday, columnCategory: 'IN_PROGRESS', completedAt: yesterday, assigneeIds: ['u1'] }], { now });
    expect(out).toEqual([]);
  });

  it('builds a stable per-period de-dup key', () => {
    const [n] = planReminders([{ id: 't1', title: 'x', dueDate: yesterday, assigneeIds: ['u1'] }], { now });
    expect(reminderKey(n!, '2026-09-08')).toBe('TASK_OVERDUE:t1:u1:2026-09-08');
  });
});

describe('planReminders: tasks waiting for approval (owner, 30 Oct)', () => {
  const waited = new Date('2026-09-07T09:00:00.000Z');
  it('a task waiting for approval gets no overdue or due-soon reminders — its approver sees it under To approve', () => {
    const out = planReminders(
      [
        { id: 'late', title: 'Report', dueDate: yesterday, columnCategory: 'REVIEW', approvalRequestedAt: waited, assigneeIds: ['u1'] },
        { id: 'soon', title: 'Drawing', dueDate: inOneHour, columnCategory: 'REVIEW', approvalRequestedAt: waited, assigneeIds: ['u1'] },
      ],
      { now },
    );
    expect(out).toEqual([]);
  });
  it('sent back (no longer waiting): the reminders start again', () => {
    const out = planReminders([{ id: 'late', title: 'Report', dueDate: yesterday, columnCategory: 'IN_PROGRESS', approvalRequestedAt: null, assigneeIds: ['u1'] }], { now });
    expect(out).toEqual([expect.objectContaining({ type: 'TASK_OVERDUE', entityId: 'late', userId: 'u1' })]);
  });
});

describe('planChecklistReminders (1.23.3, design call 4)', () => {
  const item = (id: string, dueDate: Date, assigneeId: string | null, taskAssigneeIds: string[] = ['a1', 'a2']) => ({
    id, text: `Item ${id}`, dueDate, assigneeId, taskId: 't1', taskKey: 'MICO-142', taskTitle: 'Wiring', taskAssigneeIds,
  });
  it('an assigned dated item reminds its assignee only; an unassigned one reminds the task’s assignees', () => {
    const out = planChecklistReminders([item('i1', yesterday, 'u9'), item('i2', inOneHour, null)], { now });
    expect(out.map((n) => [n.userId, n.type, n.title, n.body, n.entityType, n.entityId, n.dedupeId])).toEqual([
      ['u9', 'TASK_OVERDUE', 'A checklist item is overdue', 'MICO-142 · Item i1', 'task', 't1', 'item:i1'],
      ['a1', 'TASK_DUE_SOON', 'A checklist item is due soon', 'MICO-142 · Item i2', 'task', 't1', 'item:i2'],
      ['a2', 'TASK_DUE_SOON', 'A checklist item is due soon', 'MICO-142 · Item i2', 'task', 't1', 'item:i2'],
    ]);
  });
  it('follows each person’s lead time and leaves far-off items alone', () => {
    expect(planChecklistReminders([item('i3', inThreeDays, 'u9')], { now })).toEqual([]);
    expect(planChecklistReminders([item('i3', inThreeDays, 'u9')], { now, leadMinutesFor: () => 4 * 24 * 60 })).toHaveLength(1);
  });
  it('de-duplicates by item, person and day — never with the task’s own reminder', () => {
    const [n] = planChecklistReminders([item('i1', yesterday, 'u9')], { now });
    const task = planReminders([{ id: 't1', title: 'Wiring', dueDate: yesterday, assigneeIds: ['u9'] }], { now })[0]!;
    expect(reminderKey(n!, '2026-09-08')).toBe('TASK_OVERDUE:item:i1:u9:2026-09-08');
    expect(reminderKey(task, '2026-09-08')).not.toBe(reminderKey(n!, '2026-09-08'));
  });
});

describe('planReminders: tasks scheduled for the future (owner, 10 Nov)', () => {
  // 16:00 on 8 Sep in Muscat (the default company time zone is passed explicitly).
  const TZ = 'Asia/Muscat';
  it('a task waiting for its start day gets no reminder before that day — not even “due soon”', () => {
    // Starts (and is due) tomorrow: on tomorrow's board, it waits today.
    const waiting = { id: 'w', title: 'Starts tomorrow', dueDate: new Date('2026-09-09T00:00:00Z'), boardDate: new Date('2026-09-09T12:00:00Z'), assigneeIds: ['u1'] };
    expect(planReminders([waiting], { now, timeZone: TZ })).toEqual([]);
    // On its day it is like any task: due today, so due soon.
    expect(planReminders([waiting], { now: new Date('2026-09-09T06:00:00Z'), timeZone: TZ }).map((n) => n.type)).toEqual(['TASK_DUE_SOON']);
  });

  it('a task on today’s (or a past) board is reminded as before', () => {
    const today = { id: 'n', title: 'Due tomorrow', dueDate: new Date('2026-09-09T00:00:00Z'), boardDate: new Date('2026-09-08T12:00:00Z'), assigneeIds: ['u1'] };
    expect(planReminders([today], { now, timeZone: TZ }).map((n) => n.type)).toEqual(['TASK_DUE_SOON']);
  });
});
