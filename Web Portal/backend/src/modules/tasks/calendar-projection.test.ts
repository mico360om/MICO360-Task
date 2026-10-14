import { describe, it, expect } from 'vitest';
import { projectOccurrences } from './calendar-projection';
import type { RecurrenceRule } from './recurrence';

const day = (k: string) => new Date(`${k}T00:00:00.000Z`);
const head = (rule: RecurrenceRule | null, due: string | null = '2026-10-05') => ({ id: 'h1', recurrenceParentId: 's1', dueDate: due ? day(due) : null, recurrenceRule: rule });

describe('projectOccurrences — the copies a series will make, without creating them', () => {
  const range = { from: '2026-10-01', to: '2026-11-15', today: '2026-10-10' };

  it('lists the coming dates in the range, from the first that is not already past', () => {
    // Weekly on Mondays; the open copy is due Mon 5 Oct (overdue), so the next one is 12 Oct.
    expect(projectOccurrences(head({ freq: 'WEEKLY', interval: 1, weekdays: [1] }), range, 1)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
  });

  it('stops at the series end date and at its number of occurrences (counting the copies already made)', () => {
    expect(projectOccurrences(head({ freq: 'WEEKLY', interval: 1, until: '2026-10-20' }), range, 1)).toEqual(['2026-10-12', '2026-10-19']);
    // 4 occurrences in all, 2 already made: 2 more.
    expect(projectOccurrences(head({ freq: 'WEEKLY', interval: 1, count: 4 }), range, 2)).toEqual(['2026-10-12', '2026-10-19']);
    expect(projectOccurrences(head({ freq: 'WEEKLY', interval: 1, count: 2 }), range, 2)).toEqual([]);
  });

  it('nothing for a paused, invalid or undated series, or a task that does not repeat', () => {
    expect(projectOccurrences(head({ freq: 'WEEKLY', interval: 1, paused: true }), range, 1)).toEqual([]);
    expect(projectOccurrences(head({ freq: 'WEEKLY', interval: 0 }), range, 1)).toEqual([]);
    expect(projectOccurrences(head({ freq: 'WEEKLY', interval: 1 }, null), range, 1)).toEqual([]);
    expect(projectOccurrences(head(null), range, 1)).toEqual([]);
  });

  it('keeps to the range (later months show their own dates)', () => {
    expect(projectOccurrences(head({ freq: 'DAILY', interval: 1 }), { from: '2026-12-30', to: '2027-01-02', today: '2026-10-10' }, 1)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('follows the date a moved occurrence replaced (“this occurrence only”)', () => {
    const moved = { ...head({ freq: 'WEEKLY', interval: 1, resumeFrom: '2026-10-05' }, '2026-10-14'), };
    expect(projectOccurrences(moved, range, 1).slice(0, 2)).toEqual(['2026-10-12', '2026-10-19']);
  });

  it('a series due in the future starts after its open copy', () => {
    expect(projectOccurrences(head({ freq: 'MONTHLY', interval: 1 }, '2026-10-20'), range, 1)).toEqual(['2026-11-20'].filter((d) => d <= range.to));
  });
});
