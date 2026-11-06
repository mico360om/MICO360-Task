/**
 * 1.23.5 Project overview & health — what the health extras are worked out from, for a list of projects
 * at once (a fixed number of grouped reads, however many projects). Plain reads: who may see which project
 * is decided before anything is asked here. Deleted and merged tasks are never read (a merged task is
 * deleted with it).
 *
 * "Open" for a project's own task here is not done and not waiting for approval (a task handed in for an
 * OK is no work in hand); a blocker or a milestone's linked task is open while it isn't done.
 */
import type { CompletionFigures, CompletionMode, WeightDefaults } from './completion';
import type { ProjectStatus } from '../management/management-rules';

export interface HealthProjectRow {
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
  /** Its MANAGER members (active people), the earliest to join first. */
  managerMemberIds: string[];
  startDate: Date | null;
  targetDate: Date | null;
  updatedAt: Date;
  completionMode: CompletionMode;
  weights: WeightDefaults;
}

export interface ProjectFiguresRow extends CompletionFigures {
  projectId: string;
  lastTaskUpdate: Date | null;
}

/** Open tasks (not waiting for approval) per project, and each person's share of them. */
export interface OpenLoadRow {
  projectId: string;
  open: number;
  people: { userId: string; count: number }[];
}

/**
 * An open task (not waiting for approval) that may need attention: in a Blocked column, waiting on
 * another task, due before the edge, or with a date and no one assigned; and every open milestone
 * (waiting for approval too).
 */
export interface AttentionTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  columnId: string;
  columnCategory: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  startDate: Date | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  recurrenceRule: unknown;
  isMilestone: boolean;
  /** Waiting for approval (only a milestone is read so: its owners are still named). */
  waiting: boolean;
  /** Its people, the first assigned first (deleted people left out). */
  assignees: { id: string; name: string }[];
}

/** One "Blocked by" link of an attention task, either way, with the other task's state. */
export interface LinkRow {
  /** The waiting task, and the task it waits on. */
  taskId: string;
  dependsOnTaskId: string;
  waiting: LinkedTask;
  blocker: LinkedTask;
}

export interface LinkedTask {
  id: string;
  key: string;
  projectId: string;
  dueDate: Date | null;
  /** Not done (the read leaves out links to deleted tasks). */
  open: boolean;
}

/** A project's live tasks with one due date (null: undated), counted, and how many of them are open. */
export interface DueGroupRow {
  projectId: string;
  dueDate: Date | null;
  total: number;
  open: number;
}

export interface HealthSource {
  projects(ids: string[]): Promise<HealthProjectRow[]>;
  /** Per project: live tasks counted and weighed (finished and in all), and the latest task change. */
  figures(ids: string[]): Promise<ProjectFiguresRow[]>;
  openLoad(ids: string[]): Promise<OpenLoadRow[]>;
  /** The attention tasks of these projects; `dueBefore`: the loose edge of "due soon" (the rules decide each day). */
  attention(ids: string[], dueBefore: Date): Promise<AttentionTask[]>;
  /** The "Blocked by" links of these tasks, either way. */
  links(taskIds: string[]): Promise<LinkRow[]>;
  /** The latest column change (MOVED / REOPENED / SENT_BACK) of these tasks. */
  lastMoves(taskIds: string[]): Promise<{ taskId: string; at: Date }[]>;
  /** These projects' live tasks due before `dueBefore`, grouped by due date (a milestone's linked work). */
  dueGroups(ids: string[], dueBefore: Date): Promise<DueGroupRow[]>;
  /** People's names and faces (deleted people left out). */
  people(ids: string[]): Promise<{ id: string; name: string; avatarUrl: string | null }[]>;
}
