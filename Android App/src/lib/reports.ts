import { CATEGORY_LABEL } from './task-status';
import { cumulative } from './chart';
/**
 * Reports on the phone (admins): the exports offered (the same as the web portal and the extension),
 * their paths and file names, and the summary numbers on the Reports screen. Pure TypeScript.
 */

/** 'export' is the full report: every section in one workbook / PDF. */
export type ReportKind = 'export' | 'projects' | 'status' | 'workload' | 'timeseries';
export type ReportFormat = 'xlsx' | 'pdf' | 'csv';

/** The website's exports, by its names (pages/ReportsPage.tsx; tested to be the same). */
export const EXPORT_REPORTS: readonly { kind: ReportKind; label: string; file: string }[] = [
  { kind: 'export', label: 'Full report (all sections)', file: 'tasks-report' },
  { kind: 'projects', label: 'Project performance', file: 'project-performance' },
  { kind: 'status', label: 'Task status', file: 'status-breakdown' },
  { kind: 'workload', label: 'Employee workload', file: 'user-workload' },
  { kind: 'timeseries', label: 'Completion trend', file: 'completion-trend' },
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

/** Tasks completed in one 7-day bucket of the range (from its first day). */
export interface VelocityPoint {
  weekStart: string;
  completed: number;
}

export interface TimeSeries {
  from?: string;
  to?: string;
  points: TimeSeriesPoint[];
  /** Weekly completed counts (servers before 0.3.0 may leave it out). */
  velocity?: VelocityPoint[];
  velocityPerWeek: number;
}

const CATEGORY_ORDER = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];


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
  // "Download my data" (6a).
  json: 'application/json',
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

// ── A range of your own (5c) ────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-25" → "25 Sep" (the calendar day as written, no time zone shift). */
export function reportDay(key: string): string {
  const [, m, d] = key.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`;
}

/** A complete date (YYYY-MM-DD) with a plausible year — the website's date-box rule. */
export function isWholeDate(value: string): boolean {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) && value >= '2000-01-01';
}

/** Both ends are whole dates and the range ends before it starts (the website's rule). */
export function isBackwards(from: string, to: string): boolean {
  return isWholeDate(from) && isWholeDate(to) && from > to;
}

/** A whole date that is a real day (the server refuses 2026-02-30; a typed box can hold it). */
function isRealDay(value: string): boolean {
  if (!isWholeDate(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The range two typed dates give: both real days, in order, not after today — else null (keep what is shown). */
export function readRange(fromBox: string, toBox: string, today: string): { from: string; to: string } | null {
  const from = fromBox.trim();
  const to = toBox.trim();
  if (!isRealDay(from) || !isRealDay(to) || from > to || to > today) return null;
  return { from, to };
}

/**
 * What is wrong with the typed dates, once a date is typed out (10 characters) — nothing while one
 * is still being typed — and which range is still shown (the website's words).
 */
export function rangeProblem(fromBox: string, toBox: string, today: string, shown: { from: string; to: string }): string | null {
  const from = fromBox.trim();
  const to = toBox.trim();
  const still = `Still showing ${reportDay(shown.from)} – ${reportDay(shown.to)}.`;
  const typed = (v: string) => v.length >= 10;
  if ((typed(from) && !isRealDay(from)) || (typed(to) && !isRealDay(to))) return `Enter a real date, as YYYY-MM-DD. ${still}`;
  if (!typed(from) || !typed(to)) return null;
  if (isBackwards(from, to)) return `The start date must be on or before the end date. ${still}`;
  if (to > today) return `The end date can’t be after today. ${still}`;
  return null;
}

/** The preset a range is (that many days, ending today), or null for a range of your own. */
export function activePreset(range: { from: string; to: string }, today: string): number | null {
  if (range.to !== today) return null;
  const days = periodDays(range);
  return (PERIOD_PRESETS as readonly number[]).includes(days) ? days : null;
}

/** The longest trend the server works out (it keeps the last 366 days of a longer range). */
export const MAX_TREND_DAYS = 366;

export function longRangeNote(range: { from: string; to: string }): string | null {
  return periodDays(range) > MAX_TREND_DAYS ? `The trend shows the last ${MAX_TREND_DAYS} days of this range.` : null;
}

// ── The trend charts (5c), as the website's ────────────────────────────────

/** A line's colour, by role: the screen picks the palette's colour for it. */
export type LineTone = 'done' | 'muted' | 'danger' | 'brand';

export interface TrendLine {
  name: string;
  values: number[];
  tone: LineTone;
  /** Shade the area under the line. */
  area?: boolean;
  /** A dashed reference line (the ideal burndown). */
  dashed?: boolean;
}

/** The four trend charts and what each shows, in the website's words. */
export const TREND_CHARTS: readonly { key: 'completion' | 'overdue' | 'burndown' | 'velocity'; title: string; about: (velocityPerWeek: number) => string }[] = [
  { key: 'completion', title: 'Completion over time', about: () => 'Cumulative tasks created vs completed — are we keeping up?' },
  { key: 'overdue', title: 'Overdue trend', about: () => 'Open tasks past their due date, each day.' },
  { key: 'burndown', title: 'Burndown', about: () => 'Remaining open work vs an ideal linear burn.' },
  { key: 'velocity', title: 'Velocity', about: (v) => `Tasks completed per week (${v}/wk average).` },
];

/**
 * The trend's lines and weekly bars: created vs completed added up, overdue, burndown, velocity.
 * `days` are the dates (the numbers' rows are keyed by them); a range over two years writes each
 * day with its year, so "1 Jan" and "1 Jan" are told apart (5c review #10).
 */
export function trendCharts(series: TimeSeries | null | undefined): {
  labels: string[];
  days: string[];
  completion: TrendLine[];
  overdue: TrendLine[];
  burndown: TrendLine[];
  velocity: { label: string; value: number }[];
} {
  const points = series?.points ?? [];
  if (points.length === 0) return { labels: [], days: [], completion: [], overdue: [], burndown: [], velocity: velocityBars(series) };
  const years = points[0]!.date.slice(0, 4) !== points[points.length - 1]!.date.slice(0, 4);
  return {
    labels: points.map((p) => (years ? `${reportDay(p.date)} ${p.date.slice(0, 4)}` : reportDay(p.date))),
    days: points.map((p) => p.date),
    completion: [
      { name: 'Completed', values: cumulative(points.map((p) => p.completed || 0)), tone: 'done', area: true },
      { name: 'Created', values: cumulative(points.map((p) => p.created || 0)), tone: 'muted' },
    ],
    overdue: [{ name: 'Overdue', values: points.map((p) => p.overdue || 0), tone: 'danger', area: true }],
    burndown: [
      { name: 'Remaining', values: points.map((p) => p.remaining || 0), tone: 'brand', area: true },
      { name: 'Ideal', values: points.map((p) => p.ideal || 0), tone: 'muted', dashed: true },
    ],
    velocity: velocityBars(series),
  };
}

function velocityBars(series: TimeSeries | null | undefined): { label: string; value: number }[] {
  return (series?.velocity ?? []).map((w) => ({ label: `Week of ${reportDay(w.weekStart)}`, value: w.completed || 0 }));
}

/** What the on-time bar means. */
export function onTimeText(c: CompletionStats): string {
  return `${c.onTimeRate}% of completed tasks with a due date were delivered on time.`;
}

/** Each team member's assigned tasks, most first (narrowed to the chosen member). */
export function workloadBars(rows: UserWorkloadRow[], userId: string): { label: string; value: number }[] {
  return rows
    .filter((w) => !userId || w.userId === userId)
    .sort((a, b) => b.assigned - a.assigned)
    .map((w) => ({ label: w.name || w.username, value: w.assigned }));
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
