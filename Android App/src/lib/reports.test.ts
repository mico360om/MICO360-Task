import { describe, it, expect } from 'vitest';
import {
  EXPORT_REPORTS, csvAllowed, reportQuery, reportExportPath, reportFileName, periodRange, periodDays, summarize, statusBars,
  trendStats, taskExportPath, taskFileName, fileSlug, fileNameFromDisposition, mimeTypeFor,
} from './reports';

describe('report exports', () => {
  it('offers the same reports as the web portal, the full report first', () => {
    expect(EXPORT_REPORTS.map((r) => r.kind)).toEqual(['export', 'projects', 'status', 'workload', 'timeseries']);
    expect(EXPORT_REPORTS[0]).toMatchObject({ label: 'Full report', file: 'tasks-report' });
  });

  it('every export carries the project / team-member filters; the full report and trend also the period', () => {
    const f = { projectId: 'p1', userId: 'u 2', from: '2026-09-01', to: '2026-09-30' };
    expect(reportQuery('status', f)).toBe('?projectId=p1&userId=u%202');
    expect(reportQuery('export', f)).toBe('?projectId=p1&userId=u%202&from=2026-09-01&to=2026-09-30');
    expect(reportQuery('projects', {})).toBe('');
    expect(reportExportPath('export', 'pdf', f)).toBe('/reports/export.pdf?projectId=p1&userId=u%202&from=2026-09-01&to=2026-09-30');
    expect(reportExportPath('workload', 'xlsx', {})).toBe('/reports/workload.xlsx');
  });

  it('CSV is for single tables, not the full report', () => {
    expect(csvAllowed('export')).toBe(false);
    expect(csvAllowed('workload')).toBe(true);
  });

  it('names files like the server does, and prefers the name the server sends', () => {
    expect(reportFileName('export', 'xlsx', '2026-10-01')).toBe('tasks-report-2026-10-01.xlsx');
    expect(fileNameFromDisposition('attachment; filename="tasks-report-ops-2026-10-01.pdf"')).toBe('tasks-report-ops-2026-10-01.pdf');
    expect(fileNameFromDisposition('attachment; filename="../../evil.pdf"')).toBe('evil.pdf');
    expect(fileNameFromDisposition(undefined)).toBeNull();
  });

  it('knows the file types the share sheet needs', () => {
    expect(mimeTypeFor('a.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(mimeTypeFor('a.pdf')).toBe('application/pdf');
    expect(mimeTypeFor('a.csv')).toBe('text/csv');
    expect(mimeTypeFor('a.bin')).toBe('application/octet-stream');
  });
});

describe('report period and summary', () => {
  it('a preset ends today and spans that many days', () => {
    expect(periodRange(30, '2026-10-01')).toEqual({ from: '2026-09-02', to: '2026-10-01' });
    expect(periodDays({ from: '2026-09-25', to: '2026-10-01' })).toBe(7);
  });

  it('totals the project rows, narrowed to the selected project', () => {
    const rows = [
      { projectId: 'p1', projectName: 'Ops', total: 10, completed: 4, overdue: 2, completionPct: 40 },
      { projectId: 'p2', projectName: 'Rig', total: 5, completed: 5, overdue: 0, completionPct: 100 },
    ];
    expect(summarize(rows, {})).toEqual({ projects: 2, total: 15, completed: 9, overdue: 2, pending: 6, completionPct: 60, overduePct: 13 });
    expect(summarize(rows, { projectId: 'p2' })).toMatchObject({ projects: 1, total: 5, completionPct: 100 });
  });

  it('orders status bars like the board and sums the period', () => {
    expect(statusBars({ DONE: 3, TODO: 5 }).map((b) => [b.label, b.value, b.pct])).toEqual([['To do', 5, 63], ['Done', 3, 38]]);
    expect(trendStats({ velocityPerWeek: 2, points: [{ date: 'a', created: 2, completed: 1, overdue: 3, remaining: 0, ideal: 0 }, { date: 'b', created: 1, completed: 4, overdue: 1, remaining: 0, ideal: 0 }] }))
      .toEqual({ completed: 5, created: 3, overdueNow: 1, velocityPerWeek: 2 });
    expect(trendStats(undefined)).toEqual({ completed: 0, created: 0, overdueNow: 0, velocityPerWeek: 0 });
  });
});

describe('task export', () => {
  it('downloads one task, named after its key and title', () => {
    expect(taskExportPath('t 1', 'pdf')).toBe('/tasks/t%201/export.pdf');
    expect(taskFileName({ key: 'OPS-12', title: 'Inspect the Rig: phase 2!' }, 'xlsx')).toBe('OPS-12-inspect-the-rig-phase-2.xlsx');
    expect(fileSlug('مهمة')).toBe('export');
  });
});
