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

const NOW = new Date('2026-09-08T12:00:00');

describe('summarizeTasks', () => {
  it('buckets open tasks into overdue / due-today / upcoming by calendar day', () => {
    const tasks = [
      t('past', '2026-09-05T09:00:00'),
      t('today', '2026-09-08T18:00:00'),
      t('soon', '2026-09-10T09:00:00'),
      t('later', '2026-09-20T09:00:00'),
      t('none', null),
    ];
    const s = summarizeTasks(tasks, NOW);
    expect(s.overdue.map((x) => x.id)).toEqual(['past']);
    expect(s.dueToday.map((x) => x.id)).toEqual(['today']);
    expect(s.upcoming.map((x) => x.id)).toEqual(['soon', 'later']); // ascending
  });

  it('excludes completed tasks from the open buckets and counts them', () => {
    const tasks = [
      t('done', '2026-09-05T09:00:00', '2026-09-06T09:00:00'),
      t('open', '2026-09-05T09:00:00'),
    ];
    const s = summarizeTasks(tasks, NOW);
    expect(s.total).toBe(2);
    expect(s.completed).toBe(1);
    expect(s.overdue.map((x) => x.id)).toEqual(['open']); // done is not overdue
  });

  it('sorts overdue oldest-first', () => {
    const s = summarizeTasks([t('b', '2026-09-06T09:00:00'), t('a', '2026-09-01T09:00:00')], NOW);
    expect(s.overdue.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
