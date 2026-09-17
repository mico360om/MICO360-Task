import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { isValidRule, type RecurrenceRule } from './recurrence';
import { boardDateFromKey, boardDateKey } from './board-date';
import type {
  Priority,
  ProjectLookup,
  TaskListFilter,
  TaskRecord,
  TaskRepository,
  UpdateTaskData,
} from './task-repository';

export interface NewTask {
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
  /** Links a generated instance back to its recurring series (the origin task's id). */
  recurrenceParentId?: string | null;
  /** The board day this task should appear on; defaults to today (per-date boards). */
  boardDate?: Date | null;
}

export interface TaskServiceDeps {
  tasks: TaskRepository;
  projects: ProjectLookup;
  /** Clock (injectable for tests) used to auto-stamp the start date on creation. */
  now?: () => Date;
  /** Company time zone used to anchor a task's board day (per-date boards). */
  timeZone?: string;
  /** Looks up a column's category so a move can update the task's completion status. */
  columns?: { categoryOf: (columnId: string) => Promise<string | null> };
  /** Fired after a task is moved (recurrence on completion + status-change notifications + activity). `prevColumnId` is the column it came from; `actorId` is who moved it. */
  onMoved?: (task: TaskRecord, prevColumnId: string, actorId?: string) => void | Promise<void>;
  /** Fired after a task is created (activity feed). */
  onCreated?: (task: TaskRecord) => void | Promise<void>;
}

export function createTaskService({ tasks, projects, now = () => new Date(), timeZone = 'UTC', columns, onMoved, onCreated }: TaskServiceDeps) {
  const todayAnchor = () => boardDateFromKey(boardDateKey(now(), timeZone));

  async function createTask(input: NewTask): Promise<TaskRecord> {
    const code = await projects.getCodeById(input.projectId);
    if (!code) throw new NotFoundError('Project not found.');
    if (input.recurrenceRule && !isValidRule(input.recurrenceRule)) {
      throw new ValidationError('Invalid recurrence rule.');
    }
    const count = await tasks.countByProject(input.projectId);
    const key = `${code}-${count + 1}`;
    // The start date is automatic: default it to the creation time unless the caller set one.
    const startDate = input.startDate ?? now();
    // Per-date boards: a new task lands on today's board unless a board day was given.
    const boardDate = input.boardDate ?? todayAnchor();
    const created = await tasks.create({ key, ...input, startDate, boardDate });
    await onCreated?.(created);
    return created;
  }

  async function listTasks(filter: TaskListFilter = {}): Promise<TaskRecord[]> {
    return tasks.list(filter);
  }

  async function getTask(id: string): Promise<TaskRecord> {
    const task = await tasks.findById(id);
    if (!task) throw new NotFoundError('Task not found.');
    return task;
  }

  async function updateTask(
    id: string,
    patch: UpdateTaskData,
    expectedVersion?: number,
    scope: 'one' | 'series' = 'one',
  ): Promise<TaskRecord> {
    const current = await getTask(id);
    // Optimistic concurrency (T4.3): reject a write based on a stale copy.
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
    }
    if (patch.recurrenceRule && !isValidRule(patch.recurrenceRule)) {
      throw new ValidationError('Invalid recurrence rule.');
    }
    // Apply-to-entire-series: propagate the patch to every member in one atomic statement
    // (the origin + all occurrences), then return the freshly-updated target task.
    if (scope === 'series' && (current.recurrenceRule || current.recurrenceParentId)) {
      const seriesId = current.recurrenceParentId ?? current.id;
      await tasks.updateSeries(seriesId, patch);
      return getTask(id);
    }
    return tasks.update(id, patch);
  }

  async function moveTask(id: string, columnId: string, position?: number, actorId?: string): Promise<TaskRecord> {
    const current = await getTask(id);
    const patch: UpdateTaskData = { columnId, ...(position !== undefined ? { position } : {}) };
    // Status update: entering a DONE column completes the task; leaving it re-opens the task.
    if (columns) {
      const category = await columns.categoryOf(columnId);
      if (category === 'DONE') {
        patch.completedAt = now();
        patch.progress = 100;
        // Completed tasks stay on their completion day's board (they never carry forward).
        patch.boardDate = todayAnchor();
      } else if (current.completedAt) {
        patch.completedAt = null;
      }
    }
    const moved = await tasks.update(id, patch);
    await onMoved?.(moved, current.columnId, actorId);
    return moved;
  }

  /**
   * Delete a task. With scope 'series' on a recurring task, delete the whole series (every
   * instance sharing its recurrenceParentId, plus the origin task) — the apply-to-entire-series
   * case. Otherwise just this occurrence.
   */
  async function deleteTask(id: string, scope: 'one' | 'series' = 'one'): Promise<void> {
    const task = await getTask(id);
    const recurs = Boolean(task.recurrenceRule || task.recurrenceParentId);
    if (scope === 'series' && recurs) {
      const seriesId = task.recurrenceParentId ?? task.id;
      await tasks.softDeleteSeries(seriesId);
      return;
    }
    await tasks.softDelete(id);
  }

  /**
   * Re-sequence a column's tasks to match `orderedIds` (position 0..n). Used for intra-column
   * drag reordering. Tasks have no unique (columnId, position) constraint, so a plain re-number
   * is safe. Positions are assigned in list order.
   */
  async function reorderColumn(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await tasks.update(orderedIds[i]!, { position: i });
    }
  }

  return { createTask, listTasks, getTask, updateTask, moveTask, deleteTask, reorderColumn };
}

export type TaskService = ReturnType<typeof createTaskService>;
