import type { ApiClient } from '../lib/api-client';

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
export interface VelocityPoint {
  weekStart: string;
  completed: number;
}
export interface TimeSeriesResult {
  from: string;
  to: string;
  points: TimeSeriesPoint[];
  velocity: VelocityPoint[];
  velocityPerWeek: number;
}

/** Scope every report, chart and export to one project and/or one team member. */
export interface ReportFilters {
  projectId?: string;
  /** A team member: only tasks assigned to them. */
  userId?: string;
}

export interface TimeSeriesParams extends ReportFilters {
  from?: string;
  to?: string;
}

/** 'export' is the full report: every section in one workbook / PDF. */
export type ReportKind = 'export' | 'status' | 'projects' | 'workload' | 'timeseries';
export type ReportFormat = 'csv' | 'xlsx' | 'pdf';

function queryString(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function reportsApi(client: ApiClient) {
  return {
    projectPerformance: (f: ReportFilters = {}) =>
      client.get<{ data: ProjectPerformanceRow[] }>(`/reports/projects${queryString({ projectId: f.projectId, userId: f.userId })}`).then((r) => r.data),
    status: (f: ReportFilters = {}) =>
      client.get<{ data: Record<string, number> }>(`/reports/status${queryString({ projectId: f.projectId, userId: f.userId })}`).then((r) => r.data),
    workload: (f: ReportFilters = {}) =>
      client.get<{ data: UserWorkloadRow[] }>(`/reports/workload${queryString({ projectId: f.projectId, userId: f.userId })}`).then((r) => r.data),
    completion: (f: ReportFilters = {}) =>
      client.get<{ data: CompletionStats }>(`/reports/completion${queryString({ projectId: f.projectId, userId: f.userId })}`).then((r) => r.data),
    /** Daily time series: completion, overdue trend, burndown + weekly velocity over a date range. */
    timeSeries: (params: TimeSeriesParams = {}) =>
      client
        .get<{ data: TimeSeriesResult }>(
          `/reports/timeseries${queryString({ from: params.from, to: params.to, projectId: params.projectId, userId: params.userId })}`,
        )
        .then((r) => r.data),
    /** Download a report in the given format; `params` (filters, and the time series' range) become query args. */
    exportFile: (kind: ReportKind, format: ReportFormat, params: Record<string, string | undefined> = {}) =>
      client.getBlob(`/reports/${kind}.${format}${queryString(params)}`),
  };
}
