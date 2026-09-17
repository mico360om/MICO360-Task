import { describe, it, expect } from 'vitest';
import { statusBreakdown, projectPerformance, userWorkload, completionStats, createReportService, type ReportTask } from './report-service';

const tasks: ReportTask[] = [
  { id: '1', projectId: 'p1', projectName: 'MICO', columnCategory: 'DONE', createdAt: new Date('2000-01-01'), dueDate: new Date('2000-01-01'), completedAt: new Date('2000-01-02'), assigneeIds: ['u1'] },
  { id: '2', projectId: 'p1', projectName: 'MICO', columnCategory: 'IN_PROGRESS', createdAt: new Date('2000-01-01'), dueDate: new Date('2000-01-01'), completedAt: null, assigneeIds: ['u1', 'u2'] },
  { id: '3', projectId: 'p2', projectName: 'RIG', columnCategory: 'TODO', createdAt: new Date('2000-01-01'), dueDate: new Date('2999-01-01'), completedAt: null, assigneeIds: ['u2'] },
];

describe('statusBreakdown', () => {
  it('counts tasks per column category', () => {
    expect(statusBreakdown(tasks)).toEqual({ DONE: 1, IN_PROGRESS: 1, TODO: 1 });
  });
});

describe('projectPerformance', () => {
  it('computes totals, overdue and completion % per project', () => {
    const perf = projectPerformance(tasks);
    const mico = perf.find((p) => p.projectId === 'p1')!;
    expect(mico.total).toBe(2);
    expect(mico.completed).toBe(1);
    expect(mico.overdue).toBe(1); // task 2: past due & not done
    expect(mico.completionPct).toBe(50);
  });

  it('treats a task completed outside the DONE column as done, not overdue', () => {
    // A task moved out of DONE via PUT can keep completedAt set while in a non-DONE column.
    // Reports must count it as completed and never overdue — matching My Tasks / task-filter.
    const t: ReportTask[] = [
      { id: '9', projectId: 'p9', projectName: 'X', columnCategory: 'IN_PROGRESS', createdAt: new Date('2000-01-01'), dueDate: new Date('2000-01-01'), completedAt: new Date('2000-02-01'), assigneeIds: [] },
    ];
    const perf = projectPerformance(t)[0]!;
    expect(perf.completed).toBe(1);
    expect(perf.overdue).toBe(0);
    expect(perf.completionPct).toBe(100);
  });
});

describe('userWorkload', () => {
  it('counts assigned/completed/overdue per user', () => {
    const wl = userWorkload(tasks, [{ id: 'u1', username: 'ada' }, { id: 'u2', username: 'omar' }]);
    const ada = wl.find((w) => w.userId === 'u1')!;
    expect(ada.assigned).toBe(2);
    expect(ada.completed).toBe(1);
    expect(ada.overdue).toBe(1);
    const omar = wl.find((w) => w.userId === 'u2')!;
    expect(omar.assigned).toBe(2);
    expect(omar.overdue).toBe(1);
  });
});

describe('completionStats', () => {
  it('splits completed tasks into on-time vs late by completedAt vs dueDate', () => {
    const t: ReportTask[] = [
      { id: 'a', projectId: 'p', projectName: 'X', columnCategory: 'DONE', createdAt: new Date('2000-01-01'), dueDate: new Date('2000-01-10'), completedAt: new Date('2000-01-05'), assigneeIds: [] }, // on time
      { id: 'b', projectId: 'p', projectName: 'X', columnCategory: 'DONE', createdAt: new Date('2000-01-01'), dueDate: new Date('2000-01-10'), completedAt: new Date('2000-01-20'), assigneeIds: [] }, // late
      { id: 'c', projectId: 'p', projectName: 'X', columnCategory: 'DONE', createdAt: new Date('2000-01-01'), dueDate: null, completedAt: new Date('2000-01-05'), assigneeIds: [] }, // unclassified (no due date)
      { id: 'd', projectId: 'p', projectName: 'X', columnCategory: 'TODO', createdAt: new Date('2000-01-01'), dueDate: new Date('2999-01-01'), completedAt: null, assigneeIds: [] }, // not done
    ];
    const s = completionStats(t);
    expect(s.total).toBe(4);
    expect(s.completed).toBe(3);
    expect(s.onTime).toBe(1);
    expect(s.late).toBe(1);
    expect(s.unclassified).toBe(1);
    expect(s.onTimeRate).toBe(50); // 1 of 2 classifiable
  });
});

describe('ReportService', () => {
  it('produces reports from the data source', async () => {
    const svc = createReportService({
      data: { async getTasks() { return tasks; }, async getUsers() { return [{ id: 'u1', username: 'ada' }]; } },
    });
    expect(await svc.projectPerformanceReport()).toHaveLength(2);
    expect((await svc.taskStatusReport()).DONE).toBe(1);
    expect(await svc.workloadReport()).toHaveLength(1);
    expect((await svc.completionReport()).completed).toBe(1);
  });
});
