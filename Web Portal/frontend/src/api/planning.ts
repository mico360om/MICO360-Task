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
  /** The bar's first day: its own start date, else its tasks' earliest date, else the day it was created. */
  start: string;
  startFrom: 'project' | 'tasks' | 'created';
  startIsCreated: boolean;
  /** Its own target date, else its tasks' latest due date, or null. */
  target: string | null;
  targetFrom: 'project' | 'tasks' | null;
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
  /** How many milestones it has (shown or not). */
  milestoneCount: number;
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

/** A task on a project's expanded row: a bar from its start to its due day, or a marker on its due day. */
export interface TimelineTask {
  id: string;
  key: string;
  title: string;
  start: string | null;
  due: string;
  done: boolean;
  overdue: boolean;
  priority: Priority;
  isMilestone: boolean;
  assignees: { id: string; name: string }[];
}

export interface TimelineTasksData {
  projectId: string;
  from: string;
  to: string;
  today: string;
  /** How many tasks the lane holds (open overdue ones and those in the shown weeks); more than `tasks` when rows were cut. */
  matched: number;
  /** Every open task of the project. */
  open: number;
  /** Its open tasks without a due date. */
  undated: number;
  /** At most 30: open overdue first, then open ones in the shown weeks, then done ones there. */
  tasks: TimelineTask[];
}

/** A teammate's number that day comes only to an administrator (who sees all their tasks); else null. */
export type WorkloadSuggestion =
  | { kind: 'reassign'; to: { id: string; name: string }; count: number | null }
  | { kind: 'move'; date: string };

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

/**
 * The Timeline's data, under ['projects'] so a project saved anywhere refreshes it (task changes do
 * too, lib/task-cache); with the company day, so it is read again when the day changes.
 */
export const TIMELINE_ROOT = ['projects', 'timeline'] as const;
export const timelineKey = (from: string, to: string, weekStart: WeekStart, today: string) => [...TIMELINE_ROOT, from, to, weekStart, today] as const;
/** A project's task rows, under the timeline's root so task and project changes refresh them. */
export const timelineTasksKey = (projectId: string, from: string, to: string, today: string) => [...TIMELINE_ROOT, 'tasks', projectId, from, to, today] as const;
/** The Workload's data (refreshed by task changes and by the daily limit or working hours changing), with the company day. */
export const workloadKey = (week: string, projectId: string, today: string) => ['workload', week, projectId, today] as const;

export function planningApi(client: ApiClient) {
  return {
    timeline: (q: { from: string; to: string; weekStart: WeekStart }) =>
      client.get<{ data: TimelineData }>(`/timeline?from=${q.from}&to=${q.to}&weekStart=${q.weekStart}`).then((r) => r.data),
    timelineTasks: (projectId: string, q: { from: string; to: string }) =>
      client.get<{ data: TimelineTasksData }>(`/timeline/projects/${encodeURIComponent(projectId)}/tasks?from=${q.from}&to=${q.to}`).then((r) => r.data),
    workload: (q: { week: string; projectId?: string }) =>
      client.get<{ data: WorkloadData }>(`/workload?week=${q.week}${q.projectId ? `&projectId=${encodeURIComponent(q.projectId)}` : ''}`).then((r) => r.data),
  };
}
