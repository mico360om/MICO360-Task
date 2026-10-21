import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXPORT_REPORTS, csvAllowed, reportQuery, reportExportPath, reportFileName, periodRange, periodDays, summarize, statusBars,
  trendStats, taskExportPath, taskFileName, fileSlug, fileNameFromDisposition, mimeTypeFor,
  MAX_TREND_DAYS, TREND_CHARTS, activePreset, isBackwards, isWholeDate, longRangeNote, onTimeText, rangeProblem, readRange,
  reportDay, trendCharts, workloadBars,
} from './reports';

describe('report exports', () => {
  it('offers the same reports as the web portal, the full report first, in its words', () => {
    expect(EXPORT_REPORTS.map((r) => r.kind)).toEqual(['export', 'projects', 'status', 'workload', 'timeseries']);
    expect(EXPORT_REPORTS.map((r) => r.label)).toEqual(['Full report (all sections)', 'Project performance', 'Task status', 'Employee workload', 'Completion trend']);
    expect(EXPORT_REPORTS[0]).toMatchObject({ file: 'tasks-report' });
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
    expect(mimeTypeFor('mico360-my-data-2026-10-21.json')).toBe('application/json');
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

describe('a range of your own (5c)', () => {
  const TODAY = '2026-10-21';
  it('takes whole dates only, as the website’s date boxes (a year from 2000)', () => {
    expect(isWholeDate('2026-10-01')).toBe(true);
    expect(isWholeDate('2026-10-1')).toBe(false);
    expect(isWholeDate('0202-10-01')).toBe(false);
    expect(isWholeDate('')).toBe(false);
    expect(isBackwards('2026-10-05', '2026-10-01')).toBe(true);
    expect(isBackwards('2026-10-01', '2026-10-01')).toBe(false);
    expect(isBackwards('2026-10-0', '2026-10-01')).toBe(false);
  });

  it('shows the range once both dates are whole, real, in order and not after today', () => {
    expect(readRange('2026-09-01', '2026-09-30', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(readRange(' 2026-09-01 ', '2026-10-21', TODAY)).toEqual({ from: '2026-09-01', to: '2026-10-21' });
    expect(readRange('2026-09-0', '2026-09-30', TODAY)).toBeNull();
    expect(readRange('2026-02-30', '2026-03-05', TODAY)).toBeNull();
    expect(readRange('2026-10-05', '2026-10-01', TODAY)).toBeNull();
    expect(readRange('2026-10-01', '2026-10-22', TODAY)).toBeNull();
  });

  it('says what is wrong only once a date is typed out, and what is still shown', () => {
    const shown = { from: '2026-09-22', to: '2026-10-21' };
    // Still typing: nothing to say yet.
    expect(rangeProblem('2026-10-0', '2026-10-21', TODAY, shown)).toBeNull();
    expect(rangeProblem('2026-09-01', '2026-09-30', TODAY, shown)).toBeNull();
    expect(rangeProblem('2026-10-05', '2026-10-01', TODAY, shown)).toBe('The start date must be on or before the end date. Still showing 22 Sep – 21 Oct.');
    expect(rangeProblem('2026-10-01', '2026-11-02', TODAY, shown)).toBe('The end date can’t be after today. Still showing 22 Sep – 21 Oct.');
    expect(rangeProblem('2026-02-30', '2026-03-05', TODAY, shown)).toBe('Enter a real date, as YYYY-MM-DD. Still showing 22 Sep – 21 Oct.');
    expect(rangeProblem('1999-12-31', '2026-03-05', TODAY, shown)).toBe('Enter a real date, as YYYY-MM-DD. Still showing 22 Sep – 21 Oct.');
    expect(rangeProblem('2026/10/01', '2026-10-05', TODAY, shown)).toBe('Enter a real date, as YYYY-MM-DD. Still showing 22 Sep – 21 Oct.');
  });

  it('marks a preset as chosen only when the range is that many days ending today', () => {
    expect(activePreset({ from: '2026-09-22', to: TODAY }, TODAY)).toBe(30);
    expect(activePreset({ from: '2026-10-15', to: TODAY }, TODAY)).toBe(7);
    expect(activePreset({ from: '2026-09-21', to: '2026-10-20' }, TODAY)).toBeNull();
    expect(activePreset({ from: '2026-10-01', to: TODAY }, TODAY)).toBeNull();
  });

  it('says when the trend shows only the last year of a longer range (the server’s limit)', () => {
    expect(MAX_TREND_DAYS).toBe(366);
    expect(longRangeNote({ from: '2025-10-21', to: TODAY })).toBeNull();
    expect(longRangeNote({ from: '2024-01-01', to: TODAY })).toBe('The trend shows the last 366 days of this range.');
  });

  it('names days short, as the screen did: “25 Sep”', () => {
    expect(reportDay('2026-09-25')).toBe('25 Sep');
    expect(reportDay('2026-01-05')).toBe('5 Jan');
  });
});

describe('the trend charts (5c), as the website’s', () => {
  const series = {
    from: '2026-10-01',
    to: '2026-10-03',
    velocityPerWeek: 3,
    points: [
      { date: '2026-10-01', created: 2, completed: 1, overdue: 0, remaining: 4, ideal: 4 },
      { date: '2026-10-02', created: 0, completed: 2, overdue: 1, remaining: 2, ideal: 2 },
      { date: '2026-10-03', created: 1, completed: 0, overdue: 2, remaining: 3, ideal: 0 },
    ],
    velocity: [{ weekStart: '2026-10-01', completed: 3 }],
  };

  it('has the four charts with the website’s titles and lines', () => {
    expect(TREND_CHARTS.map((c) => c.title)).toEqual(['Completion over time', 'Overdue trend', 'Burndown', 'Velocity']);
    const t = trendCharts(series);
    expect(t.labels).toEqual(['1 Oct', '2 Oct', '3 Oct']);
    expect(t.completion).toEqual([
      { name: 'Completed', values: [1, 3, 3], tone: 'done', area: true },
      { name: 'Created', values: [2, 2, 3], tone: 'muted' },
    ]);
    expect(t.overdue).toEqual([{ name: 'Overdue', values: [0, 1, 2], tone: 'danger', area: true }]);
    expect(t.burndown).toEqual([
      { name: 'Remaining', values: [4, 2, 3], tone: 'brand', area: true },
      { name: 'Ideal', values: [4, 2, 0], tone: 'muted', dashed: true },
    ]);
    expect(t.velocity).toEqual([{ label: 'Week of 1 Oct', value: 3 }]);
    expect(TREND_CHARTS[3]!.about(3)).toBe('Tasks completed per week (3/wk average).');
  });

  it('is empty without a trend (it failed to load, or a server without weekly velocity)', () => {
    expect(trendCharts(null)).toEqual({ labels: [], days: [], completion: [], overdue: [], burndown: [], velocity: [] });
    expect(trendCharts({ ...series, velocity: undefined }).velocity).toEqual([]);
  });

  it('says what the on-time bar means, and charts each team member’s assigned tasks, most first', () => {
    expect(onTimeText({ total: 9, completed: 8, onTime: 6, late: 2, unclassified: 1, onTimeRate: 75 })).toBe('75% of completed tasks with a due date were delivered on time.');
    const rows = [
      { userId: 'u1', username: 'omar', name: 'Omar Ahmed', assigned: 2, completed: 1, overdue: 0 },
      { userId: 'u2', username: 'aisha', assigned: 5, completed: 5, overdue: 1 },
    ];
    expect(workloadBars(rows, '')).toEqual([
      { label: 'aisha', value: 5 },
      { label: 'Omar Ahmed', value: 2 },
    ]);
    expect(workloadBars(rows, 'u1')).toEqual([{ label: 'Omar Ahmed', value: 2 }]);
  });
});

/**
 * The website's Reports page and date boxes (Web Portal/frontend/src/pages/ReportsPage.tsx,
 * lib/date-box.ts): the same exports, chart words and date rules.
 */
const webReports = resolve(__dirname, '../../../Web Portal/frontend/src/pages/ReportsPage.tsx');
const webDateBox = resolve(__dirname, '../../../Web Portal/frontend/src/lib/date-box.ts');
describe.skipIf(!existsSync(webReports) || !existsSync(webDateBox))('the same as the website', () => {
  const src = existsSync(webReports) ? readFileSync(webReports, 'utf8') : '';
  it('offers the same exports, by the same names and files', () => {
    const m = /const EXPORT_REPORTS[^=]*= (\[[\s\S]*?\]);/.exec(src);
    const web = new Function(`return (${m![1]});`)() as { value: string; label: string; file: string }[];
    expect(EXPORT_REPORTS.map((r) => ({ value: r.kind, label: r.label, file: r.file }))).toEqual(web);
  });
  it('words the charts and the range the same way', () => {
    for (const c of TREND_CHARTS) {
      expect(src).toContain(c.title);
      if (c.title !== 'Velocity') expect(src).toContain(c.about(0));
    }
    expect(src).toContain('Tasks completed per week ({velocityPerWeek}/wk average).');
    for (const name of ["name: 'Completed'", "name: 'Created'", "name: 'Overdue'", "name: 'Remaining'", "name: 'Ideal'"]) expect(src).toContain(name);
    expect(src).toContain('The start date must be on or before the end date. Still showing');
    expect(src).toContain('of completed tasks with a due date were delivered on time.');
    for (const label of ['Completed in range', 'New tasks in range', 'Overdue now', 'On-time delivery', 'Employee workload', 'Assigned tasks by team member']) expect(src).toContain(label);
  });
  it('checks the date boxes alike', async () => {
    const web = (await import(/* @vite-ignore */ webDateBox)) as { isWholeDate: (v: string) => boolean; isBackwards: (a: string, b: string) => boolean };
    for (const v of ['2026-10-01', '2026-1-01', '1999-12-31', '2000-01-01', '', 'abcd-ef-gh']) expect(isWholeDate(v)).toBe(web.isWholeDate(v));
    for (const [a, b] of [['2026-10-05', '2026-10-01'], ['2026-10-01', '2026-10-05'], ['2026-10-0', '2026-10-01']] as const) expect(isBackwards(a, b)).toBe(web.isBackwards(a, b));
  });
});

describe('task export', () => {
  it('downloads one task, named after its key and title', () => {
    expect(taskExportPath('t 1', 'pdf')).toBe('/tasks/t%201/export.pdf');
    expect(taskFileName({ key: 'OPS-12', title: 'Inspect the Rig: phase 2!' }, 'xlsx')).toBe('OPS-12-inspect-the-rig-phase-2.xlsx');
    expect(fileSlug('مهمة')).toBe('export');
  });
});

describe('days told apart over a range of more than one year (5c review #10)', () => {
  const point = (date: string) => ({ date, created: 0, completed: 0, overdue: 0, remaining: 0, ideal: 0 });
  it('adds the year when the range spans two years; each day keeps its date', () => {
    const t = trendCharts({ from: '2025-12-31', to: '2026-01-01', velocityPerWeek: 0, points: [point('2025-12-31'), point('2026-01-01')], velocity: [] } as never);
    expect(t.labels).toEqual(['31 Dec 2025', '1 Jan 2026']);
    expect(t.days).toEqual(['2025-12-31', '2026-01-01']);
  });
  it('within one year the days stay short', () => {
    const t = trendCharts({ from: '2026-01-01', to: '2026-01-02', velocityPerWeek: 0, points: [point('2026-01-01'), point('2026-01-02')], velocity: [] } as never);
    expect(t.labels).toEqual(['1 Jan', '2 Jan']);
  });
});
