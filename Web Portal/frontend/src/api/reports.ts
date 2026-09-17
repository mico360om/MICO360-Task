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

export interface TimeSeriesParams {
  from?: string;
  to?: string;
  projectId?: string;
}

export type ReportKind = 'status' | 'projects' | 'workload' | 'timeseries';
export type ReportFormat = 'csv' | 'xls' | 'pdf';

function queryString(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export function reportsApi(client: ApiClient) {
  return {
    projectPerformance: () => client.get<{ data: ProjectPerformanceRow[] }>('/reports/projects').then((r) => r.data),
    status: () => client.get<{ data: Record<string, number> }>('/reports/status').then((r) => r.data),
    workload: () => client.get<{ data: UserWorkloadRow[] }>('/reports/workload').then((r) => r.data),
    completion: () => client.get<{ data: CompletionStats }>('/reports/completion').then((r) => r.data),
    /** Daily time series: completion, overdue trend, burndown + weekly velocity over a date range. */
    timeSeries: (params: TimeSeriesParams = {}) =>
      client
        .get<{ data: TimeSeriesResult }>(`/reports/timeseries${queryString({ from: params.from, to: params.to, projectId: params.projectId })}`)
        .then((r) => r.data),
    /** Download a report in the given format; `params` become query args (used by the time series). */
    exportFile: (kind: ReportKind, format: ReportFormat, params: Record<string, string | undefined> = {}) =>
      client.getBlob(`/reports/${kind}.${format}${queryString(params)}`),
  };
}
