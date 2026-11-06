import type { ApiClient } from '../lib/api-client';
import type { Priority, RecurrenceRule, ApiTask } from './tasks';

/**
 * 1.23.4 Smarter Dashboard: "My Priorities Today" (GET /dashboard/priorities) and the widget arrangement
 * (GET/PUT /users/me/dashboard-layout; administrators' two defaults: GET/PUT /settings/dashboard-default).
 * The server decides every row and what may be done with it; these are its shapes.
 */

/** Why a row is on the list (server: modules/dashboard/priorities.ts). Days are company days. */
export type PriorityReason =
  | { code: 'overdue'; days: number }
  | { code: 'approval'; since: string | null }
  | { code: 'blocking'; count: number }
  | { code: 'due-today' }
  | { code: 'urgent' }
  | { code: 'team-overdue'; days: number }
  | { code: 'team-blocked' }
  | { code: 'unassigned' }
  | { code: 'blocked-status' }
  | { code: 'blocked-by'; blockers: { id: string; key: string }[] }
  | { code: 'due-soon'; days: number };

export const PRIORITY_CHIPS = ['overdue', 'today', 'approvals', 'blocked', 'upcoming', 'team'] as const;
export type PriorityChip = (typeof PRIORITY_CHIPS)[number];

export interface PriorityProject {
  id: string;
  code: string;
  name: string;
  color: string | null;
  icon: string | null;
  imageUrl: string | null;
}

/** A task row (own, a team row, or one waiting for approval). Dates are 'YYYY-MM-DD'. */
export interface PriorityTask {
  id: string;
  key: string;
  title: string;
  priority: Priority;
  dueDate: string | null;
  startDate: string | null;
  /** The start date as stored (put back by an Undo of a reschedule that moved it). */
  startAt: string | null;
  version: number;
  columnId: string;
  project: PriorityProject;
  assignees: { id: string; name: string }[];
  blockers: { id: string; key: string }[];
  doneColumnId: string | null;
  recurrenceRule: RecurrenceRule | null;
  can: { complete: boolean; reschedule: boolean; assign: boolean; approve: boolean };
  requestedBy?: { id: string; name: string } | null;
  requestedAt?: string | null;
}

export interface PriorityActionItem {
  id: string;
  description: string;
  dueDate: string | null;
  priority: Priority;
  status: string;
  meeting: { id: string; title: string } | null;
  projectId: string | null;
  can: { done: boolean; reschedule: boolean };
}

/** 1.23.3: a checklist item assigned to the person, on its task. */
export interface PriorityChecklistItem {
  id: string;
  text: string;
  dueDate: string | null;
  task: { id: string; key: string; title: string; projectId: string };
  can: { tick: boolean; reschedule: boolean };
}

export interface PriorityRow {
  id: string;
  kind: 'task' | 'approval' | 'action-item' | 'checklist-item';
  reason: PriorityReason;
  also: PriorityReason[];
  chips: PriorityChip[];
  group: number;
  task?: PriorityTask;
  actionItem?: PriorityActionItem;
  checklistItem?: PriorityChecklistItem;
}

export interface PrioritiesAnswer {
  today: string;
  timeZone: string;
  manager: boolean;
  items: PriorityRow[];
  total: number;
  counts: Record<'all' | PriorityChip, number>;
  watch: string[];
}

export const WIDGET_IDS = ['priorities', 'stats', 'open-tasks', 'approvals', 'due-soon', 'activity', 'status-chart', 'completion'] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];
export type WidgetSize = 'small' | 'wide';
export interface WidgetPlace {
  id: WidgetId;
  hidden: boolean;
  size: WidgetSize;
}
export interface DashboardLayout {
  widgets: WidgetPlace[];
}
export type LayoutGroup = 'admins' | 'everyone';

export interface MyLayoutAnswer {
  layout: DashboardLayout;
  /** False: they follow their group's default. */
  customized: boolean;
  group: LayoutGroup;
  /** The widgets they may see, in catalogue order. */
  widgets: WidgetId[];
  /** Their group's default as it applies to them (what Reset to default gives). */
  defaultLayout: DashboardLayout;
}

export interface DefaultsAnswer {
  admins: DashboardLayout;
  everyone: DashboardLayout;
}

/** A reschedule: the new due day, and the start date / repeat rule when they move with it. */
export interface ReschedulePatch {
  dueDate: string | null;
  startDate?: string | null;
  recurrenceRule?: RecurrenceRule | null;
  expectedVersion?: number;
}

export const PRIORITIES_KEY = ['dashboard-priorities'] as const;
export const MY_LAYOUT_KEY = ['dashboard-layout'] as const;
export const LAYOUT_DEFAULTS_KEY = ['dashboard-layout-defaults'] as const;

export function dashboardApi(client: ApiClient) {
  return {
    /** `fresh`: right after the person's own change (the server's 30-second copy is skipped). */
    priorities: (fresh = false) => client.get<{ data: PrioritiesAnswer }>(`/dashboard/priorities${fresh ? '?fresh=1' : ''}`).then((r) => r.data),
    myLayout: () => client.get<{ data: MyLayoutAnswer }>('/users/me/dashboard-layout').then((r) => r.data),
    /** null: Reset to default. */
    saveMyLayout: (layout: DashboardLayout | null) => client.put<{ data: MyLayoutAnswer }>('/users/me/dashboard-layout', { layout }).then((r) => r.data),
    defaults: () => client.get<{ data: DefaultsAnswer }>('/settings/dashboard-default').then((r) => r.data),
    /** Administrators: a group's default (null: back to the built-in one). */
    saveDefault: (group: LayoutGroup, layout: DashboardLayout | null) => client.put<{ data: DefaultsAnswer }>('/settings/dashboard-default', { group, layout }).then((r) => r.data),
    /** A task's new due day (PUT /tasks/:id — the server's rules as for any edit). */
    reschedule: (taskId: string, patch: ReschedulePatch) => client.put<{ data: ApiTask }>(`/tasks/${taskId}`, patch).then((r) => r.data),
  };
}
