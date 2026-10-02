/**
 * Reports for the extension: the exports offered (same as the web portal), their query strings and
 * file names, and the summary numbers shown on the Reports screen. Pure logic (unit-tested); the
 * screen lives in app/screens/reports.js.
 */
import { shiftDayKey } from './due-date.js';

/** 'export' is the full report: every section in one workbook / PDF. */
export const EXPORT_REPORTS = [
  { kind: 'export', label: 'Full report (all sections)', file: 'tasks-report' },
  { kind: 'projects', label: 'Project performance', file: 'project-performance' },
  { kind: 'status', label: 'Task status', file: 'status-breakdown' },
  { kind: 'workload', label: 'Employee workload', file: 'user-workload' },
  { kind: 'timeseries', label: 'Completion trend', file: 'completion-trend' },
];

export const REPORT_FORMATS = [
  { format: 'xlsx', label: 'Excel' },
  { format: 'pdf', label: 'PDF' },
  { format: 'csv', label: 'CSV' },
];

export const PERIOD_PRESETS = [7, 30, 90];

const CATEGORY_ORDER = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'];
const CATEGORY_LABEL = { BACKLOG: 'Backlog', TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', REVIEW: 'Review', DONE: 'Done' };

const pct = (part, total) => (total ? Math.round((part / total) * 100) : 0);

function query(pairs) {
  const parts = pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Whether a report also takes the period (the full report's trend section, and the trend itself). */
const usesPeriod = (kind) => kind === 'export' || kind === 'timeseries';

/** The on-screen filters as a query string: project and team member always, the period where it applies. */
export function reportQuery(kind, { projectId, userId, from, to } = {}) {
  return query([['projectId', projectId], ['userId', userId], ...(usesPeriod(kind) ? [['from', from], ['to', to]] : [])]);
}

export function reportExportPath(kind, format, filters = {}) {
  return `/reports/${kind}.${format}${reportQuery(kind, filters)}`;
}

/** CSV is one table — it suits a single report, not the full report's several sections. */
export const csvAllowed = (kind) => kind !== 'export';

/** Named like the server names it: report + the company's today. */
export function reportFileName(kind, ext, today) {
  const file = EXPORT_REPORTS.find((r) => r.kind === kind)?.file ?? kind;
  return `${file}-${today}.${ext}`;
}

/** The file name from a Content-Disposition header (just the name, never a path), or null. */
export function fileNameFromDisposition(header) {
  const m = /filename="([^"]+)"/i.exec(header || '');
  if (!m) return null;
  const name = m[1].split(/[\/]/).pop().trim();
  return name && name !== '.' && name !== '..' ? name : null;
}

/** A safe file-name part, as the server makes them: lowercase letters, digits and dashes. */
export function fileSlug(text) {
  return (
    String(text || '')
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'export'
  );
}

export const taskExportPath = (id, format) => `/tasks/${encodeURIComponent(id)}/export.${format}`;
export const taskFileName = (task, ext) => `${task.key}-${fileSlug(task.title)}.${ext}`;

/** The last `days` days, ending today (company day keys). */
export function periodRange(days, today) {
  return { from: shiftDayKey(today, -(days - 1)), to: today };
}

export function periodDays({ from, to }) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/** Totals over the project rows (narrowed to the selected project, in case the server didn't). */
export function summarize(projectRows, { projectId } = {}) {
  const rows = (projectRows || []).filter((r) => !projectId || r.projectId === projectId);
  const total = rows.reduce((s, r) => s + (r.total || 0), 0);
  const completed = rows.reduce((s, r) => s + (r.completed || 0), 0);
  const overdue = rows.reduce((s, r) => s + (r.overdue || 0), 0);
  return { projects: rows.length, total, completed, overdue, pending: total - completed, completionPct: pct(completed, total), overduePct: pct(overdue, total) };
}

/** Status counts in board order (unknown categories last), with their share of all tasks. */
export function statusBars(status) {
  const entries = Object.entries(status || {});
  const sum = entries.reduce((s, [, n]) => s + (n || 0), 0);
  const rank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  return entries
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([category, value]) => ({ category, label: CATEGORY_LABEL[category] ?? category, value: value || 0, pct: pct(value || 0, sum) }));
}

/** What happened in the period: tasks completed and created, overdue on its last day, weekly velocity. */
export function trendStats(series) {
  const points = series?.points ?? [];
  return {
    completed: points.reduce((s, p) => s + (p.completed || 0), 0),
    created: points.reduce((s, p) => s + (p.created || 0), 0),
    overdueNow: points.length ? points[points.length - 1].overdue || 0 : 0,
    velocityPerWeek: series?.velocityPerWeek ?? 0,
  };
}
