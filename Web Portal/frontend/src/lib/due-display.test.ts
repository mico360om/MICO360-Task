import { describe, it, expect } from 'vitest';
import { formatDueDay, dueInputValue, isTaskDone } from './due-display';

describe('due-display', () => {
  it('shows the picked calendar day regardless of the stored UTC instant', () => {
    expect(formatDueDay('2026-09-30T00:00:00.000Z', 'Asia/Muscat')).toBe('Sep 30, 2026');
    expect(formatDueDay('2026-09-30T00:00:00.000Z', 'America/New_York')).toBe('Sep 30, 2026');
    expect(formatDueDay('2026-09-30', 'Asia/Muscat', { month: 'short', day: 'numeric' })).toBe('Sep 30');
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
