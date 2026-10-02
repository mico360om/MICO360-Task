import { describe, it, expect } from 'vitest';
import { reportSheets, reportPdf, reportFileName, filterSummary, type ReportBundle, type ReportMeta } from './report-export';
import { inspectPdf } from '../../lib/pdf-inspect';

const bundle = (taskCount = 3): ReportBundle => ({
  completion: { total: 10, completed: 6, onTime: 4, late: 1, unclassified: 1, onTimeRate: 80 },
  status: { DONE: 6, IN_PROGRESS: 3, TODO: 1 },
  projects: [
    { projectId: 'p2', projectName: 'Rig inspection', total: 4, completed: 1, overdue: 2, completionPct: 25 },
    { projectId: 'p1', projectName: 'مشروع الإطلاق', total: 6, completed: 5, overdue: 0, completionPct: 83 },
  ],
  workload: [
    { userId: 'u1', username: 'ada', name: 'Ada Lovelace', assigned: 5, completed: 3, overdue: 1 },
    { userId: 'u2', username: 'omar', name: 'Omar Ahmed', assigned: 2, completed: 2, overdue: 0 },
  ],
  series: {
    from: '2026-09-29',
    to: '2026-10-01',
    points: [
      { date: '2026-09-29', created: 2, completed: 1, overdue: 1, remaining: 5, ideal: 5 },
      { date: '2026-09-30', created: 1, completed: 3, overdue: 2, remaining: 3, ideal: 2.5 },
      { date: '2026-10-01', created: 0, completed: 2, overdue: 2, remaining: 1, ideal: 0 },
    ],
    velocity: [{ weekStart: '2026-09-28', completed: 6 }],
    velocityPerWeek: 6,
  },
  tasks: Array.from({ length: taskCount }, (_, i) => ({
    key: `MICO-${i + 1}`,
    title: i === 0 ? 'مراجعة تقرير المبيعات الشهري' : `Task number ${i + 1} with a reasonably descriptive title`,
    projectName: 'MICO360 Platform',
    status: i % 2 ? 'Completed' : 'In progress',
    category: i % 2 ? 'DONE' : 'IN_PROGRESS',
    priority: i === 0 ? 'URGENT' : 'NORMAL',
    assignees: ['Ada Lovelace', 'Omar Ahmed'],
    dueDate: '2026-09-30',
    completedAt: i % 2 ? new Date('2026-09-30T13:30:00Z') : null,
    done: Boolean(i % 2),
    overdue: i === 0,
  })),
});

const meta: ReportMeta = {
  title: 'Tasks report',
  generatedAt: new Date('2026-10-01T06:00:00Z'),
  timeZone: 'Asia/Muscat',
  generatedBy: 'Aisha Khan',
  projectName: 'MICO360 Platform',
  memberName: null,
  from: '2026-09-02',
  to: '2026-10-01',
};

describe('filterSummary', () => {
  it('spells out the filters and the trend period', () => {
    expect(filterSummary(meta)).toBe('Project: MICO360 Platform · Team member: Everyone · Trend period: 2 Sep 2026 – 1 Oct 2026');
    expect(filterSummary({ ...meta, projectName: null, memberName: 'Omar Ahmed' })).toContain('Project: All projects · Team member: Omar Ahmed');
  });
});

describe('reportSheets', () => {
  it('builds one sheet per section, each titled, with the filters and readable headers', () => {
    const sheets = reportSheets(bundle(), meta, ['summary', 'status', 'projects', 'workload', 'trend', 'tasks']);
    expect(sheets.map((s) => s.name)).toEqual(['Summary', 'Status', 'Projects', 'Team workload', 'Trend', 'Tasks']);
    for (const s of sheets) {
      expect(s.title).toBeTruthy();
      expect(s.notes?.join(' ')).toContain('Project: MICO360 Platform');
      expect(s.notes?.join(' ')).toContain('Generated 1 Oct 2026, 10:00 (Asia/Muscat) by Aisha Khan');
    }
    const projects = sheets.find((s) => s.name === 'Projects')!;
    expect(projects.columns.map((c) => c.header)).toEqual(['Project', 'Tasks', 'Completed', 'Overdue', 'Completion']);
    expect(projects.columns[4]!.kind).toBe('percent');
    // Alphabetical, Latin names before Arabic ones.
    expect(projects.rows.map((r) => r[0])).toEqual(['Rig inspection', 'مشروع الإطلاق']);
  });

  it('lists every task with real dates, people and an overdue flag', () => {
    const tasks = reportSheets(bundle(), meta, ['tasks'])[0]!;
    expect(tasks.columns.map((c) => c.header)).toEqual(['Key', 'Title', 'Project', 'Status', 'Priority', 'Assignees', 'Due', 'Completed', 'Overdue']);
    expect(tasks.rows[0]).toEqual(['MICO-1', 'مراجعة تقرير المبيعات الشهري', 'MICO360 Platform', 'In progress', 'Urgent', 'Ada Lovelace, Omar Ahmed', { date: '2026-09-30' }, null, 'Yes']);
    // Completion time in company time (13:30 UTC is 17:30 in Muscat).
    expect(tasks.rows[1]![7]).toEqual({ date: '2026-09-30 17:30' });
  });

  it('summarises the numbers on the Summary sheet', () => {
    const summary = reportSheets(bundle(), meta, ['summary'])[0]!;
    expect(summary.rows).toEqual(
      expect.arrayContaining([
        ['Total tasks', 10],
        ['Completed', 6],
        ['Completion rate (%)', 60],
        ['On-time completion (%)', 80],
        ['Average completed per week', 6],
      ]),
    );
  });
});

describe('reportPdf', () => {
  it('lays out every section with its numbers, the filters and the logo header', () => {
    const { pages, objects } = inspectPdf(reportPdf(bundle(), meta, ['summary', 'status', 'projects', 'workload', 'trend', 'tasks']));
    const text = pages.flat();
    for (const t of ['Tasks report', 'Summary', 'Status breakdown', 'Project performance', 'Team workload', 'Completion trend', 'Tasks', 'Rig inspection', 'مشروع الإطلاق', 'Ada Lovelace', 'MICO-1', 'مراجعة تقرير المبيعات الشهري', '83%', 'Overdue']) {
      expect(text, t).toContain(t);
    }
    expect(text.join(' ')).toContain('Project: MICO360 Platform');
    expect([...objects.values()].some((d) => /\/Subtype \/Image/.test(d))).toBe(true);
    expect(text.some((t) => /^Page 1 of \d+$/.test(t))).toBe(true);
  });

  it('breaks a long task list across pages, repeating the table header and keeping every row', () => {
    const { pages } = inspectPdf(reportPdf(bundle(120), meta, ['tasks']));
    expect(pages.length).toBeGreaterThan(2);
    const all = pages.flat();
    for (let i = 1; i <= 120; i++) expect(all).toContain(`MICO-${i}`);
    for (const p of pages.slice(1)) {
      expect(p).toContain('Key');
      expect(p).toContain('Tasks report · MICO360 Platform');
    }
  });

  it('keeps every section heading on the same page as the start of its content', () => {
    const { pages } = inspectPdf(reportPdf(bundle(30), meta, ['summary', 'status', 'projects', 'workload', 'trend', 'tasks']));
    const follows: Record<string, string> = { 'Completion trend': 'Created', 'Team workload': 'Team member', 'Project performance': 'Project', Tasks: 'Key' };
    for (const [heading, next] of Object.entries(follows)) {
      // The heading is directly followed, on the same page, by the first thing of its section.
      expect(pages.some((p) => p.some((t, i) => t === heading && p[i + 1] === next)), heading).toBe(true);
    }
  });

  it('says so when a section has nothing to show', () => {
    const empty: ReportBundle = { ...bundle(0), projects: [], workload: [], status: {} };
    const text = inspectPdf(reportPdf(empty, meta, ['status', 'projects', 'tasks'])).pages.flat();
    expect(text).toContain('No tasks match these filters.');
  });
});

describe('reportFileName', () => {
  it('names the file after the report, its filters and the company day', () => {
    expect(reportFileName('tasks-report', meta, 'xlsx')).toBe('tasks-report-mico360-platform-2026-10-01.xlsx');
    expect(reportFileName('tasks-report', { ...meta, projectName: null }, 'pdf')).toBe('tasks-report-2026-10-01.pdf');
    expect(reportFileName('user-workload', { ...meta, projectName: null, memberName: 'Omar Ahmed' }, 'xlsx')).toBe('user-workload-omar-ahmed-2026-10-01.xlsx');
  });

  it('leaves out a filter name with no letters a file name can hold', () => {
    expect(reportFileName('tasks-report', { ...meta, projectName: 'مشروع الإطلاق' }, 'pdf')).toBe('tasks-report-2026-10-01.pdf');
  });
});
