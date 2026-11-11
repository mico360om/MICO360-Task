/**
 * Project KPIs and User KPIs — what the KPIs are worked out from, for a list of projects at once (a fixed
 * number of chunked reads, however many projects). Plain reads: who may see which project or person is
 * decided before anything is asked here. Binned and merged tasks are never read (kpi-task-scope).
 */
import type { CompletionMode, WeightDefaults } from '../project-health/completion';
import type { ProjectStatus } from '../management/management-rules';
import type { KpiTask } from './task-history';

export interface KpiProjectRow {
  id: string;
  code: string;
  name: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  status: ProjectStatus;
  /** Archived itself, or all its companies are. */
  archived: boolean;
  ownerId: string | null;
  managerId: string | null;
  /** Its MANAGER members. */
  managerMemberIds: string[];
  /** Its main company (else its first): its working days, holidays and targets. */
  companyId: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  completionMode: CompletionMode;
  weights: WeightDefaults;
}

/** A comment or a status change on a task, for update responsiveness. */
export interface ConversationItem {
  taskId: string;
  at: Date;
  userId: string;
  kind: 'comment' | 'status';
  /** People a comment @mentions (resolved from usernames). */
  mentions: string[];
}

export interface BlockedTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  /** When it went into its Blocked column (its last move), else its last change. */
  since: Date;
  assigneeIds: string[];
}

export interface ClosedActionItem {
  id: string;
  description: string;
  assigneeId: string;
  projectId: string | null;
  meetingId: string | null;
  completedAt: Date;
}

export interface MeetingSpan {
  userId: string;
  startAt: Date;
  endAt: Date | null;
}

export interface KpiPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface KpiSource {
  projects(ids: string[]): Promise<KpiProjectRow[]>;
  /**
   * The tasks of these projects a window needs: made before its end, and open or done since its start
   * (plus every one still in a Done column without a completion time), with their history.
   */
  windowTasks(projectIds: string[], from: Date, to: Date): Promise<KpiTask[]>;
  /** These tasks with their history (not deleted). */
  tasksById(ids: string[]): Promise<KpiTask[]>;
  /** Per project: tasks completed before `before` (made before it), counted and weighed — completion at a past moment. */
  doneBefore(projectIds: string[], before: Date): Promise<{ projectId: string; done: number; weightDone: number }[]>;
  /** Comments and status changes on these projects' tasks from `from` to `to`. */
  conversations(projectIds: string[], from: Date, to: Date): Promise<ConversationItem[]>;
  /** Action items closed from `from` to `to`, by these people (all when null), in these projects (any, and none, when null). */
  closedActionItems(userIds: string[] | null, projectIds: string[] | null, from: Date, to: Date): Promise<ClosedActionItem[]>;
  /** These projects' open tasks in a Blocked column now. */
  blocked(projectIds: string[]): Promise<BlockedTask[]>;
  /** Meetings this person attends (not declined, not cancelled) starting from `from` to `to`. */
  meetings(userId: string, from: Date, to: Date): Promise<MeetingSpan[]>;
  /** Open tasks each of these people is on now, in these projects (all when null). */
  openTaskCounts(userIds: string[], projectIds: string[] | null): Promise<Map<string, number>>;
  /** Administrators (active or not): their due-date changes always re-baseline. */
  adminIds(): Promise<string[]>;
  people(ids: string[]): Promise<KpiPerson[]>;
}

/**
 * The Calendar release (work blocks = planned hours) plugs in here. Until it lands there is no planned
 * time, so Workload says so instead of a figure.
 */
export interface PlannedHoursSource {
  plannedHours(userId: string, projectIds: string[] | null, from: Date, to: Date): Promise<number | null>;
}

export const NO_PLANNED_HOURS: PlannedHoursSource = {
  async plannedHours() {
    return null;
  },
};
