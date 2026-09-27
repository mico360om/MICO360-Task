import { describe, it, expect } from 'vitest';
import { planReminders, reminderKey } from './reminder';

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
