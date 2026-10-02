import { describe, it, expect } from 'vitest';
import {
  EXPORT_REPORTS, csvAllowed, reportQuery, reportExportPath, reportFileName, periodRange, periodDays, summarize,
  taskExportPath, taskFileName, fileSlug, fileNameFromDisposition, statusBars, trendStats,
} from './reports.js';

describe('report exports', () => {
  it('lists the same reports as the web portal, the full report first', () => {
    expect(EXPORT_REPORTS.map((r) => r.kind)).toEqual(['export', 'projects', 'status', 'workload', 'timeseries']);
    expect(EXPORT_REPORTS[0]).toMatchObject({ label: 'Full report (all sections)', file: 'tasks-report' });
  });

  it('every export carries the project / team-member filters; the full report and trend also the period', () => {
    const f = { projectId: 'p1', userId: 'u 2', from: '2026-09-01', to: '2026-09-30' };
    expect(reportQuery('status', f)).toBe('?projectId=p1&userId=u%202');
    expect(reportQuery('export', f)).toBe('?projectId=p1&userId=u%202&from=2026-09-01&to=2026-09-30');
    expect(reportQuery('timeseries', { from: '2026-09-01', to: '2026-09-30' })).toBe('?from=2026-09-01&to=2026-09-30');
    expect(reportQuery('projects', {})).toBe('');
    expect(reportExportPath('export', 'pdf', f)).toBe('/reports/export.pdf?projectId=p1&userId=u%202&from=2026-09-01&to=2026-09-30');
    expect(reportExportPath('workload', 'xlsx', {})).toBe('/reports/workload.xlsx');
  });

  it('CSV is for single tables, not the full report', () => {
    expect(csvAllowed('export')).toBe(false);
    expect(csvAllowed('projects')).toBe(true);
  });

  it('names files like the server does: report + today', () => {
    expect(reportFileName('export', 'xlsx', '2026-10-01')).toBe('tasks-report-2026-10-01.xlsx');
    expect(reportFileName('timeseries', 'pdf', '2026-10-01')).toBe('completion-trend-2026-10-01.pdf');
  });

  it('prefers the file name the server sends', () => {
    expect(fileNameFromDisposition('attachment; filename="tasks-report-ops-2026-10-01.pdf"')).toBe('tasks-report-ops-2026-10-01.pdf');
    expect(fileNameFromDisposition('attachment')).toBeNull();
    expect(fileNameFromDisposition(null)).toBeNull();
    expect(fileNameFromDisposition('attachment; filename="../../evil.pdf"')).toBe('evil.pdf');
  });
});

describe('report period', () => {
  it('a preset ends today and spans that many days', () => {
    expect(periodRange(30, '2026-10-01')).toEqual({ from: '2026-09-02', to: '2026-10-01' });
    expect(periodRange(7, '2026-10-01')).toEqual({ from: '2026-09-25', to: '2026-10-01' });
    expect(periodDays({ from: '2026-09-02', to: '2026-10-01' })).toBe(30);
  });
});

describe('report summary', () => {
  const rows = [
    { projectId: 'p1', projectName: 'Ops', total: 10, completed: 4, overdue: 2, completionPct: 40 },
    { projectId: 'p2', projectName: 'Rig', total: 5, completed: 5, overdue: 0, completionPct: 100 },
  ];

  it('totals the project rows (narrowed to the selected project)', () => {
    expect(summarize(rows, {})).toEqual({ projects: 2, total: 15, completed: 9, overdue: 2, pending: 6, completionPct: 60, overduePct: 13 });
    expect(summarize(rows, { projectId: 'p2' })).toMatchObject({ projects: 1, total: 5, completionPct: 100 });
    expect(summarize([], {})).toMatchObject({ total: 0, completionPct: 0, overduePct: 0 });
  });

  it('orders the status bars like the board and labels them', () => {
    expect(statusBars({ DONE: 3, TODO: 5, BLOCKED: 0 })).toEqual([
      { category: 'TODO', label: 'To do', value: 5, pct: 63 },
      { category: 'BLOCKED', label: 'Blocked', value: 0, pct: 0 },
      { category: 'DONE', label: 'Done', value: 3, pct: 38 },
    ]);
  });

  it('sums the trend window', () => {
    const series = {
      velocityPerWeek: 2.5,
      points: [
        { date: '2026-09-29', created: 2, completed: 1, overdue: 3, remaining: 9, ideal: 9 },
        { date: '2026-09-30', created: 1, completed: 4, overdue: 1, remaining: 6, ideal: 4 },
      ],
    };
    expect(trendStats(series)).toEqual({ completed: 5, created: 3, overdueNow: 1, velocityPerWeek: 2.5 });
    expect(trendStats(null)).toEqual({ completed: 0, created: 0, overdueNow: 0, velocityPerWeek: 0 });
  });
});

describe('task export', () => {
  it('downloads one task as .xlsx or .pdf, named after its key and title', () => {
    expect(taskExportPath('t 1', 'pdf')).toBe('/tasks/t%201/export.pdf');
    expect(taskFileName({ key: 'OPS-12', title: 'Inspect the Rig — phase 2!' }, 'xlsx')).toBe('OPS-12-inspect-the-rig-phase-2.xlsx');
    expect(fileSlug('   ')).toBe('export');
  });
});
