/**
 * Report exports: the same numbers as the Reports page, with the same filters, as an Excel
 * workbook (one sheet per section) or a branded PDF (logo header, summary tiles, status bars,
 * tables that repeat their header across pages, the completion trend chart, page numbers).
 */
import { PdfDocument, type TableColumn } from '../../lib/pdf-document';
import type { XlsxSheet, XlsxValue } from '../../lib/xlsx-writer';
import { BRAND, CATEGORY_COLOR, CATEGORY_ORDER, categoryLabel, formatDateTime, formatDay, priorityLabel, slugPart, wallClock } from '../../lib/export-format';
import type { CompletionStats, ProjectPerformance, ReportFilter, ReportService, TaskListRow, UserWorkload } from './report-service';
import type { TimeSeriesResult } from './report-timeseries';

export type ReportSection = 'summary' | 'status' | 'projects' | 'workload' | 'trend' | 'tasks';
export const ALL_SECTIONS: ReportSection[] = ['summary', 'status', 'projects', 'workload', 'trend', 'tasks'];

export interface ReportBundle {
  completion: CompletionStats;
  status: Record<string, number>;
  projects: ProjectPerformance[];
  workload: UserWorkload[];
  series: TimeSeriesResult;
  tasks: TaskListRow[];
}

export interface ReportMeta {
  title: string;
  generatedAt: Date;
  timeZone: string;
  generatedBy?: string | null;
  /** The project filter's name (null = all projects). */
  projectName?: string | null;
  /** The team-member filter's name (null = everyone). */
  memberName?: string | null;
  /** The trend period, 'YYYY-MM-DD'. */
  from: string;
  to: string;
}

/** The PDF lists at most this many tasks (the Excel file has them all). */
const PDF_TASK_LIMIT = 1500;
const EMPTY = 'No tasks match these filters.';

/** Load everything a report needs, with one set of filters. */
export async function loadReportBundle(svc: ReportService, opts: { filter: ReportFilter; from: string; to: string }): Promise<ReportBundle> {
  const [completion, status, projects, workload, series, tasks] = await Promise.all([
    svc.completionReport(opts.filter),
    svc.taskStatusReport(opts.filter),
    svc.projectPerformanceReport(opts.filter),
    svc.workloadReport(opts.filter),
    svc.timeSeriesReport({ ...opts.filter, from: opts.from, to: opts.to }),
    svc.taskListReport(opts.filter),
  ]);
  return { completion, status, projects, workload, series, tasks };
}

export function filterSummary(meta: ReportMeta): string {
  return [
    `Project: ${meta.projectName || 'All projects'}`,
    `Team member: ${meta.memberName || 'Everyone'}`,
    `Trend period: ${formatDay(meta.from)} – ${formatDay(meta.to)}`,
  ].join(' · ');
}

function generatedLine(meta: ReportMeta): string {
  return `Generated ${formatDateTime(meta.generatedAt, meta.timeZone)} (${meta.timeZone})${meta.generatedBy ? ` by ${meta.generatedBy}` : ''}`;
}

/** report + its filters (project, team member) + the company day, e.g. tasks-report-mico360-platform-2026-10-01.pdf. */
export function reportFileName(base: string, meta: ReportMeta, ext: string): string {
  const parts = [base, slugPart(meta.projectName ?? ''), slugPart(meta.memberName ?? ''), wallClock(meta.generatedAt, meta.timeZone).slice(0, 10)];
  return `${parts.filter(Boolean).join('-')}.${ext}`;
}

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);
const byName = <T>(rows: T[], name: (r: T) => string) => [...rows].sort((a, b) => name(a).localeCompare(name(b)));

function statusRows(status: Record<string, number>): { category: string; count: number }[] {
  const known = CATEGORY_ORDER.filter((c) => status[c]).map((c) => ({ category: c as string, count: status[c]! }));
  const other = Object.entries(status).filter(([c, n]) => n && !CATEGORY_ORDER.includes(c as (typeof CATEGORY_ORDER)[number])).map(([category, count]) => ({ category, count }));
  return [...known, ...other];
}

const SECTION_TITLE: Record<ReportSection, string> = {
  summary: 'Summary',
  status: 'Status breakdown',
  projects: 'Project performance',
  workload: 'Team workload',
  trend: 'Completion trend',
  tasks: 'Tasks',
};

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export function reportSheets(b: ReportBundle, meta: ReportMeta, sections: ReportSection[] = ALL_SECTIONS): XlsxSheet[] {
  const notes = [filterSummary(meta), generatedLine(meta)];
  const titled = (section: ReportSection) => `${meta.title} — ${SECTION_TITLE[section]}`;
  const sheets: XlsxSheet[] = [];
  const total = b.completion.total;

  for (const section of sections) {
    if (section === 'summary') {
      sheets.push({
        name: 'Summary',
        title: titled('summary'),
        notes,
        columns: [{ header: 'Measure' }, { header: 'Value', kind: 'number' }],
        rows: [
          ['Total tasks', total],
          ['Completed', b.completion.completed],
          ['Completion rate (%)', pct(b.completion.completed, total)],
          ['Open', total - b.completion.completed],
          ['Overdue', b.tasks.filter((t) => t.overdue).length],
          ['Completed on time', b.completion.onTime],
          ['Completed late', b.completion.late],
          ['On-time completion (%)', b.completion.onTimeRate],
          ['Average completed per week', b.series.velocityPerWeek],
        ],
      });
    } else if (section === 'status') {
      const rows = statusRows(b.status);
      const sum = rows.reduce((s, r) => s + r.count, 0);
      sheets.push({
        name: 'Status',
        title: titled('status'),
        notes,
        columns: [{ header: 'Status' }, { header: 'Tasks', kind: 'integer' }, { header: 'Share', kind: 'percent' }],
        rows: rows.map((r) => [categoryLabel(r.category), r.count, pct(r.count, sum)]),
      });
    } else if (section === 'projects') {
      sheets.push({
        name: 'Projects',
        title: titled('projects'),
        notes,
        columns: [{ header: 'Project' }, { header: 'Tasks', kind: 'integer' }, { header: 'Completed', kind: 'integer' }, { header: 'Overdue', kind: 'integer' }, { header: 'Completion', kind: 'percent' }],
        rows: byName(b.projects, (p) => p.projectName).map((p) => [p.projectName, p.total, p.completed, p.overdue, p.completionPct]),
      });
    } else if (section === 'workload') {
      sheets.push({
        name: 'Team workload',
        title: titled('workload'),
        notes,
        columns: [{ header: 'Team member' }, { header: 'Username' }, { header: 'Assigned', kind: 'integer' }, { header: 'Completed', kind: 'integer' }, { header: 'Open', kind: 'integer' }, { header: 'Overdue', kind: 'integer' }],
        rows: byName(b.workload, (w) => w.name).map((w) => [w.name, w.username, w.assigned, w.completed, w.assigned - w.completed, w.overdue]),
      });
    } else if (section === 'trend') {
      sheets.push({
        name: 'Trend',
        title: titled('trend'),
        notes,
        columns: [{ header: 'Date', kind: 'date' }, { header: 'Created', kind: 'integer' }, { header: 'Completed', kind: 'integer' }, { header: 'Overdue', kind: 'integer' }, { header: 'Remaining', kind: 'integer' }, { header: 'Ideal remaining', kind: 'number' }],
        rows: b.series.points.map((p) => [{ date: p.date }, p.created, p.completed, p.overdue, p.remaining, Math.round(p.ideal * 10) / 10]),
      });
    } else if (section === 'tasks') {
      sheets.push({
        name: 'Tasks',
        title: titled('tasks'),
        notes,
        columns: [
          { header: 'Key' },
          { header: 'Title', wrap: true },
          { header: 'Project' },
          { header: 'Status' },
          { header: 'Priority' },
          { header: 'Assignees', wrap: true },
          { header: 'Due', kind: 'date' },
          { header: 'Completed', kind: 'datetime' },
          { header: 'Overdue' },
        ],
        rows: b.tasks.map((t): XlsxValue[] => [
          t.key,
          t.title,
          t.projectName,
          t.status,
          priorityLabel(t.priority),
          t.assignees.join(', '),
          t.dueDate ? { date: t.dueDate } : null,
          t.completedAt ? { date: wallClock(t.completedAt, meta.timeZone) } : null,
          t.overdue ? 'Yes' : '',
        ]),
      });
    }
  }
  return sheets;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export function reportPdf(b: ReportBundle, meta: ReportMeta, sections: ReportSection[] = ALL_SECTIONS): Buffer {
  const runningTitle = `${meta.title}${meta.projectName ? ` · ${meta.projectName}` : ''}`;
  const doc = new PdfDocument({
    orientation: 'landscape',
    title: runningTitle,
    runningTitle,
    footerLeft: `MICO360 Tasks · ${generatedLine(meta)}`,
    palette: { brand: BRAND },
  });
  doc.reportHeader({ title: meta.title, subtitle: meta.projectName || 'All projects', details: [filterSummary(meta), generatedLine(meta)] });

  const total = b.completion.total;
  const empty = () => doc.text(EMPTY, { color: [0.42, 0.4, 0.38], size: 10, gap: 4 });
  let first = true;
  /** A section heading kept on the same page as the first `keepWith` points of its content. */
  const heading = (s: ReportSection, keepWith: number) => {
    doc.heading(SECTION_TITLE[s], { size: 13, topGap: first ? 2 : 16, keepWith });
    first = false;
  };
  // A table that fits on one page is kept whole; a longer one keeps its header and first rows with the heading.
  const tableKeep = (cols: TableColumn[], rows: string[][], size: number) => {
    const whole = doc.tableHeight(cols, rows, { size });
    return whole <= 320 ? whole : doc.tableHeight(cols, rows.slice(0, 3), { size });
  };
  const DANGER: [number, number, number] = [0.72, 0.16, 0.16];

  for (const section of sections) {
    if (section === 'summary') {
      heading('summary', 90);
      const overdue = b.tasks.filter((t) => t.overdue).length;
      doc.statTiles([
        { label: 'Total tasks', value: String(total) },
        { label: 'Completed', value: String(b.completion.completed), note: `${pct(b.completion.completed, total)}%`, tone: 'success' },
        { label: 'Open', value: String(total - b.completion.completed), tone: 'muted' },
        { label: 'Overdue', value: String(overdue), tone: overdue ? 'danger' : 'muted' },
        { label: 'On-time completion', value: `${b.completion.onTimeRate}%`, note: `${b.completion.onTime} on time · ${b.completion.late} late`, tone: 'brand' },
      ]);
      doc.keyValue('Average completed per week', `${b.series.velocityPerWeek} (${formatDay(b.series.from)} – ${formatDay(b.series.to)})`, { size: 9.5 });
    } else if (section === 'status') {
      const rows = statusRows(b.status);
      heading('status', rows.length * 17 + 4);
      const sum = rows.reduce((s, r) => s + r.count, 0);
      if (rows.length === 0) empty();
      else doc.barList(rows.map((r) => ({ label: `${categoryLabel(r.category)} · ${pct(r.count, sum)}%`, value: r.count, color: CATEGORY_COLOR[r.category] ?? BRAND })));
    } else if (section === 'projects') {
      const cols: TableColumn[] = [{ header: 'Project' }, { header: 'Tasks', align: 'right' }, { header: 'Completed', align: 'right' }, { header: 'Overdue', align: 'right' }, { header: 'Completion', align: 'right' }];
      const rows = byName(b.projects, (p) => p.projectName).map((p) => [p.projectName, String(p.total), String(p.completed), String(p.overdue), `${p.completionPct}%`]);
      heading('projects', tableKeep(cols, rows, 9));
      if (rows.length === 0) empty();
      else doc.table(cols, rows, { size: 9, cellColor: (r, c) => (c === 3 && rows[r]![3] !== '0' ? DANGER : null) });
    } else if (section === 'workload') {
      const cols: TableColumn[] = [{ header: 'Team member' }, { header: 'Assigned', align: 'right' }, { header: 'Completed', align: 'right' }, { header: 'Open', align: 'right' }, { header: 'Overdue', align: 'right' }];
      const rows = byName(b.workload, (w) => w.name).map((w) => [w.name, String(w.assigned), String(w.completed), String(w.assigned - w.completed), String(w.overdue)]);
      heading('workload', tableKeep(cols, rows, 9));
      if (rows.length === 0) empty();
      else doc.table(cols, rows, { size: 9, cellColor: (r, c) => (c === 4 && rows[r]![4] !== '0' ? DANGER : null) });
    } else if (section === 'trend') {
      heading('trend', 200);
      if (b.series.points.length === 0) empty();
      else {
        doc.lineChart({
          labels: b.series.points.map((p) => formatDay(p.date)),
          series: [
            { name: 'Created', values: b.series.points.map((p) => p.created), color: '#57514C' },
            { name: 'Completed', values: b.series.points.map((p) => p.completed), color: '#2E7D53' },
            { name: 'Overdue', values: b.series.points.map((p) => p.overdue), color: BRAND },
          ],
        });
        if (b.series.velocity.length > 0) {
          doc.table(
            [{ header: 'Week starting' }, { header: 'Completed', align: 'right' }],
            b.series.velocity.map((v) => [formatDay(v.weekStart), String(v.completed)]),
            { size: 9 },
          );
        }
      }
    } else if (section === 'tasks') {
      const cols: TableColumn[] = [{ header: 'Key' }, { header: 'Title' }, { header: 'Project' }, { header: 'Status' }, { header: 'Priority' }, { header: 'Assignees' }, { header: 'Due', align: 'left' }, { header: 'Completed', align: 'left' }];
      const shown = b.tasks.slice(0, PDF_TASK_LIMIT);
      const rows = shown.map((t) => [
            t.key,
            t.title,
            t.projectName,
            t.status,
            priorityLabel(t.priority),
            t.assignees.join(', ') || '—',
            t.dueDate ? `${formatDay(t.dueDate)}${t.overdue ? ' · Overdue' : ''}` : '—',
        t.completedAt ? formatDay(wallClock(t.completedAt, meta.timeZone).slice(0, 10)) : '—',
      ]);
      heading('tasks', doc.tableHeight(cols, rows.slice(0, 3), { size: 8.5 }));
      if (rows.length === 0) empty();
      else {
        doc.table(cols, rows, { size: 8.5, cellColor: (r, c) => (c === 6 && shown[r]!.overdue ? DANGER : null) });
        if (b.tasks.length > shown.length) doc.text(`Showing the first ${shown.length} of ${b.tasks.length} tasks — the Excel export lists them all.`, { size: 9, color: [0.42, 0.4, 0.38] });
      }
    }
  }
  return doc.build();
}
