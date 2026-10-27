import type { ApiClient } from '../lib/api-client';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export type Rag = 'RED' | 'AMBER' | 'GREEN';
export type ManagementScope = 'ALL' | 'RUN';

/** The page's filters, as kept in the address. */
export interface ManagementFilters {
  projectIds: string[];
  ownerId: string | null;
  statuses: ProjectStatus[];
  weeks: 4 | 12 | 26;
}

export interface RagReason {
  code: 'MILESTONE_LATE' | 'MANY_LATE' | 'LATE_TASKS' | 'MANY_MISSING_CHECKS' | 'MISSING_CHECKS' | 'NO_ACTIVITY' | 'ON_TRACK';
  level: Rag;
  text: string;
}

export interface OptionProject {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  color: string;
  icon: string | null;
  imageUrl: string | null;
}

export interface HealthRow extends OptionProject {
  owner: { id: string; name: string } | null;
  total: number;
  done: number;
  open: number;
  late: number;
  completionPct: number;
  nextMilestone: { id: string; key: string; title: string; due: string | null; daysLeft: number | null } | null;
  lateMilestones: number;
  lastActivityAt: string;
  missingChecks: number;
  checksDue: number;
  checksDone: number;
  checksDoneLate: number;
  openFollowUps: number;
  rag: Rag;
  reasons: RagReason[];
}

export interface PersonRow {
  id: string;
  name: string;
  avatarUrl: string | null;
  lateTasks: number;
  overloadedDays: { date: string; count: number; limit: number }[];
  openActions: number;
  overdueActions: number;
}

export interface TrendRow {
  start: string;
  end: string;
  label: string;
  current: boolean;
  created: number;
  completed: number;
  late: number;
  passed: number;
  failed: number;
  passRate: number | null;
}

export interface ManagementOverview {
  scope: ManagementScope;
  generatedAt: string;
  timeZone: string;
  today: string;
  weekStart: 0 | 1 | 6;
  filters: ManagementFilters;
  period: { from: string; to: string; weeks: number };
  options: { projects: OptionProject[]; owners: { id: string; name: string }[] };
  tiles: {
    projects: number;
    red: number;
    amber: number;
    green: number;
    lateTasks: number;
    missingChecks: number;
    checksDue: number;
    checksDone: number;
    checksDoneLate: number;
    passRate: number | null;
    openFollowUps: number;
    overloadedPeople: number;
  };
  projects: HealthRow[];
  inspections: {
    due: number;
    done: number;
    doneLate: number;
    noReport: number;
    missing: number;
    finished: number;
    passed: number;
    failed: number;
    passRate: number | null;
    openFollowUps: number;
    topItems: { formId: string | null; itemId: string; label: string; formTitle: string; failures: number }[];
    topForms: { formId: string | null; title: string; finished: number; withFailures: number; failedItems: number }[];
  };
  people: PersonRow[];
  workload: { week: string; limit: number; workingDays: number[] };
  trends: TrendRow[];
}

export type ItemMetric =
  | 'late-tasks'
  | 'late-milestones'
  | 'missing-checks'
  | 'checks-due'
  | 'checks-done'
  | 'checks-done-late'
  | 'checks-no-report'
  | 'follow-ups'
  | 'inspections'
  | 'failed-item'
  | 'person-overloaded'
  | 'person-actions'
  | 'projects'
  | 'people-overloaded';

/** Which list behind a number to show. */
export interface ItemQuery {
  metric: ItemMetric;
  projectId?: string;
  personId?: string;
  formId?: string;
  itemId?: string;
  rag?: Rag;
}

export interface ItemRow {
  kind: 'task' | 'inspection' | 'action' | 'project' | 'person';
  id: string;
  title: string;
  key?: string | null;
  project?: { id: string; code: string; name: string } | null;
  due?: string | null;
  daysLate?: number | null;
  people?: string[];
  detail?: string | null;
  tone?: 'danger' | 'warning' | 'success' | 'neutral';
  meetingId?: string | null;
  taskId?: string | null;
  at?: string | null;
}

export interface ItemList {
  metric: ItemMetric;
  title: string;
  total: number;
  limit: number;
  rows: ItemRow[];
}

/** The filters as the API reads them (the defaults left out). */
export function filterParams(f: ManagementFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.projectIds.length) q.set('projectIds', f.projectIds.join(','));
  if (f.ownerId) q.set('ownerId', f.ownerId);
  q.set('status', f.statuses.join(','));
  q.set('weeks', String(f.weeks));
  return q;
}

export const MANAGEMENT_ROOT = ['management'] as const;
export const managementAccessKey = [...MANAGEMENT_ROOT, 'access'] as const;
export const managementOverviewKey = (f: ManagementFilters) => [...MANAGEMENT_ROOT, 'overview', filterParams(f).toString()] as const;
export const managementItemsKey = (f: ManagementFilters, q: ItemQuery) => [...MANAGEMENT_ROOT, 'items', filterParams(f).toString(), JSON.stringify(q)] as const;

export function managementApi(client: ApiClient) {
  return {
    access: () => client.get<{ data: { allowed: boolean; scope: ManagementScope | null } }>('/management/access').then((r) => r.data),
    overview: (f: ManagementFilters) => client.get<{ data: ManagementOverview }>(`/management/overview?${filterParams(f)}`).then((r) => r.data),
    items: (f: ManagementFilters, q: ItemQuery) => {
      const params = filterParams(f);
      for (const [k, v] of Object.entries(q)) if (v) params.set(k, String(v));
      return client.get<{ data: ItemList }>(`/management/items?${params}`).then((r) => r.data);
    },
    /** The branded PDF (the server names the file). */
    pdf: (f: ManagementFilters) => client.getBlob(`/management/overview.pdf?${filterParams(f)}`),
  };
}
