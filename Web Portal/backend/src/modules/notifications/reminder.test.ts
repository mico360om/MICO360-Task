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

  it('builds a stable per-period de-dup key', () => {
    const [n] = planReminders([{ id: 't1', title: 'x', dueDate: yesterday, assigneeIds: ['u1'] }], { now });
    expect(reminderKey(n!, '2026-09-08')).toBe('TASK_OVERDUE:t1:u1:2026-09-08');
  });
});
