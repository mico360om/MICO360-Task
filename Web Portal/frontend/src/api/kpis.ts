import type { ApiClient } from '../lib/api-client';
import type { ManagementFilters, ProjectStatus } from './management';
import { filterParams } from './management';

/**
 * Project KPIs and User KPIs (GET /kpis/…): a project's KPIs (its KPIs tab), the Management page's KPI
 * table, a person's KPIs (My performance; a manager's or an administrator's view of a person), the list
 * behind each number, the company default targets (administrators), a project's target overrides and its
 * own KPIs (whoever runs it). Files: the project KPI PDF and Excel, the Management KPI Excel and PDF.
 */

export type KpiMetric =
  | 'onTime'
  | 'overdue'
  | 'daysLate'
  | 'progress'
  | 'throughput'
  | 'cycleTime'
  | 'approvalTurnaround'
  | 'blocked'
  | 'completed'
  | 'userOverdue'
  | 'workload'
  | 'responsiveness'
  | 'actionItems';
export type KpiUnit = 'percent' | 'days' | 'hours' | 'tasks' | 'perWeek' | 'items';
export type KpiLight = 'green' | 'amber' | 'red' | 'none' | 'nodata';
export type TargetSource = 'project' | 'company' | 'site' | 'default';
export type PeriodKind = 'week' | 'month' | 'quarter' | 'custom';

export interface KpiPeriodAsk {
  kind: PeriodKind;
  from?: string;
  to?: string;
}

export interface KpiPeriod {
  kind: PeriodKind;
  from: string;
  to: string;
  end: string;
  label: string;
}

export interface KpiTile {
  metric: KpiMetric;
  label: string;
  help: string;
  unit: KpiUnit;
  direction: 'higher' | 'lower';
  value: number | null;
  detail: string | null;
  target: number | null;
  amberBand: number | null;
  targetSource: TargetSource;
  light: KpiLight;
  words: string;
  trend: (number | null)[];
  list: boolean;
}

export interface TrendPoint {
  key: string;
  label: string;
  current: boolean;
  rebuilt: boolean;
}

export interface CustomKpiView {
  id: string;
  name: string;
  unit: string;
  direction: 'HIGHER' | 'LOWER';
  target: number | null;
  amberBand: number | null;
  values: { month: string; value: number | null; note: string | null }[];
  latest: { month: string; value: number } | null;
  light: KpiLight;
  words: string;
  due: string | null;
}

export interface KpiProjectRef {
  id: string;
  code: string;
  name: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
}

export interface ProjectKpis {
  project: KpiProjectRef & { status: ProjectStatus; archived: boolean; companyId: string | null };
  period: KpiPeriod;
  today: string;
  timeZone: string;
  generatedAt: string;
  trend: { kind: 'month' | 'week'; points: TrendPoint[] };
  tiles: KpiTile[];
  custom: CustomKpiView[];
  can: { manage: boolean };
}

export interface PersonKpis {
  person: { id: string; name: string; avatarUrl: string | null; active: boolean };
  scope: 'self' | 'admin' | 'manager';
  projects: KpiProjectRef[];
  period: KpiPeriod;
  today: string;
  timeZone: string;
  generatedAt: string;
  trend: { kind: 'month' | 'week'; points: TrendPoint[] };
  tiles: KpiTile[];
  workload: { openTasks: number; plannedHours: number | null; capacityHours: number; meetingHours: number };
}

export interface ManagementKpis {
  scope: 'ALL' | 'RUN';
  period: KpiPeriod;
  today: string;
  timeZone: string;
  generatedAt: string;
  metrics: { metric: KpiMetric; label: string; unit: KpiUnit; direction: 'higher' | 'lower' }[];
  rows: {
    project: KpiProjectRef & { status: ProjectStatus };
    owner: { id: string; name: string } | null;
    figures: Record<string, { value: number | null; light: KpiLight; words: string; target: number | null }>;
  }[];
}

export interface KpiItemRow {
  kind: 'task' | 'actionItem';
  id: string;
  key: string | null;
  title: string;
  projectId: string | null;
  due: string | null;
  doneDay: string | null;
  days: number | null;
  hours: number | null;
  people: string[];
  peopleNames: string[];
  detail: string;
  tone: 'success' | 'danger' | 'warning' | 'neutral';
  meetingId?: string | null;
  project: { id: string; code: string; name: string } | null;
}

export interface KpiItems {
  metric: KpiMetric;
  title: string;
  total: number;
  limit: number;
  rows: KpiItemRow[];
}

export interface TargetEntry {
  metric: KpiMetric;
  label: string;
  unit: KpiUnit;
  direction: 'higher' | 'lower';
  builtIn: number | null;
  target: number | null;
  amberBand: number | null;
  source: TargetSource;
  /** Set at this level (not inherited). */
  own: boolean;
}

export interface CompanyTargets {
  companies: { id: string; name: string }[];
  companyId: string | null;
  metrics: TargetEntry[];
}

export interface ProjectTargets {
  projectId: string;
  companyId: string | null;
  metrics: TargetEntry[];
}

/** One change: a number (or null: "no target here"), an own amber band, or `inherit` (back to the level up). */
export interface TargetChange {
  metric: KpiMetric;
  target?: number | null;
  amberBand?: number | null;
  inherit?: boolean;
}

export interface CustomKpiInput {
  name: string;
  unit: string;
  direction: 'HIGHER' | 'LOWER';
  target: number | null;
  amberBand: number | null;
}

export function periodParams(p: KpiPeriodAsk): URLSearchParams {
  const q = new URLSearchParams();
  q.set('period', p.kind);
  if (p.kind === 'custom') {
    if (p.from) q.set('from', p.from);
    if (p.to) q.set('to', p.to);
  }
  return q;
}
const periodKey = (p: KpiPeriodAsk) => periodParams(p).toString();

export const KPI_ROOT = ['kpis'] as const;
export const projectKpisKey = (projectId: string, p: KpiPeriodAsk) => [...KPI_ROOT, 'project', projectId, periodKey(p)] as const;
export const projectKpiItemsKey = (projectId: string, metric: string, p: KpiPeriodAsk) => [...KPI_ROOT, 'project-items', projectId, metric, periodKey(p)] as const;
export const projectTargetsKey = (projectId: string) => [...KPI_ROOT, 'project-targets', projectId] as const;
export const personKpisKey = (userId: string, p: KpiPeriodAsk) => [...KPI_ROOT, 'person', userId, periodKey(p)] as const;
export const personKpiItemsKey = (userId: string, metric: string, p: KpiPeriodAsk) => [...KPI_ROOT, 'person-items', userId, metric, periodKey(p)] as const;
export const managementKpisKey = (f: ManagementFilters, p: KpiPeriodAsk) => [...KPI_ROOT, 'management', filterParams(f).toString(), periodKey(p)] as const;
export const companyTargetsKey = (companyId: string | null) => [...KPI_ROOT, 'targets', companyId ?? ''] as const;

const enc = encodeURIComponent;

export function kpisApi(client: ApiClient) {
  return {
    project: (projectId: string, p: KpiPeriodAsk) => client.get<{ data: ProjectKpis }>(`/kpis/projects/${enc(projectId)}?${periodParams(p)}`).then((r) => r.data),
    projectItems: (projectId: string, metric: string, p: KpiPeriodAsk) => {
      const q = periodParams(p);
      q.set('metric', metric);
      return client.get<{ data: KpiItems }>(`/kpis/projects/${enc(projectId)}/items?${q}`).then((r) => r.data);
    },
    projectPdf: (projectId: string, p: KpiPeriodAsk) => client.getBlob(`/kpis/projects/${enc(projectId)}/export.pdf?${periodParams(p)}`),
    projectXlsx: (projectId: string, p: KpiPeriodAsk) => client.getBlob(`/kpis/projects/${enc(projectId)}/export.xlsx?${periodParams(p)}`),
    projectTargets: (projectId: string) => client.get<{ data: ProjectTargets }>(`/kpis/projects/${enc(projectId)}/targets`).then((r) => r.data),
    saveProjectTargets: (projectId: string, targets: TargetChange[]) => client.put<{ data: ProjectTargets }>(`/kpis/projects/${enc(projectId)}/targets`, { targets }).then((r) => r.data),
    addCustom: (projectId: string, input: CustomKpiInput) => client.post<{ data: CustomKpiView[] }>(`/kpis/projects/${enc(projectId)}/custom`, input).then((r) => r.data),
    editCustom: (projectId: string, kpiId: string, input: Partial<CustomKpiInput>) => client.patch<{ data: CustomKpiView[] }>(`/kpis/projects/${enc(projectId)}/custom/${enc(kpiId)}`, input).then((r) => r.data),
    removeCustom: (projectId: string, kpiId: string) => client.del<{ data: CustomKpiView[] }>(`/kpis/projects/${enc(projectId)}/custom/${enc(kpiId)}`).then((r) => r.data),
    setValue: (projectId: string, kpiId: string, month: string, value: number, note: string | null) =>
      client.put<{ data: CustomKpiView[] }>(`/kpis/projects/${enc(projectId)}/custom/${enc(kpiId)}/values/${enc(month)}`, { value, note }).then((r) => r.data),
    clearValue: (projectId: string, kpiId: string, month: string) => client.del<{ data: CustomKpiView[] }>(`/kpis/projects/${enc(projectId)}/custom/${enc(kpiId)}/values/${enc(month)}`).then((r) => r.data),
    management: (f: ManagementFilters, p: KpiPeriodAsk) => client.get<{ data: ManagementKpis }>(`/kpis/management?${withPeriod(filterParams(f), p)}`).then((r) => r.data),
    managementXlsx: (f: ManagementFilters, p: KpiPeriodAsk) => client.getBlob(`/kpis/management.xlsx?${withPeriod(filterParams(f), p)}`),
    managementPdf: (f: ManagementFilters, p: KpiPeriodAsk) => client.getBlob(`/kpis/management.pdf?${withPeriod(filterParams(f), p)}`),
    me: (p: KpiPeriodAsk) => client.get<{ data: PersonKpis }>(`/kpis/people/me?${periodParams(p)}`).then((r) => r.data),
    person: (userId: string, p: KpiPeriodAsk) => client.get<{ data: PersonKpis }>(`/kpis/people/${enc(userId)}?${periodParams(p)}`).then((r) => r.data),
    personItems: (userId: string, metric: string, p: KpiPeriodAsk) => {
      const q = periodParams(p);
      q.set('metric', metric);
      return client.get<{ data: KpiItems }>(`/kpis/people/${enc(userId)}/items?${q}`).then((r) => r.data);
    },
    companyTargets: (companyId: string | null) => client.get<{ data: CompanyTargets }>(`/kpis/targets${companyId ? `?companyId=${enc(companyId)}` : ''}`).then((r) => r.data),
    saveCompanyTargets: (companyId: string | null, targets: TargetChange[]) => client.put<{ data: CompanyTargets }>('/kpis/targets', { companyId, targets }).then((r) => r.data),
  };
}

function withPeriod(q: URLSearchParams, p: KpiPeriodAsk): URLSearchParams {
  for (const [k, v] of periodParams(p)) q.set(k, v);
  return q;
}
