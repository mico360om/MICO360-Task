import type { ApiClient } from '../lib/api-client';
import type { ProjectStatus } from './projects';
import type { Priority } from './tasks';
import type { WeekStart } from '../lib/calendar';

/** Where a project stands against its dates. */
export type ProjectHealth = 'on-track' | 'at-risk' | 'late' | 'no-target';

export interface TimelineMilestone {
  id: string;
  key: string;
  title: string;
  /** Its due day ('YYYY-MM-DD'), or null. */
  date: string | null;
  /** Reached: its task is done. */
  done: boolean;
}

export interface TimelineMeeting {
  id: string;
  title: string;
  startAt: string;
  /** Its day in company time. */
  day: string;
}

export interface TimelineProject {
  id: string;
  code: string;
  name: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  status: ProjectStatus;
  owner: { id: string; name: string; avatarUrl: string | null } | null;
  /** The bar's first day: the start date, else the day it was created. */
  start: string;
  startIsCreated: boolean;
  target: string | null;
  tasks: { total: number; done: number; open: number; overdue: number };
  /** Share done, rounded as on the Projects page (99 until every task is done). */
  progress: number;
  /** Share of the time from start to target gone (0–100); null without a target. */
  timeUsed: number | null;
  health: ProjectHealth;
  daysLate: number;
  /** Open tasks due in each shown week. */
  dueByWeek: number[];
  milestones: TimelineMilestone[];
  nextMilestone: TimelineMilestone | null;
  /** Milestones not reached yet, due from today to 30 days on. */
  milestonesSoon: number;
  meetings: TimelineMeeting[];
  meetingsThisWeek: number;
}

export interface TimelineData {
  from: string;
  to: string;
  weekStart: WeekStart;
  today: string;
  currentWeek: string;
  weeks: string[];
  projects: TimelineProject[];
}

export type WorkloadSuggestion =
  | { kind: 'reassign'; to: { id: string; name: string }; count: number }
  | { kind: 'move'; date: string; count: number };

export interface WorkloadTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  priority: Priority;
  version: number;
  suggestion: WorkloadSuggestion | null;
}

export interface WorkloadCell {
  date: string;
  count: number;
  /** The daily limit on a working day; 0 on a day off. */
  limit: number;
  over: number;
  /** Suggested ones first. */
  tasks: WorkloadTask[];
}

export interface WorkloadPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  me: boolean;
  overdue: number;
  total: number;
  weekLimit: number;
  days: WorkloadCell[];
}

export interface WorkloadProject {
  id: string;
  code: string;
  name: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
}

export interface WorkloadData {
  week: string;
  today: string;
  days: { date: string; working: boolean }[];
  limit: number;
  canChangeLimit: boolean;
  /** everyone: an administrator; teams: a project manager; self: anyone else. */
  scope: 'everyone' | 'teams' | 'self';
  projectId: string | null;
  projects: WorkloadProject[];
  people: WorkloadPerson[];
}

/** Under these roots, so any task change refreshes the pages (lib/task-cache). */
export const timelineKey = (from: string, to: string, weekStart: WeekStart) => ['timeline', from, to, weekStart] as const;
export const workloadKey = (week: string, projectId: string) => ['workload', week, projectId] as const;

export function planningApi(client: ApiClient) {
  return {
    timeline: (q: { from: string; to: string; weekStart: WeekStart }) =>
      client.get<{ data: TimelineData }>(`/timeline?from=${q.from}&to=${q.to}&weekStart=${q.weekStart}`).then((r) => r.data),
    workload: (q: { week: string; projectId?: string }) =>
      client.get<{ data: WorkloadData }>(`/workload?week=${q.week}${q.projectId ? `&projectId=${encodeURIComponent(q.projectId)}` : ''}`).then((r) => r.data),
  };
}
