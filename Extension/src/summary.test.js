import { describe, it, expect } from 'vitest';
import { summarizeTasks, groupTasksByDue } from './summary.js';

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

  it('XP-03: a task due today is "due today" — not overdue — all day in the company time zone', () => {
    const due = '2026-09-30T00:00:00.000Z'; // entered as 30 Sep; 04:00 in Muscat
    const task = { columnCategory: 'TODO', dueDate: due };
    const morning = new Date('2026-09-30T05:00:00Z').getTime(); // 09:00 Muscat
    const lateEvening = new Date('2026-09-30T19:30:00Z').getTime(); // 23:30 Muscat
    const nextDay = new Date('2026-09-30T20:30:00Z').getTime(); // 00:30 on 1 Oct in Muscat
    expect(summarizeTasks([task], morning, 'Asia/Muscat')).toMatchObject({ dueToday: 1, overdue: 0 });
    expect(summarizeTasks([task], lateEvening, 'Asia/Muscat')).toMatchObject({ dueToday: 1, overdue: 0 });
    expect(summarizeTasks([task], nextDay, 'Asia/Muscat')).toMatchObject({ dueToday: 0, overdue: 1 });
  });

  it('XP-03: a completed task is never overdue', () => {
    const g = groupTasksByDue([{ columnCategory: 'DONE', dueDate: '2026-01-01T00:00:00.000Z', completedAt: '2026-02-01T00:00:00Z' }], { timeZone: 'Asia/Muscat', now });
    expect(g.overdue).toHaveLength(0);
    expect(g.completed).toHaveLength(1);
  });

  it('"completed today" uses the company-zone day', () => {
    const lateUtc = new Date('2026-09-30T21:00:00Z').getTime(); // 01:00 on 1 Oct in Muscat
    const done = { columnCategory: 'DONE', completedAt: '2026-09-30T19:00:00Z' }; // 23:00 on 30 Sep in Muscat
    expect(summarizeTasks([done], lateUtc, 'Asia/Muscat').completedToday).toBe(0);
  });

  it('groupTasksByDue buckets and sorts', () => {
    const tasks = [
      { key: 'up2', columnCategory: 'TODO', dueDate: iso(now + 5 * day) },
      { key: 'none', columnCategory: 'TODO', dueDate: null },
      { key: 'up1', columnCategory: 'TODO', dueDate: iso(now + 2 * day) },
      { key: 'late', columnCategory: 'TODO', dueDate: iso(now - 3 * day) },
    ];
    const g = groupTasksByDue(tasks, { timeZone: 'Asia/Muscat', now });
    expect(g.upcoming.map((t) => t.key)).toEqual(['up1', 'up2']);
    expect(g.noDue.map((t) => t.key)).toEqual(['none']);
    expect(g.overdue.map((t) => t.key)).toEqual(['late']);
  });

  it('returns up to 5 upcoming tasks sorted by due date', () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({ columnCategory: 'TODO', progress: 0, dueDate: iso(now + (i + 2) * day), key: `T-${i}` }));
    const s = summarizeTasks(tasks, now);
    expect(s.upcoming).toHaveLength(5);
    expect(s.upcoming[0].key).toBe('T-0');
  });
});
