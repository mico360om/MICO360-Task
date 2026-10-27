/**
 * The Management page's reads: each one a grouped query (or a small, capped list), whatever the number
 * of projects or tasks. Plain reads — which projects to ask about (the caller's scope and filters) is
 * decided by the management service, never here. Soft-deleted rows are left out everywhere: deleted
 * projects, tasks, inspections and meetings.
 *
 * "Open" is the shared rule (not in a Done column and no completion time). "Late" is the shared
 * due-date rule: the due day (a date-only due date's UTC date; any other instant read in the company
 * time zone) is before the given day — lib/due-date.ts `isOverdue`.
 */
import type { CheckRow } from './check-rules';
import type { ProjectStatus } from './management-rules';

export interface MgmtProject {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  ownerId: string | null;
  managerId: string | null;
  updatedAt: Date;
}

export interface MgmtPerson {
  id: string;
  /** Full name, else the username. */
  name: string;
  avatarUrl: string | null;
}

/** A project's task figures, right now. */
export interface ProjectTaskFigures {
  projectId: string;
  /** Live tasks. */
  total: number;
  /** Finished: a Done column or a completion time. */
  done: number;
  open: number;
  /** Open, due before today. */
  late: number;
  lastTaskUpdate: Date | null;
}

export interface OpenMilestone {
  id: string;
  key: string;
  title: string;
  projectId: string;
  dueDate: Date | null;
}

/** A finished inspection in a period, with its passed and failed items (from its answers). */
export interface FinishedInspection {
  id: string;
  projectId: string;
  formId: string | null;
  /** The form's title as copied into the inspection. */
  title: string;
  place: string | null;
  taskId: string | null;
  finishedAt: Date;
  passed: number;
  failed: number;
}

/** One item that failed, across the period's finished inspections. */
export interface FailedItem {
  formId: string | null;
  itemId: string;
  /** How many times it failed (one per inspection). */
  failures: number;
  /** An inspection it failed in, whose copied checklist names it. */
  sampleId: string;
}

/** A task as a list behind a number shows it. */
export interface TaskLine {
  id: string;
  key: string;
  title: string;
  projectId: string;
  dueDate: Date | null;
  completedAt: Date | null;
  columnCategory: string | null;
  isMilestone: boolean;
  /** Assignees' names. */
  assignees: string[];
}

export interface ActionLine {
  id: string;
  description: string;
  projectId: string;
  meetingId: string | null;
  meetingTitle: string | null;
  taskId: string | null;
  dueDate: Date | null;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface FailedOccurrence {
  inspectionId: string;
  title: string;
  place: string | null;
  projectId: string;
  finishedAt: Date;
  note: string | null;
}

/** The weeks of a trend: [from, to) instants, and when late tasks are counted (`lateDay` as of `lateAt`). */
export interface TrendBucket {
  from: Date;
  to: Date;
  lateDay: string;
  lateAt: Date;
}

export interface ManagementSource {
  /** Live (not deleted) projects of any status: every one (null), or those this person runs. */
  projects(runBy: string | null): Promise<MgmtProject[]>;
  /** Live projects this person runs (owner, named manager, MANAGER member), counted. */
  runCount(userId: string): Promise<number>;
  /** These people's names and faces (deleted people are left out). */
  people(ids: string[]): Promise<MgmtPerson[]>;
  /** Per project: live tasks, done, open, late (due before `today`) and the latest task change. */
  taskFigures(projectIds: string[], today: string): Promise<ProjectTaskFigures[]>;
  /** Open milestones of these projects. */
  openMilestones(projectIds: string[]): Promise<OpenMilestone[]>;
  /**
   * Checks (tasks carrying an inspection form) of these projects that are due in [dueFrom, dueTo),
   * open and due before `openBefore`, or (when given) finished in [doneFrom, doneTo).
   */
  checks(projectIds: string[], window: { dueFrom: Date; dueTo: Date; openBefore: Date; doneFrom?: Date; doneTo?: Date }): Promise<CheckRow[]>;
  /** Inspections of these projects finished in [from, to). */
  finishedInspections(projectIds: string[], from: Date, to: Date): Promise<FinishedInspection[]>;
  /** The items that failed most often in inspections of these projects finished in [from, to), most first. */
  failedItems(projectIds: string[], from: Date, to: Date, limit: number): Promise<FailedItem[]>;
  /** These inspections' copied checklists (to name their items). */
  structures(inspectionIds: string[]): Promise<{ id: string; title: string; structure: unknown }[]>;
  /** Per project: follow-up tasks (made from failed items) still open. */
  openFollowUps(projectIds: string[]): Promise<{ projectId: string; count: number }[]>;
  /** Per active person: their open tasks of these projects due before `today`. */
  lateByPerson(projectIds: string[], today: string): Promise<{ userId: string; count: number }[]>;
  /** Per assignee: open meeting action items of these projects, and how many are past their due day. */
  actionItems(projectIds: string[], today: string): Promise<{ userId: string; open: number; overdue: number }[]>;
  /** Per week: tasks created, tasks completed, and tasks late at the week's end (now for the current week). */
  trend(projectIds: string[], buckets: TrendBucket[]): Promise<{ created: number[]; completed: number[]; late: number[] }>;

  // ── The lists behind the numbers (each capped at `limit`, with the full count) ──
  /** Open tasks due before `today` (milestones only, or one person's), the most overdue first. */
  lateTasks(q: { projectIds: string[]; today: string; personId?: string; milestonesOnly?: boolean; limit: number }): Promise<{ total: number; rows: TaskLine[] }>;
  /** These tasks, for a list. */
  tasksByIds(ids: string[]): Promise<TaskLine[]>;
  /** Open follow-up tasks. */
  followUpTasks(q: { projectIds: string[]; limit: number }): Promise<{ total: number; rows: TaskLine[] }>;
  /** Where an item failed in [from, to): the inspections, newest first. `formId` null: inspections whose form is gone. */
  failedOccurrences(q: { projectIds: string[]; from: Date; to: Date; formId: string | null; itemId: string; limit: number }): Promise<{ total: number; rows: FailedOccurrence[] }>;
  /** Open action items (one person's), the most overdue first. */
  actionItemList(q: { projectIds: string[]; personId?: string; limit: number }): Promise<{ total: number; rows: ActionLine[] }>;
}
