/**
 * Reports on the phone (admins): the exports offered (the same as the web portal and the extension),
 * their paths and file names, and the summary numbers on the Reports screen. Pure TypeScript.
 */

/** 'export' is the full report: every section in one workbook / PDF. */
export type ReportKind = 'export' | 'projects' | 'status' | 'workload' | 'timeseries';
export type ReportFormat = 'xlsx' | 'pdf' | 'csv';

export const EXPORT_REPORTS: readonly { kind: ReportKind; label: string; file: string }[] = [
  { kind: 'export', label: 'Full report', file: 'tasks-report' },
  { kind: 'projects', label: 'Projects', file: 'project-performance' },
  { kind: 'status', label: 'Status', file: 'status-breakdown' },
  { kind: 'workload', label: 'Workload', file: 'user-workload' },
  { kind: 'timeseries', label: 'Trend', file: 'completion-trend' },
];

export const REPORT_FORMATS: readonly { format: ReportFormat; label: string }[] = [
  { format: 'xlsx', label: 'Excel' },
  { format: 'pdf', label: 'PDF' },
  { format: 'csv', label: 'CSV' },
];

export const PERIOD_PRESETS = [7, 30, 90] as const;

export interface ReportFilters {
  projectId?: string;
  /** A team member: only tasks assigned to them. */
  userId?: string;
  from?: string;
  to?: string;
}

export interface ProjectPerformanceRow {
  projectId: string;
  projectName: string;
  total: number;
  completed: number;
  overdue: number;
  completionPct: number;
}

export interface UserWorkloadRow {
  userId: string;
  username: string;
  /** Full name, else the username (servers before 0.3.0 leave it out). */
  name?: string;
  assigned: number;
  completed: number;
  overdue: number;
}

export interface CompletionStats {
  total: number;
  completed: number;
  onTime: number;
  late: number;
  unclassified: number;
  onTimeRate: number;
}

export interface TimeSeriesPoint {
  date: string;
  created: number;
  completed: number;
  overdue: number;
  remaining: number;
  ideal: number;
}

export interface TimeSeries {
  from?: string;
  to?: string;
  points: TimeSeriesPoint[];
  velocityPerWeek: number;
}

const CATEGORY_ORDER = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];
const CATEGORY_LABEL: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  DONE: 'Done',
};

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

function query(pairs: [string, string | undefined][]): string {
  const parts = pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Whether a report also takes the period (the full report's trend section, and the trend itself). */
const usesPeriod = (kind: ReportKind) => kind === 'export' || kind === 'timeseries';

/** The on-screen filters as a query string: project and team member always, the period where it applies. */
export function reportQuery(kind: ReportKind, f: ReportFilters = {}): string {
  return query([['projectId', f.projectId], ['userId', f.userId], ...(usesPeriod(kind) ? ([['from', f.from], ['to', f.to]] as [string, string | undefined][]) : [])]);
}

export function reportExportPath(kind: ReportKind, format: ReportFormat, f: ReportFilters = {}): string {
  return `/reports/${kind}.${format}${reportQuery(kind, f)}`;
}

/** CSV is one table — it suits a single report, not the full report's several sections. */
export const csvAllowed = (kind: ReportKind) => kind !== 'export';

/** Named like the server names it: report + the company's today (the server's own name wins). */
export function reportFileName(kind: ReportKind, ext: string, today: string): string {
  const file = EXPORT_REPORTS.find((r) => r.kind === kind)?.file ?? kind;
  return `${file}-${today}.${ext}`;
}

/** The file name in a Content-Disposition header — just the name, never a path — or null. */
export function fileNameFromDisposition(header: string | null | undefined): string | null {
  const m = /filename="([^"]+)"/i.exec(header ?? '');
  const name = m ? (m[1]!.split(/[\\/]/).pop() ?? '').trim() : '';
  return name && name !== '.' && name !== '..' ? name : null;
}

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  csv: 'text/csv',
};

/** The file type for the share sheet, from the file's extension. */
export function mimeTypeFor(fileName: string): string {
  return MIME[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** A safe file-name part, as the server makes them: lowercase letters, digits and dashes. */
export function fileSlug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'export'
  );
}

export const taskExportPath = (id: string, format: 'xlsx' | 'pdf') => `/tasks/${encodeURIComponent(id)}/export.${format}`;
export const taskFileName = (task: { key: string; title: string }, ext: string) => `${task.key}-${fileSlug(task.title)}.${ext}`;

/** 'YYYY-MM-DD' shifted by whole days (calendar arithmetic, no time zone involved). */
function shiftDayKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The last `days` days, ending today (company day keys). */
export function periodRange(days: number, today: string): { from: string; to: string } {
  return { from: shiftDayKey(today, -(days - 1)), to: today };
}

export function periodDays({ from, to }: { from: string; to: string }): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Totals over the project rows (narrowed to the selected project, in case the server didn't). */
export function summarize(rows: ProjectPerformanceRow[], { projectId }: { projectId?: string } = {}) {
  const mine = rows.filter((r) => !projectId || r.projectId === projectId);
  const total = mine.reduce((s, r) => s + (r.total || 0), 0);
  const completed = mine.reduce((s, r) => s + (r.completed || 0), 0);
  const overdue = mine.reduce((s, r) => s + (r.overdue || 0), 0);
  return { projects: mine.length, total, completed, overdue, pending: total - completed, completionPct: pct(completed, total), overduePct: pct(overdue, total) };
}

/** Status counts in board order (unknown categories last), with their share of all tasks. */
export function statusBars(status: Record<string, number>): { category: string; label: string; value: number; pct: number }[] {
  const entries = Object.entries(status ?? {});
  const sum = entries.reduce((s, [, n]) => s + (n || 0), 0);
  const rank = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  return entries
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([category, value]) => ({ category, label: CATEGORY_LABEL[category] ?? category, value: value || 0, pct: pct(value || 0, sum) }));
}

/** What happened in the period: tasks completed and created, overdue on its last day, weekly velocity. */
export function trendStats(series: TimeSeries | null | undefined) {
  const points = series?.points ?? [];
  return {
    completed: points.reduce((s, p) => s + (p.completed || 0), 0),
    created: points.reduce((s, p) => s + (p.created || 0), 0),
    overdueNow: points.length ? points[points.length - 1]!.overdue || 0 : 0,
    velocityPerWeek: series?.velocityPerWeek ?? 0,
  };
}
