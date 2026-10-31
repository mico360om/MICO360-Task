/**
 * Timeline and Workload (Stage 3): the server's types and requests, as the website's
 * frontend/src/api/planning.ts names them (lib/planning-api.test.ts compares the fields), each
 * unwrapped from `{ data }`. Every request takes the person it is for (CallOpts `asUser`) last.
 */
import type { ApiClient, CallOpts } from './api-client';
import type { WeekStart } from './calendar';
import type { ApiAssignee, ApiProject, Envelope, Priority } from './types';

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
  /** Finished but waiting for approval: never overdue while it waits (an older server sends none). */
  waiting?: boolean;
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
  status: ApiProject['status'];
  owner: { id: string; name: string; avatarUrl: string | null } | null;
  /** The bar's first day: its own start date, else its tasks' earliest date, else the day it was created. */
  start: string;
  startFrom: 'project' | 'tasks' | 'created';
  startIsCreated: boolean;
  /** Its own target date, else its tasks' latest due date, or null. */
  target: string | null;
  targetFrom: 'project' | 'tasks' | null;
  tasks: { total: number; done: number; open: number; overdue: number };
  /** Share done, rounded as on the Projects page (99 until every task is done) — shown as sent. */
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

/** A task on a project's opened row. */
export interface TimelineTask {
  id: string;
  key: string;
  title: string;
  start: string | null;
  due: string;
  done: boolean;
  /** As the server counts it (never while waiting for approval). */
  overdue: boolean;
  priority: Priority;
  isMilestone: boolean;
  assignees: { id: string; name: string }[];
  /** Finished but waiting for approval (task approvals). Missing from an older server = no. */
  waiting?: boolean;
}

export interface TimelineTasksData {
  projectId: string;
  from: string;
  to: string;
  today: string;
  /** How many tasks the lane holds; more than `tasks` when rows were cut. */
  matched: number;
  /** Every open task of the project. */
  open: number;
  /** Its open tasks without a due date. */
  undated: number;
  /** At most 30: open overdue first, then open ones in the shown weeks, then done ones there. */
  tasks: TimelineTask[];
}

/** A teammate's number that day comes only to an administrator; else null. */
export type WorkloadSuggestion =
  | { kind: 'reassign'; to: { id: string; name: string }; count: number | null }
  | { kind: 'move'; date: string };

export interface WorkloadTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  priority: Priority;
  /** The copy shown: a suggestion is sent with it, so the server refuses it when the task changed since. */
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

const enc = encodeURIComponent;

export function planningApi(client: ApiClient) {
  const data = <T>(p: Promise<Envelope<T>>) => p.then((r) => r.data);
  return {
    timeline: (q: { from: string; to: string; weekStart: WeekStart }, o?: CallOpts): Promise<TimelineData> =>
      data(client.get<Envelope<TimelineData>>(`/timeline?from=${enc(q.from)}&to=${enc(q.to)}&weekStart=${enc(String(q.weekStart))}`, o)),
    timelineTasks: (projectId: string, q: { from: string; to: string }, o?: CallOpts): Promise<TimelineTasksData> =>
      data(client.get<Envelope<TimelineTasksData>>(`/timeline/projects/${enc(projectId)}/tasks?from=${enc(q.from)}&to=${enc(q.to)}`, o)),
    workload: (q: { week: string; projectId?: string }, o?: CallOpts): Promise<WorkloadData> =>
      data(client.get<Envelope<WorkloadData>>(`/workload?week=${enc(q.week)}${q.projectId ? `&projectId=${enc(q.projectId)}` : ''}`, o)),
    /** Give the task from one person to another — refused (409) when the task changed since `expectedVersion`. */
    swapAssignee: (taskId: string, body: { from: string; to: string; expectedVersion: number }, o?: CallOpts): Promise<ApiAssignee[]> =>
      data(client.post<Envelope<ApiAssignee[]>>(`/tasks/${enc(taskId)}/assignees/swap`, body, o)),
    /** Move the task's due day — refused (409) when the task changed since `expectedVersion`. */
    moveDue: (taskId: string, body: { dueDate: string; expectedVersion: number }, o?: CallOpts): Promise<unknown> =>
      data(client.put<Envelope<unknown>>(`/tasks/${enc(taskId)}`, body, o)),
    /** The company's daily limit (administrators; the server refuses anyone else). */
    setDailyLimit: (value: number, o?: CallOpts): Promise<{ key: string; value: number }> =>
      data(client.put<Envelope<{ key: string; value: number }>>('/system-settings/workload.dailyLimit', { value }, o)),
  };
}

export type PlanningApi = ReturnType<typeof planningApi>;
