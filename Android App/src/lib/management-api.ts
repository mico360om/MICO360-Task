/**
 * Management's requests and the server's types (Stage 3 Task 6): a copy of the website's
 * frontend/src/api/management.ts — the same field names (drift-tested), the same query for the same
 * filters, the payload unwrapped from `{ data }`. Every request takes the person it is for
 * (`CallOpts.asUser`), so on a shared phone an answer for someone who has signed out is never sent
 * or kept as the next person's.
 */
import type { ApiClient, CallOpts } from './api-client';
import type { Envelope } from './types';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
export type Rag = 'RED' | 'AMBER' | 'GREEN';
export type ManagementScope = 'ALL' | 'RUN';

/** The page's filters. */
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
  /** `waiting`: it waits for approval — never late meanwhile (an older server sends none). */
  nextMilestone: { id: string; key: string; title: string; due: string | null; daysLeft: number | null; waiting?: boolean } | null;
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
  /** Tasks waiting for approval: in all, and per project (most first). Older servers leave it out. */
  approvals?: { total: number; projects: { id: string; code: string; name: string; count: number }[] };
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
  | 'overdue-actions'
  | 'failed-form'
  | 'projects'
  | 'people-overloaded'
  | 'awaiting-approval';

/** Which list behind a number to show. */
export interface ItemQuery {
  metric: ItemMetric;
  projectId?: string;
  personId?: string;
  formId?: string;
  itemId?: string;
  rag?: Rag;
  /** inspections: only those with a failed item. */
  failed?: boolean;
}

export interface ItemRow {
  /** 'day': one overloaded day of a person, with its tasks. */
  kind: 'task' | 'inspection' | 'action' | 'project' | 'person' | 'day';
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
  /** A failed answer's inspection (its row id is the inspection and the item). */
  inspectionId?: string | null;
  /** An overloaded day's tasks. */
  tasks?: { id: string; key: string; title: string }[];
}

export interface ItemList {
  metric: ItemMetric;
  title: string;
  total: number;
  limit: number;
  rows: ItemRow[];
}

const pair = (k: string, v: string) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;

/**
 * The filters (and a list's query) as the API reads them — the website's `filterParams` plus the
 * list's own fields: `projectIds` when any are chosen, `ownerId` when set, `status` and `weeks`
 * always, then each field of `q` that is set (`true` as '1'). Built by hand with
 * encodeURIComponent (React Native's query-string class has no get/set); no leading "?".
 */
export function managementQuery(f: ManagementFilters, q?: ItemQuery): string {
  const parts: string[] = [];
  if (f.projectIds.length) parts.push(pair('projectIds', f.projectIds.join(',')));
  if (f.ownerId) parts.push(pair('ownerId', f.ownerId));
  parts.push(pair('status', f.statuses.join(',')));
  parts.push(pair('weeks', String(f.weeks)));
  for (const [k, v] of Object.entries(q ?? {})) if (v) parts.push(pair(k, v === true ? '1' : String(v)));
  return parts.join('&');
}

export function managementApi(client: ApiClient) {
  return {
    /** May the signed-in person open Management (an administrator, or someone who runs a project)? */
    access: (o?: CallOpts) => client.get<Envelope<{ allowed: boolean; scope: ManagementScope | null }>>('/management/access', o).then((r) => r.data),
    overview: (f: ManagementFilters, o?: CallOpts) => client.get<Envelope<ManagementOverview>>(`/management/overview?${managementQuery(f)}`, o).then((r) => r.data),
    /** The list behind a number, with the same filters (a number N opens N rows, the first `limit` sent). */
    items: (f: ManagementFilters, q: ItemQuery, o?: CallOpts) => client.get<Envelope<ItemList>>(`/management/items?${managementQuery(f, q)}`, o).then((r) => r.data),
    /** The branded PDF's path, for the app's exporter (the server names the file). */
    pdfPath: (f: ManagementFilters) => `/management/overview.pdf?${managementQuery(f)}`,
  };
}
