import type { RecurrenceRule } from './recurrence';
import type { CarryLogEntry } from './board-date';

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
  position: number;
  priority: Priority;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  actualHours: number | null;
  progress: number;
  createdById: string;
  completedAt: Date | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string | null;
  /** The calendar day this task appears on (per-date boards). Stored as a noon-UTC anchor. */
  boardDate: Date | null;
  /** Append-only history of carry-forward moves (from→to date). */
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
  createdById: string;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceParentId?: string | null;
  boardDate?: Date | null;
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
  completedAt?: Date | null;
  recurrenceRule?: RecurrenceRule | null;
  recurrenceParentId?: string | null;
  boardDate?: Date | null;
  carryForwardLog?: CarryLogEntry[] | null;
}

export interface TaskListFilter {
  projectId?: string;
  columnId?: string;
  assigneeId?: string;
  /** Restrict to tasks on a specific board day (a noon-UTC date anchor). */
  boardDate?: Date;
}

export interface TaskRepository {
  create(data: CreateTaskData): Promise<TaskRecord>;
  findById(id: string): Promise<TaskRecord | null>;
  list(filter: TaskListFilter): Promise<TaskRecord[]>;
  update(id: string, patch: UpdateTaskData): Promise<TaskRecord>;
  softDelete(id: string): Promise<void>;
  countByProject(projectId: string): Promise<number>;
  /**
   * Apply a patch to every member of a recurring series — the origin task (`id === seriesId`)
   * and all its generated occurrences (`recurrenceParentId === seriesId`) — in ONE atomic
   * statement. Avoids scanning the whole task table and keeps the series edit all-or-nothing.
   */
  updateSeries(seriesId: string, patch: UpdateTaskData): Promise<void>;
  /** Soft-delete every member of a recurring series in one atomic statement. */
  softDeleteSeries(seriesId: string): Promise<void>;
}

/** Minimal project lookup the task service needs (to build task keys and validate the project). */
export interface ProjectLookup {
  getCodeById(projectId: string): Promise<string | null>;
}
