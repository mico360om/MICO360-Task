import { describe, it, expect } from 'vitest';
import { summarizeTasks } from './summary.js';

const now = new Date('2026-06-15T12:00:00Z').getTime();
const day = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

describe('summarizeTasks', () => {
  it('classifies tasks into today / overdue / in-progress / completed-today', () => {
    const tasks = [
      { columnCategory: 'TODO', progress: 0, dueDate: iso(now) }, // due today
      { columnCategory: 'TODO', progress: 0, dueDate: iso(now - 2 * day) }, // overdue
      { columnCategory: 'IN_PROGRESS', progress: 50, dueDate: iso(now + 3 * day) }, // in progress + upcoming
      { columnCategory: 'DONE', progress: 100, completedAt: iso(now) }, // completed today
    ];
    const s = summarizeTasks(tasks, now);
    expect(s.dueToday).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.completedToday).toBe(1);
  });

  it('treats a task with completedAt as done even outside the DONE column (matches the backend)', () => {
    const tasks = [
      { columnCategory: 'IN_PROGRESS', progress: 40, completedAt: iso(now), dueDate: iso(now - 2 * day) },
    ];
    const s = summarizeTasks(tasks, now);
    expect(s.completedToday).toBe(1);
    expect(s.overdue).toBe(0); // completed → not overdue
    expect(s.inProgress).toBe(0); // completed → not counted in-progress
  });

  it('returns up to 5 upcoming tasks sorted by due date', () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({ columnCategory: 'TODO', progress: 0, dueDate: iso(now + (i + 2) * day), key: `T-${i}` }));
    const s = summarizeTasks(tasks, now);
    expect(s.upcoming).toHaveLength(5);
    expect(s.upcoming[0].key).toBe('T-0');
  });
});
