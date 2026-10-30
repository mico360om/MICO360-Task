import { describe, it, expect } from 'vitest';
import { formatDueDay, dueInputValue, isTaskDone, isTaskLate } from './due-display';

describe('isTaskLate: past its due day and not done — never while it waits for approval (owner, 30 Oct; ruling 45)', () => {
  const NOW = new Date('2026-10-30T06:00:00Z'); // 10:00 on 30 Oct in Muscat
  const open = { dueDate: '2026-10-28T00:00:00.000Z', columnCategory: 'IN_PROGRESS', completedAt: null };
  it('open and past its due day: late; due today, no date or done: not', () => {
    expect(isTaskLate(open, 'Asia/Muscat', NOW)).toBe(true);
    expect(isTaskLate({ ...open, dueDate: '2026-10-30' }, 'Asia/Muscat', NOW)).toBe(false);
    expect(isTaskLate({ ...open, dueDate: null }, 'Asia/Muscat', NOW)).toBe(false);
    expect(isTaskLate({ ...open, columnCategory: 'DONE' }, 'Asia/Muscat', NOW)).toBe(false);
  });
  it('waiting for approval: not late; sent back (no longer waiting): late again', () => {
    expect(isTaskLate({ ...open, columnCategory: 'REVIEW', approvalRequestedAt: '2026-10-01T08:00:00.000Z' }, 'Asia/Muscat', NOW)).toBe(false);
    expect(isTaskLate({ ...open, approvalRequestedAt: null }, 'Asia/Muscat', NOW)).toBe(true);
  });
});

describe('due-display', () => {
  it('shows the picked calendar day regardless of the stored UTC instant', () => {
    expect(formatDueDay('2026-09-30T00:00:00.000Z', 'Asia/Muscat')).toBe('30 Sep 2026');
    expect(formatDueDay('2026-09-30T00:00:00.000Z', 'America/New_York')).toBe('30 Sep 2026');
    expect(formatDueDay('2026-09-30', 'Asia/Muscat', { month: 'short', day: 'numeric' })).toBe('30 Sep');
    // Day before month with the weekday too, as the minutes PDF and the daily emails write it.
    expect(formatDueDay('2026-10-30', 'Asia/Muscat', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })).toBe('Fri 30 Oct 2026');
    expect(formatDueDay(null, 'Asia/Muscat')).toBe('');
  });

  it('gives a date input its calendar day', () => {
    expect(dueInputValue('2026-01-05T00:00:00.000Z', 'Asia/Muscat')).toBe('2026-01-05');
    expect(dueInputValue(null, 'Asia/Muscat')).toBe('');
  });

  it('treats DONE-column or completed tasks as done', () => {
    expect(isTaskDone({ columnCategory: 'DONE', completedAt: null })).toBe(true);
    expect(isTaskDone({ columnCategory: 'TODO', completedAt: '2026-09-01T00:00:00Z' })).toBe(true);
    expect(isTaskDone({ columnCategory: 'TODO', completedAt: null })).toBe(false);
  });
});
