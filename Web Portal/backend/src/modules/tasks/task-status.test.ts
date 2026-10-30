import { describe, it, expect } from 'vitest';
import { isTaskDone, isTaskLate } from './task-status';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-30T06:00:00Z'); // 10:00 on Fri 30 Oct in Muscat
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

describe('isTaskLate: past its due day and not done — and not while it waits for approval (owner, 30 Oct; ruling 45)', () => {
  const open = { dueDate: day('2026-10-28'), columnCategory: 'IN_PROGRESS', completedAt: null };

  it('an open task past its due day is late; due today or later, or with no due date, it is not', () => {
    expect(isTaskLate(open, TZ, NOW)).toBe(true);
    expect(isTaskLate({ ...open, dueDate: day('2026-10-30') }, TZ, NOW)).toBe(false);
    expect(isTaskLate({ ...open, dueDate: null }, TZ, NOW)).toBe(false);
  });

  it('a finished task is never late', () => {
    expect(isTaskLate({ ...open, columnCategory: 'DONE' }, TZ, NOW)).toBe(false);
    expect(isTaskLate({ ...open, completedAt: new Date('2026-10-29T08:00:00Z') }, TZ, NOW)).toBe(false);
  });

  it('a task waiting for approval is not late while it waits; sent back (no longer waiting), it is late again', () => {
    expect(isTaskLate({ ...open, columnCategory: 'REVIEW', approvalRequestedAt: new Date('2026-10-29T08:00:00Z') }, TZ, NOW)).toBe(false);
    expect(isTaskLate({ ...open, approvalRequestedAt: '2026-10-29T08:00:00.000Z' }, TZ, NOW)).toBe(false);
    expect(isTaskLate({ ...open, approvalRequestedAt: null }, TZ, NOW)).toBe(true);
    // Waiting doesn't make it done.
    expect(isTaskDone({ ...open, approvalRequestedAt: new Date() } as never)).toBe(false);
  });
});
