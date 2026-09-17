import { describe, it, expect } from 'vitest';
import { enumerateDays, buildTimeSeries } from './report-timeseries';
import type { ReportTask } from './report-service';

const d = (iso: string) => new Date(iso);

// A: created d1, completed d3, due far future.
// B: created d1, never completed, due d2 (goes overdue from d2).
// C: created d4, never completed, no due date.
const tasks: ReportTask[] = [
  { id: 'A', projectId: 'p1', projectName: 'MICO', columnCategory: 'DONE', createdAt: d('2000-01-01T09:00:00Z'), dueDate: d('2000-01-10T00:00:00Z'), completedAt: d('2000-01-03T10:00:00Z'), assigneeIds: [] },
  { id: 'B', projectId: 'p1', projectName: 'MICO', columnCategory: 'TODO', createdAt: d('2000-01-01T09:00:00Z'), dueDate: d('2000-01-02T00:00:00Z'), completedAt: null, assigneeIds: [] },
  { id: 'C', projectId: 'p2', projectName: 'RIG', columnCategory: 'TODO', createdAt: d('2000-01-04T09:00:00Z'), dueDate: null, completedAt: null, assigneeIds: [] },
];

describe('enumerateDays', () => {
  it('lists each inclusive UTC day in the range', () => {
    expect(enumerateDays('2000-01-01', '2000-01-05')).toEqual(['2000-01-01', '2000-01-02', '2000-01-03', '2000-01-04', '2000-01-05']);
  });
  it('returns a single day when from === to', () => {
    expect(enumerateDays('2000-01-01', '2000-01-01')).toEqual(['2000-01-01']);
  });
});

describe('buildTimeSeries', () => {
  const result = buildTimeSeries(tasks, '2000-01-01', '2000-01-05');

  it('emits one point per day with created/completed/overdue/remaining', () => {
    expect(result.points.map((p) => p.date)).toEqual(['2000-01-01', '2000-01-02', '2000-01-03', '2000-01-04', '2000-01-05']);
    expect(result.points.map((p) => p.created)).toEqual([2, 0, 0, 1, 0]);
    expect(result.points.map((p) => p.completed)).toEqual([0, 0, 1, 0, 0]);
    expect(result.points.map((p) => p.overdue)).toEqual([0, 1, 1, 1, 1]);
    expect(result.points.map((p) => p.remaining)).toEqual([2, 2, 1, 2, 2]);
  });

  it('adds a linear ideal burndown line from the starting open count to zero', () => {
    expect(result.points.map((p) => p.ideal)).toEqual([2, 2, 1, 1, 0]);
  });

  it('reports weekly velocity (completed throughput) and the average per week', () => {
    expect(result.velocity).toEqual([{ weekStart: '2000-01-01', completed: 1 }]);
    expect(result.velocityPerWeek).toBe(1);
  });

  it('echoes the requested range', () => {
    expect(result.from).toBe('2000-01-01');
    expect(result.to).toBe('2000-01-05');
  });

  it('scopes cleanly to a single project when tasks are pre-filtered', () => {
    const p2 = buildTimeSeries(tasks.filter((t) => t.projectId === 'p2'), '2000-01-03', '2000-01-05');
    expect(p2.points.map((p) => p.created)).toEqual([0, 1, 0]);
    expect(p2.points.map((p) => p.remaining)).toEqual([0, 1, 1]);
    expect(p2.points.every((p) => p.overdue === 0)).toBe(true); // C has no due date
  });
});
