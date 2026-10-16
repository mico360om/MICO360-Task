import { describe, it, expect } from 'vitest';
import { daysLeftLabel, isTaskFinished, projectDeadlines, projectMilestones } from './project-dashboard';
import type { ApiTask } from './types';

const task = (id: string, patch: Partial<ApiTask> = {}): ApiTask => ({
  id,
  key: `P-${id}`,
  title: id,
  description: null,
  projectId: 'p1',
  columnId: 'c1',
  position: 0,
  priority: 'NORMAL',
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  progress: 0,
  completedAt: null,
  ...patch,
});

const TODAY = '2026-10-16';

describe('isTaskFinished', () => {
  it('is finished when completed or in a Done column', () => {
    expect(isTaskFinished(task('a', { completedAt: '2026-10-01T08:00:00Z' }))).toBe(true);
    expect(isTaskFinished(task('b', { columnCategory: 'DONE' }))).toBe(true);
    expect(isTaskFinished(task('c', { columnCategory: 'IN_PROGRESS' }))).toBe(false);
  });
});

describe('projectMilestones', () => {
  it('lists only milestones, by date with undated last, and says where each stands', () => {
    const list = projectMilestones(
      [
        task('plain', { dueDate: '2026-10-17T00:00:00.000Z' }),
        task('undated', { isMilestone: true }),
        task('late', { isMilestone: true, dueDate: '2026-10-10T00:00:00.000Z' }),
        task('done', { isMilestone: true, dueDate: '2026-10-01T00:00:00.000Z', columnCategory: 'DONE' }),
        task('soon', { isMilestone: true, dueDate: '2026-10-20T00:00:00.000Z' }),
      ],
      TODAY,
    );
    expect(list.map((m) => [m.task.id, m.state, m.daysLeft])).toEqual([
      ['done', 'done', null],
      ['late', 'overdue', -6],
      ['soon', 'upcoming', 4],
      ['undated', 'undated', null],
    ]);
  });

  it('keeps a due date on its own calendar day', () => {
    const [m] = projectMilestones([task('a', { isMilestone: true, dueDate: '2026-10-16T00:00:00.000Z' })], TODAY);
    expect(m!.due).toBe('2026-10-16');
    expect(m!.state).toBe('upcoming');
    expect(m!.daysLeft).toBe(0);
  });
});

describe('projectDeadlines', () => {
  it('lists open tasks due within two weeks and every overdue one, soonest first', () => {
    const list = projectDeadlines(
      [
        task('far', { dueDate: '2026-11-30T00:00:00.000Z' }),
        task('done', { dueDate: '2026-10-17T00:00:00.000Z', completedAt: '2026-10-15T09:00:00Z' }),
        task('week', { dueDate: '2026-10-23T00:00:00.000Z' }),
        task('overdue', { dueDate: '2026-09-01T00:00:00.000Z' }),
        task('today', { dueDate: '2026-10-16T00:00:00.000Z' }),
        task('none'),
      ],
      TODAY,
    );
    expect(list.map((d) => [d.task.id, d.daysLeft])).toEqual([
      ['overdue', -45],
      ['today', 0],
      ['week', 7],
    ]);
  });

  it('can look further ahead', () => {
    const list = projectDeadlines([task('far', { dueDate: '2026-11-30T00:00:00.000Z' })], TODAY, 60);
    expect(list.map((d) => d.task.id)).toEqual(['far']);
  });
});

describe('daysLeftLabel', () => {
  it('says how far away a day is in words', () => {
    expect(daysLeftLabel(0)).toBe('Today');
    expect(daysLeftLabel(1)).toBe('Tomorrow');
    expect(daysLeftLabel(5)).toBe('In 5 days');
    expect(daysLeftLabel(-1)).toBe('1 day late');
    expect(daysLeftLabel(-3)).toBe('3 days late');
  });
});
