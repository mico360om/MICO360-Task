import { describe, it, expect } from 'vitest';
import { deadlines, milestones, projectTimeline, taskPhase, taskStats, workload } from './project-dashboard';
import type { ApiTask } from '../api/tasks';

const TODAY = '2026-10-16';

function task(over: Partial<ApiTask>): ApiTask {
  return {
    id: 't', key: 'P-1', title: 'Task', description: null, projectId: 'p1', columnId: 'todo', columnCategory: 'TODO', position: 0,
    priority: 'NORMAL', startDate: null, dueDate: null, progress: 0, completedAt: null, createdAt: '', updatedAt: '', ...over,
  };
}
const day = (key: string) => `${key}T00:00:00.000Z`;

describe('project dashboard: tasks', () => {
  it('sorts tasks into completed, overdue, ongoing and pending', () => {
    expect(taskPhase(task({ columnCategory: 'DONE', dueDate: day('2026-10-01') }), TODAY)).toBe('completed');
    expect(taskPhase(task({ completedAt: '2026-10-02T00:00:00Z' }), TODAY)).toBe('completed');
    expect(taskPhase(task({ columnCategory: 'IN_PROGRESS', dueDate: day('2026-10-15') }), TODAY)).toBe('overdue');
    expect(taskPhase(task({ columnCategory: 'REVIEW' }), TODAY)).toBe('ongoing');
    expect(taskPhase(task({ columnCategory: 'BLOCKED', dueDate: day(TODAY) }), TODAY)).toBe('ongoing');
    expect(taskPhase(task({ columnCategory: 'BACKLOG' }), TODAY)).toBe('pending');
  });

  it('counts each phase and works out progress from finished work', () => {
    const s = taskStats([
      task({ id: 'a', columnCategory: 'DONE', progress: 100, priority: 'HIGH' }),
      task({ id: 'b', columnCategory: 'IN_PROGRESS', progress: 50, priority: 'URGENT' }),
      task({ id: 'c', dueDate: day('2026-10-01'), priority: 'HIGH' }),
      task({ id: 'd' }),
    ], TODAY);
    expect(s).toMatchObject({ total: 4, completed: 1, ongoing: 1, overdue: 1, pending: 1, pct: 25, avgProgress: 38 });
    expect(s.byPriority).toEqual({ URGENT: 1, HIGH: 1, NORMAL: 1, LOW: 0 }); // open tasks only
  });

  it('reads a due date given as a time on its company-time day', () => {
    // 20:00 UTC on the 16th is the 17th in Muscat: due today on the 17th, not overdue.
    const t = task({ dueDate: '2026-10-16T20:00:00.000Z' });
    expect(taskPhase(t, '2026-10-17', 'Asia/Muscat')).toBe('pending');
    expect(deadlines([t], '2026-10-17', 14, 'Asia/Muscat')[0]).toMatchObject({ due: '2026-10-17', daysLeft: 0 });
  });

  it('is zero, not NaN, for a project without tasks', () => {
    expect(taskStats([], TODAY)).toMatchObject({ total: 0, pct: 0, avgProgress: 0 });
  });
});

describe('project dashboard: milestones and deadlines', () => {
  it('lists milestones by date with where each stands', () => {
    const list = milestones([
      task({ id: 'late', title: 'Design sign-off', isMilestone: true, dueDate: day('2026-10-10') }),
      task({ id: 'next', title: 'Go-live', isMilestone: true, dueDate: day('2026-11-01') }),
      task({ id: 'done', title: 'Kick-off', isMilestone: true, columnCategory: 'DONE', dueDate: day('2026-09-01') }),
      task({ id: 'open', title: 'Handover', isMilestone: true }),
      task({ id: 'plain', title: 'Not a milestone', dueDate: day('2026-10-20') }),
    ], TODAY);
    expect(list.map((m) => [m.task.id, m.state, m.daysLeft])).toEqual([
      ['done', 'done', null],
      ['late', 'overdue', -6],
      ['next', 'upcoming', 16],
      ['open', 'undated', null],
    ]);
  });

  it('lists the open tasks due soonest, overdue first', () => {
    const list = deadlines([
      task({ id: 'far', dueDate: day('2026-12-01') }),
      task({ id: 'soon', dueDate: day('2026-10-18') }),
      task({ id: 'late', dueDate: day('2026-10-12') }),
      task({ id: 'done', columnCategory: 'DONE', dueDate: day('2026-10-17') }),
      task({ id: 'none' }),
    ], TODAY, 14);
    expect(list.map((d) => [d.task.id, d.daysLeft])).toEqual([['late', -4], ['soon', 2]]);
  });
});

describe('project dashboard: timeline and workload', () => {
  it('shows how far through its dates the project is', () => {
    expect(projectTimeline('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z', TODAY)).toEqual({ start: '2026-10-01', end: '2026-10-31', elapsedPct: 50, daysLeft: 15, state: 'running' });
    expect(projectTimeline('2026-09-01T00:00:00Z', '2026-10-10T00:00:00Z', TODAY)).toMatchObject({ elapsedPct: 100, daysLeft: -6, state: 'late' });
    expect(projectTimeline('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', TODAY)).toMatchObject({ elapsedPct: 0, state: 'not-started' });
    expect(projectTimeline(null, null, TODAY)).toBeNull();
  });

  it('counts each person’s open and overdue tasks, busiest first', () => {
    const people = workload([
      task({ id: 'a', assignees: [{ id: 'u1', name: 'Aisha' }, { id: 'u2', name: 'Omar' }] }),
      task({ id: 'b', assignees: [{ id: 'u2', name: 'Omar' }], dueDate: day('2026-10-01') }),
      task({ id: 'c', assignees: [{ id: 'u2', name: 'Omar' }], columnCategory: 'DONE' }),
    ], TODAY);
    expect(people).toEqual([
      { id: 'u2', name: 'Omar', open: 2, overdue: 1, completed: 1 },
      { id: 'u1', name: 'Aisha', open: 1, overdue: 0, completed: 0 },
    ]);
  });
});
