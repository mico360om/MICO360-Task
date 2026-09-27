import { describe, it, expect } from 'vitest';
import { summarizeTasks } from './tasks-summary';
import type { ApiTask } from './types';

const base: Omit<ApiTask, 'id' | 'dueDate' | 'completedAt'> = {
  key: 'T-1',
  title: 'task',
  description: null,
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  estimatedHours: null,
  progress: 0,
};

const t = (id: string, dueDate: string | null, completedAt: string | null = null): ApiTask => ({
  ...base,
  id,
  key: `T-${id}`,
  dueDate,
  completedAt,
});

// 12:00 in Muscat on Sep 8. Due dates are stored as UTC midnight of their calendar day.
const NOW = new Date('2026-09-08T08:00:00Z');

describe('summarizeTasks', () => {
  it('buckets open tasks into overdue / due-today / upcoming by calendar day', () => {
    const tasks = [
      t('past', '2026-09-05T00:00:00.000Z'),
      t('today', '2026-09-08T00:00:00.000Z'),
      t('soon', '2026-09-10T00:00:00.000Z'),
      t('later', '2026-09-20T00:00:00.000Z'),
      t('none', null),
    ];
    const s = summarizeTasks(tasks, NOW);
    expect(s.overdue.map((x) => x.id)).toEqual(['past']);
    expect(s.dueToday.map((x) => x.id)).toEqual(['today']);
    expect(s.upcoming.map((x) => x.id)).toEqual(['soon', 'later']); // ascending
  });

  it('excludes completed tasks from the open buckets and counts them', () => {
    const tasks = [
      t('done', '2026-09-05T00:00:00.000Z', '2026-09-06T00:00:00.000Z'),
      t('open', '2026-09-05T00:00:00.000Z'),
    ];
    const s = summarizeTasks(tasks, NOW);
    expect(s.total).toBe(2);
    expect(s.completed).toBe(1);
    expect(s.overdue.map((x) => x.id)).toEqual(['open']); // done is not overdue
  });

  it('sorts overdue oldest-first', () => {
    const s = summarizeTasks([t('b', '2026-09-06T00:00:00.000Z'), t('a', '2026-09-01T00:00:00.000Z')], NOW);
    expect(s.overdue.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps a task due today in "Due today" all day in Muscat, then overdue the next day (XP-03)', () => {
    const task = t('d', '2026-09-30T00:00:00.000Z');
    expect(summarizeTasks([task], new Date('2026-09-30T00:30:00Z')).dueToday.map((x) => x.id)).toEqual(['d']); // 04:30 Muscat
    expect(summarizeTasks([task], new Date('2026-09-30T19:30:00Z')).dueToday.map((x) => x.id)).toEqual(['d']); // 23:30 Muscat
    expect(summarizeTasks([task], new Date('2026-09-30T20:30:00Z')).overdue.map((x) => x.id)).toEqual(['d']); // 00:30 Oct 1
  });

  it('uses the company date for "today", not UTC (Muscat is already on the next day at 21:00 UTC)', () => {
    const s = summarizeTasks([t('x', '2026-09-09T00:00:00.000Z')], new Date('2026-09-08T21:00:00Z'));
    expect(s.dueToday.map((x) => x.id)).toEqual(['x']);
  });
});
