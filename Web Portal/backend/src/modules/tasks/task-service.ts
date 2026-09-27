import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { dueDayKey } from '../../lib/due-date';
import { isValidRule, withAnchorDay, type RecurrenceRule } from './recurrence';
import { boardDateFromKey, boardDateKey } from './board-date';
import { defaultCompanyTimeZone } from './task-status';
import {
  TaskKeyConflictError,
  type ColumnInfo,
  type Priority,
  type ProjectLookup,
  type TaskListFilter,
  type TaskRecord,
  type TaskRepository,
  type UpdateTaskData,
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
  /** Normalised tag names, attached in the same write as the task. */
  tagNames?: string[];
  /** Validated user ids, assigned in the same write as the task. */
  assigneeIds?: string[];
}

export interface TaskServiceDeps {
  tasks: TaskRepository;
  projects: ProjectLookup;
  /** Clock (injectable for tests) used to auto-stamp the start date on creation. */
  now?: () => Date;
  /** Company time zone: anchors board days and turns due dates into calendar days. */
  timeZone?: string;
  /** @deprecated Column stages now come from `tasks.findColumn`, which also checks the project. */
  columns?: { categoryOf: (columnId: string) => Promise<string | null> };
  /** Fired after a task changes column (recurrence on completion + status-change notifications + activity). `prevColumnId` is the column it came from; `actorId` is who moved it. */
  onMoved?: (task: TaskRecord, prevColumnId: string, actorId?: string) => void | Promise<void>;
  /** Fired after a task is created (activity feed). */
  onCreated?: (task: TaskRecord) => void | Promise<void>;
}

/** How many consecutive key numbers to try when concurrent creates race for the same one. */
const KEY_ATTEMPTS = 5;
/** Fields an "entire series" edit copies to the other occurrences — never dates, column or position. */
const SERIES_FIELDS = ['title', 'description', 'priority', 'estimatedHours'] as const;

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

export function createTaskService({ tasks, projects, now = () => new Date(), timeZone = defaultCompanyTimeZone(), onMoved, onCreated }: TaskServiceDeps) {
  const todayAnchor = () => boardDateFromKey(boardDateKey(now(), timeZone));
  const dayOf = (d: Date): string => dueDayKey(d, timeZone) ?? '';

  /** Due dates are calendar days: store every input as UTC midnight of its day (company time for timestamps). */
  function toDueDay(d: Date | null | undefined): Date | null | undefined {
    if (!d) return d;
    return new Date(`${dayOf(d)}T00:00:00.000Z`);
  }

  function assertDateOrder(start: Date | null | undefined, due: Date | null | undefined): void {
    if (start && due && dayOf(start) > dayOf(due)) {
      throw new ValidationError('The start date must be on or before the due date.');
    }
  }

  async function requireColumn(columnId: string, projectId: string): Promise<ColumnInfo> {
    const column = await tasks.findColumn(columnId);
    if (!column) throw new ValidationError('That column does not exist.');
    if (column.projectId !== projectId) throw new ValidationError('That column belongs to a different project.');
    return column;
  }

  /** The status change that goes with moving `current` into `columnId` (validated to be in its project). */
  async function columnChange(current: TaskRecord, columnId: string): Promise<UpdateTaskData> {
    const column = await requireColumn(columnId, current.projectId);
    const patch: UpdateTaskData = { columnId };
    // Entering a DONE column completes the task — once: an already-completed task keeps its
    // completion time (reordering or replaying a move must not rewrite history). Leaving re-opens it.
    if (column.category === 'DONE') {
      patch.progress = 100;
      if (!current.completedAt) {
        patch.completedAt = now();
        // Completed tasks stay on their completion day's board (they never carry forward).
        patch.boardDate = todayAnchor();
      }
    } else if (current.completedAt) {
      patch.completedAt = null;
    }
    return patch;
  }

  async function createTask(input: NewTask): Promise<TaskRecord> {
    const code = await projects.getCodeById(input.projectId);
    if (!code) throw new NotFoundError('Project not found.');
    if (input.recurrenceRule && !isValidRule(input.recurrenceRule)) {
      throw new ValidationError('Invalid recurrence rule.');
    }
    const column = await requireColumn(input.columnId, input.projectId);
    const at = now();
    const dueDate = toDueDay(input.dueDate);
    if (input.startDate) assertDateOrder(input.startDate, dueDate);
    // The start date is automatic: the creation time, or the due day when that is already past.
    const startDate = input.startDate ?? (dueDate && dayOf(at) > dayOf(dueDate) ? dueDate : at);
    // Per-date boards: a new task lands on today's board unless a board day was given.
    const boardDate = input.boardDate ?? todayAnchor();
    const recurrenceRule = input.recurrenceRule ? withAnchorDay(input.recurrenceRule, dueDate) : input.recurrenceRule;
    // A task created straight into a DONE column is complete from the start.
    const completion = column.category === 'DONE' ? { completedAt: at, progress: 100 } : {};
    const data = { ...input, dueDate, startDate, boardDate, recurrenceRule, ...completion };

    // Keys are sequential per project; two simultaneous creates can pick the same number, so
    // the loser moves on to the next one instead of failing.
    const count = await tasks.countByProject(input.projectId);
    for (let attempt = 0; ; attempt++) {
      const key = `${code}-${count + 1 + attempt}`;
      try {
        const created = await tasks.create({ ...data, key });
        await onCreated?.(created);
        return created;
      } catch (err) {
        if (!(err instanceof TaskKeyConflictError)) throw err;
        if (attempt >= KEY_ATTEMPTS - 1) {
          throw new ConflictError('Another task was created at the same moment. Please try again.', 'TASK_KEY_CONFLICT');
        }
      }
    }
  }

  async function listTasks(filter: TaskListFilter = {}): Promise<TaskRecord[]> {
    return tasks.list(filter);
  }

  async function getTask(id: string): Promise<TaskRecord> {
    const task = await tasks.findById(id);
    if (!task) throw new NotFoundError('Task not found.');
    return task;
  }

  async function getColumn(columnId: string): Promise<ColumnInfo> {
    const column = await tasks.findColumn(columnId);
    if (!column) throw new NotFoundError('Column not found.');
    return column;
  }

  async function updateTask(
    id: string,
    patch: UpdateTaskData,
    expectedVersion?: number,
    scope: 'one' | 'series' = 'one',
    actorId?: string,
  ): Promise<TaskRecord> {
    const current = await getTask(id);
    // Optimistic concurrency (T4.3): reject a write based on a stale copy.
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
    }
    if (patch.recurrenceRule && !isValidRule(patch.recurrenceRule)) {
      throw new ValidationError('Invalid recurrence rule.');
    }
    const { columnId, ...rest } = patch;
    const next: UpdateTaskData = { ...rest };
    if (rest.dueDate !== undefined) next.dueDate = toDueDay(rest.dueDate) ?? null;
    const start = next.startDate !== undefined ? next.startDate : current.startDate;
    const due = next.dueDate !== undefined ? next.dueDate : current.dueDate;
    // Re-check the range only when this edit changes a date, so older rows stay editable.
    if (!sameInstant(start, current.startDate) || !sameInstant(due, current.dueDate)) assertDateOrder(start, due);
    if (next.recurrenceRule) next.recurrenceRule = withAnchorDay(next.recurrenceRule, due);

    // A column change is a move: it must stay in the project and it drives completion status.
    const moving = columnId !== undefined && columnId !== current.columnId;
    if (moving) Object.assign(next, await columnChange(current, columnId));

    // Apply-to-entire-series: the other open occurrences take only the shared fields — their own
    // dates, column and position stay, and completed occurrences are history and never change.
    if (scope === 'series' && (current.recurrenceRule || current.recurrenceParentId)) {
      const shared: UpdateTaskData = {};
      for (const field of SERIES_FIELDS) {
        if (next[field] !== undefined) Object.assign(shared, { [field]: next[field] });
      }
      if (Object.keys(shared).length > 0) {
        await tasks.updateSeries(current.recurrenceParentId ?? current.id, shared, { excludeId: id, openOnly: true });
      }
    }

    const updated = await tasks.update(id, next);
    if (moving) await onMoved?.(updated, current.columnId, actorId);
    return updated;
  }

  async function moveTask(id: string, columnId: string, position?: number, actorId?: string): Promise<TaskRecord> {
    const current = await getTask(id);
    // Reordering within the same column is not a status change.
    const patch: UpdateTaskData = columnId === current.columnId ? { columnId } : await columnChange(current, columnId);
    if (position !== undefined) patch.position = position;
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
   * Re-sequence a column's live tasks to match `orderedIds` (position 0..n), for intra-column
   * drag reordering. Ids that aren't live tasks of this column are ignored.
   */
  async function reorderColumn(columnId: string, orderedIds: string[]): Promise<void> {
    await tasks.reorderInColumn(columnId, orderedIds);
  }

  return { createTask, listTasks, getTask, getColumn, updateTask, moveTask, deleteTask, reorderColumn, timeZone };
}

export type TaskService = ReturnType<typeof createTaskService>;
