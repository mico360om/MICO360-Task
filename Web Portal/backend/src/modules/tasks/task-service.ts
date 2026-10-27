import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { dueDayKey } from '../../lib/due-date';
import { isValidRule, withAnchorDay, type RecurrenceRule } from './recurrence';
import { boardDateFromKey, boardDateKey } from './board-date';
import { columnEntryChange, defaultCompanyTimeZone } from './task-status';
import { dueDateOnEntry } from '../projects/project-task-settings';
import {
  TaskKeyConflictError,
  TaskVersionConflictError,
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
  isMilestone?: boolean;
  createdById: string;
  recurrenceRule?: RecurrenceRule | null;
  /** Links a generated instance back to its recurring series (the origin task's id). */
  recurrenceParentId?: string | null;
  /** The meeting the task is created from (a Live note made into a task). */
  meetingId?: string | null;
  /** The inspection form the task is carried out with (it must be a live form), and where. */
  inspectionFormId?: string | null;
  inspectionPlace?: string | null;
  /** The board day this task should appear on; defaults to today (per-date boards). */
  boardDate?: Date | null;
  /** Normalised tag names, attached in the same write as the task. */
  tagNames?: string[];
  /** Validated user ids, assigned in the same write as the task. */
  assigneeIds?: string[];
  /** Checklist items' text, in order, written in the same write as the task. */
  checklist?: string[];
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
  /** Fired after an edit, with the task before and after it and who made it (activity: what changed). */
  onUpdated?: (before: TaskRecord, after: TaskRecord, actorId?: string) => void | Promise<void>;
  /** Fired before a single task is deleted, while it still exists (a recurring series makes its next copy). */
  onDeleting?: (task: TaskRecord) => void | Promise<void>;
  /** How far a task's checklist is (0-100; 0 without one) — the progress a re-opened task goes back to. */
  checklistPercent?: (taskId: string) => Promise<number>;
  /** Is this inspection form there (not deleted)? A task can only be given a live form. */
  inspectionForms?: { isLive(formId: string): Promise<boolean> };
}

/** How many consecutive key numbers to try when concurrent creates race for the same one. */
const KEY_ATTEMPTS = 5;
/** Fields an "entire series" edit copies to the other occurrences — never dates, column or position. */
const SERIES_FIELDS = ['title', 'description', 'priority', 'estimatedHours'] as const;

/**
 * A repeating task that carries an inspection form is a schedule: its checks are made on their
 * dates, done or not (owner decision) — whatever the client sent.
 */
const asCheckRule = (rule: RecurrenceRule, formId: string | null | undefined): RecurrenceRule =>
  formId && rule.createNext !== 'ON_SCHEDULE' ? { ...rule, createNext: 'ON_SCHEDULE' } : rule;

const sameInstant = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

export function createTaskService({ tasks, projects, now = () => new Date(), timeZone = defaultCompanyTimeZone(), onMoved, onCreated, onUpdated, onDeleting, checklistPercent, inspectionForms }: TaskServiceDeps) {
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

  /** A form given to a task must be there: a deleted one (or a wrong id) is refused in words. */
  async function assertLiveForm(formId: string | null | undefined): Promise<void> {
    if (!formId || !inspectionForms) return;
    if (!(await inspectionForms.isLive(formId))) throw new ValidationError('That inspection form isn’t there any more. Pick another form.');
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
    // Entering a DONE column completes the task (once); leaving one re-opens it (task-status).
    const change = await columnEntryChange(current, column.category, { at: now(), todayAnchor: todayAnchor(), reopenedProgress: checklistPercent });
    return { columnId, ...change };
  }

  async function createTask(input: NewTask): Promise<TaskRecord> {
    const code = await projects.getCodeById(input.projectId);
    if (!code) throw new NotFoundError('Project not found.');
    if (input.recurrenceRule && !isValidRule(input.recurrenceRule)) {
      throw new ValidationError('Invalid recurrence rule.');
    }
    const column = await requireColumn(input.columnId, input.projectId);
    await assertLiveForm(input.inspectionFormId);
    const at = now();
    // Per-date boards: a new task lands on today's board unless a board day was given.
    const boardDate = input.boardDate ?? todayAnchor();
    // Every way a task is created comes through here (the REST API used by the website, extension and
    // Android app, quick add, meeting notes made into tasks): a project whose new tasks are due today
    // gives an undated one the board day it is added to (when later than today), else today; a date
    // someone picked is kept.
    const dueDate = dueDateOnEntry(
      { dueDate: toDueDay(input.dueDate), startDate: input.startDate, boardDate },
      await projects.getTaskSettings(input.projectId),
      timeZone,
      at,
    );
    if (input.startDate) assertDateOrder(input.startDate, dueDate);
    // The start date is automatic: the creation time, or the due day when that is already past.
    const startDate = input.startDate ?? (dueDate && dayOf(at) > dayOf(dueDate) ? dueDate : at);
    const recurrenceRule = input.recurrenceRule ? withAnchorDay(asCheckRule(input.recurrenceRule, input.inspectionFormId), dueDate) : input.recurrenceRule;
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
    // A repeat on an earlier copy would start a second, parallel series next to the real one.
    if (patch.recurrenceRule && current.recurrenceNextId) {
      throw new ConflictError('This is an earlier copy of a repeating series. Change the repeat on its newest copy.', 'RECURRENCE_NOT_NEWEST');
    }
    // Only a newly chosen form is checked: a check whose form was deleted since keeps it (it can still be done).
    if (patch.inspectionFormId !== undefined && patch.inspectionFormId !== (current.inspectionFormId ?? null)) await assertLiveForm(patch.inspectionFormId);
    const { columnId, ...rest } = patch;
    const next: UpdateTaskData = { ...rest };
    if (rest.dueDate !== undefined) next.dueDate = toDueDay(rest.dueDate) ?? null;
    const start = next.startDate !== undefined ? next.startDate : current.startDate;
    const due = next.dueDate !== undefined ? next.dueDate : current.dueDate;
    // Re-check the range only when this edit changes a date, so older rows stay editable.
    if (!sameInstant(start, current.startDate) || !sameInstant(due, current.dueDate)) assertDateOrder(start, due);
    // After this edit, a repeat on a task with a form is made on schedule (set here when it isn't).
    const formAfter = next.inspectionFormId !== undefined ? next.inspectionFormId : (current.inspectionFormId ?? null);
    const ruleAfter = next.recurrenceRule !== undefined ? next.recurrenceRule : current.recurrenceRule;
    if (ruleAfter && formAfter && ruleAfter.createNext !== 'ON_SCHEDULE') next.recurrenceRule = asCheckRule(ruleAfter, formAfter);
    if (next.recurrenceRule) next.recurrenceRule = withAnchorDay(next.recurrenceRule, due);

    // A column change is a move: it must stay in the project and it drives completion status.
    const moving = columnId !== undefined && columnId !== current.columnId;
    if (moving) Object.assign(next, await columnChange(current, columnId));

    // Saved only if nobody changed the task since `expectedVersion`, in the same statement — the check
    // above answers early, this one also holds when two edits arrive together.
    let updated: TaskRecord;
    try {
      updated = await tasks.update(id, next, expectedVersion !== undefined ? { expectedVersion } : undefined);
    } catch (err) {
      if (err instanceof TaskVersionConflictError) throw new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
      throw err;
    }

    // Apply-to-entire-series (once this copy is saved, so a refused edit changes nothing): the other
    // open occurrences take only the shared fields — their own dates, column and position stay, and
    // completed occurrences are history and never change.
    if (scope === 'series' && (current.recurrenceRule || current.recurrenceParentId)) {
      const shared: UpdateTaskData = {};
      for (const field of SERIES_FIELDS) {
        if (next[field] !== undefined) Object.assign(shared, { [field]: next[field] });
      }
      if (Object.keys(shared).length > 0) {
        await tasks.updateSeries(current.recurrenceParentId ?? current.id, shared, { excludeId: id, openOnly: true });
      }
    }

    if (moving) await onMoved?.(updated, current.columnId, actorId);
    await onUpdated?.(current, updated, actorId);
    return updated;
  }

  /**
   * Move a task to a column (a status change when the column's stage differs). With
   * `expectedVersion` it moves only if nobody changed the task since that version, in the same
   * statement (VERSION_CONFLICT otherwise): two moves made from one reading can't both happen.
   */
  async function moveTask(id: string, columnId: string, position?: number, actorId?: string, opts: { expectedVersion?: number } = {}): Promise<TaskRecord> {
    const current = await getTask(id);
    const stale = () => new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
    if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) throw stale();
    // Reordering within the same column is not a status change.
    const patch: UpdateTaskData = columnId === current.columnId ? { columnId } : await columnChange(current, columnId);
    if (position !== undefined) patch.position = position;
    let moved: TaskRecord;
    try {
      moved = await tasks.update(id, patch, opts.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : undefined);
    } catch (err) {
      if (err instanceof TaskVersionConflictError) throw stale();
      throw err;
    }
    await onMoved?.(moved, current.columnId, actorId);
    return moved;
  }

  /**
   * Delete a task. With scope 'series' on a recurring task, delete the whole series (every
   * instance sharing its recurrenceParentId, plus the origin task) — the apply-to-entire-series
   * case. Otherwise just this occurrence — and when it is the newest copy of a series, the
   * `onDeleting` hook makes the next copy first, so the series carries on.
   */
  async function deleteTask(id: string, scope: 'one' | 'series' = 'one'): Promise<void> {
    const task = await getTask(id);
    const recurs = Boolean(task.recurrenceRule || task.recurrenceParentId);
    if (scope === 'series' && recurs) {
      const seriesId = task.recurrenceParentId ?? task.id;
      await tasks.softDeleteSeries(seriesId);
      return;
    }
    await onDeleting?.(task);
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
