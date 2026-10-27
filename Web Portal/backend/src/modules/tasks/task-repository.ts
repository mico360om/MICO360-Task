import type { RecurrenceRule } from './recurrence';
import type { CarryLogEntry } from './board-date';
import type { ProjectTaskSettings } from '../projects/project-task-settings';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface TaskRecord {
  id: string;
  key: string;
  title: string;
  description: string | null;
  projectId: string;
  columnId: string;
  /** The category of the task's current column (its Kanban stage), e.g. 'IN_PROGRESS' | 'DONE'. */
  columnCategory?: string | null;
  /** True when its column is switched off in Manage columns (list rows; absent when unknown). */
  columnHidden?: boolean;
  position: number;
  priority: Priority;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  actualHours: number | null;
  progress: number;
  /** A milestone: a key date or deliverable of its project (the project dashboard lists them). */
  isMilestone?: boolean;
  /** Shown on its project's client page (title, status, due date only) — staff see a "Visible to client" mark. */
  clientVisible?: boolean;
  createdById: string;
  completedAt: Date | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string | null;
  /**
   * The copy of a recurring series made from this task (set by findById). Non-null means this is an
   * earlier copy: its repeat can't be changed — that would start a second, parallel series.
   */
  recurrenceNextId?: string | null;
  /** The meeting this task was created from (a Live note made into a task), when there is one. */
  meetingId?: string | null;
  /**
   * Keys the task had before it moved to another project, oldest first (set by findById): "RIG-4"
   * for a task that is OPS-17 now. Looking up an old key still finds the task.
   */
  formerKeys?: string[];
  /** The calendar day this task appears on (per-date boards). Stored as a noon-UTC anchor. */
  boardDate: Date | null;
  /** Append-only history of carry-forward moves (from→to date). Left out of list responses. */
  carryForwardLog?: CarryLogEntry[] | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  /** The task's tags (present on list/get; used for tag filtering + display). */
  tags?: { id: string; name: string; color: string }[];
  /** The task's assignees (present on list; used for card avatars). */
  assignees?: { id: string; name: string }[];
  /** Lightweight aggregate counts for card badges (present on list). */
  counts?: { comments: number; attachments: number; checklistDone: number; checklistTotal: number };
}

export interface CreateTaskData {
  key: string;
  title: string;
  description?: string | null;
  projectId: string;
  columnId: string;
  priority?: Priority;
  startDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number | null;
  progress?: number;
  isMilestone?: boolean;
  createdById: string;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceParentId?: string | null;
  boardDate?: Date | null;
  /** Set when the task is created straight into a DONE column. */
  completedAt?: Date | null;
  /** The meeting the task is created from (a Live note made into a task). */
  meetingId?: string | null;
  /** Normalised tag names to attach (find-or-create) in the same write as the task. */
  tagNames?: string[];
  /** Users to assign in the same write as the task (already validated). */
  assigneeIds?: string[];
  /** Checklist items' text, in order, written in the same write as the task. */
  checklist?: string[];
}

/** Thrown by `TaskRepository.create` when the generated key is already taken (a concurrent create). */
/** The task changed since the copy the edit was made from (its version moved on): nothing was saved. */
export class TaskVersionConflictError extends Error {
  constructor(id: string) {
    super(`Task ${id} was changed by someone else.`);
    this.name = 'TaskVersionConflictError';
  }
}

export class TaskKeyConflictError extends Error {
  constructor(key: string) {
    super(`Task key ${key} is already in use.`);
    this.name = 'TaskKeyConflictError';
  }
}

/** A board column as the task service needs it: which project it belongs to and its stage. */
export interface ColumnInfo {
  id: string;
  projectId: string;
  category: string;
}

export interface UpdateTaskData {
  title?: string;
  description?: string | null;
  columnId?: string;
  position?: number;
  priority?: Priority;
  startDate?: Date | null;
  dueDate?: Date | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
  progress?: number;
  isMilestone?: boolean;
  completedAt?: Date | null;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceParentId?: string | null;
  boardDate?: Date | null;
  carryForwardLog?: CarryLogEntry[] | null;
}

export interface TaskListFilter {
  projectId?: string;
  /** Restrict to these projects (the caller's accessible projects); applied in the query. */
  projectIds?: string[];
  columnId?: string;
  assigneeId?: string;
  /** Restrict to tasks on a specific board day (a noon-UTC date anchor). */
  boardDate?: Date;
  priorities?: string[];
  /** Column categories (status). */
  categories?: string[];
  /** Tasks carrying at least one of these tags. */
  tagIds?: string[];
  dueBefore?: Date;
  dueAfter?: Date;
  /** Only tasks that carry a repeat rule (the newest copy of each series). */
  recurring?: boolean;
}

export interface SeriesUpdateOptions {
  /** Leave this member out (it gets its own full update). */
  excludeId?: string;
  /** Only touch open occurrences — never completed ones. */
  openOnly?: boolean;
}

export interface TaskRepository {
  /** Create a task (plus its tags/assignees in the same write); throws TaskKeyConflictError on a taken key. */
  create(data: CreateTaskData): Promise<TaskRecord>;
  findById(id: string): Promise<TaskRecord | null>;
  list(filter: TaskListFilter): Promise<TaskRecord[]>;
  /**
   * Save a change. With `expectedVersion` it is saved only if the task is still at that version, in
   * the same statement (two edits from one copy can't both win): TaskVersionConflictError otherwise.
   */
  update(id: string, patch: UpdateTaskData, opts?: { expectedVersion?: number }): Promise<TaskRecord>;
  softDelete(id: string): Promise<void>;
  /**
   * The highest key number the project has used — its tasks (deleted ones too) and the old keys of
   * tasks that moved to another project — so the next key is this + 1 and a number is never reused.
   */
  countByProject(projectId: string): Promise<number>;
  /**
   * Apply a patch to the members of a recurring series — the origin task (`id === seriesId`)
   * and its generated occurrences (`recurrenceParentId === seriesId`) — in ONE atomic statement.
   */
  updateSeries(seriesId: string, patch: UpdateTaskData, opts?: SeriesUpdateOptions): Promise<void>;
  /** Soft-delete every member of a recurring series in one atomic statement. */
  softDeleteSeries(seriesId: string): Promise<void>;
  /** A column's project and category, or null when it doesn't exist. */
  findColumn(columnId: string): Promise<ColumnInfo | null>;
  /**
   * Re-number the live tasks of one column to match `orderedIds` (position 0..n) in one
   * transaction. Ids that aren't live tasks of that column are ignored.
   */
  reorderInColumn(columnId: string, orderedIds: string[]): Promise<void>;
}

/** Minimal project lookup the task service needs (to build task keys and validate the project). */
export interface ProjectLookup {
  getCodeById(projectId: string): Promise<string | null>;
  /** The project's "New tasks are due today" setting; null when there is no such live project. */
  getTaskSettings(projectId: string): Promise<Pick<ProjectTaskSettings, 'defaultDueToday'> | null>;
}
