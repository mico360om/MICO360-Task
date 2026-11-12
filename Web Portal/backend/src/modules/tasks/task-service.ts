import { randomUUID } from 'node:crypto';
import type { ChecklistTree } from './checklist-tree';
import { binExpiryOf } from '../recycle-bin/bin-rules';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { dueDayKey } from '../../lib/due-date';
import { isValidRule, withAnchorDay, type RecurrenceRule } from './recurrence';
import { boardDateFromKey, boardDateKey } from './board-date';
import { columnEntryChange, defaultCompanyTimeZone } from './task-status';
import { dueDateOnEntry } from '../projects/project-task-settings';
import { boardDayAfterStartEdit, newTaskBoardDay } from './scheduled-start';
import type { ExternalContactFields } from './external-contacts';
import {
  approvalOnEntry,
  firstOpenColumn,
  isAwaitingApproval,
  pickColumn,
  SEND_BACK_CATEGORIES,
  SEND_BACK_REASON_MAX,
  WAIT_CATEGORIES,
  type ApprovalEvent,
  type PickableColumn,
} from './task-approval';
import {
  TaskKeyConflictError,
  TaskVersionConflictError,
  type BinMark,
  type ColumnInfo,
  type CreateTaskData,
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
  /** 1.23.5: 1–10 points; null/absent = the project's default for its priority. */
  weight?: number | null;
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
  /** 1.23.3: its checklists with titles and nesting (wins over `checklist`). */
  checklists?: ChecklistTree;
  /** External contacts (already checked), in order, written in the same write as the task. */
  externalContacts?: ExternalContactFields[];
  /** 1.24: guests picked from the company's list (already checked), written in the same write as the task. */
  guestLinks?: { guestId: string; note: string | null }[];
  /** 1.24: its categories (already checked: the project's, not retired), written in the same write. */
  categoryIds?: string[];
  /** Needs approval before it counts as done; left out, the project's "New tasks need approval" decides. */
  needsApproval?: boolean;
  /** Duplicate Task: the task this one is a copy of (task-duplicate.ts). */
  duplicatedFromId?: string | null;
}

/** What approvals need to know: who may approve a project's tasks, and its board columns. */
export interface TaskApprovalPorts {
  /** Admins and whoever runs the project (`canManageProject`). */
  canApprove(userId: string, projectId: string): Promise<boolean>;
  columnsOf(projectId: string): Promise<PickableColumn[]>;
}

/** What else happened with a column change: an approval step, and a send-back's reason. */
export interface MoveExtra {
  approval?: ApprovalEvent;
  reason?: string;
  /** Who had finished it (asked for approval) before this step cleared it. */
  requestedById?: string | null;
}

/** Plain words for the approval refusals. */
export const APPROVAL_WORDS = {
  notApprover: 'Only the project’s managers can approve or send back its tasks.',
  /** Turning "Needs approval" off, waiting or not: only the project's managers and admins (owner, 30 Oct). */
  switchOff: 'Only the project’s managers can turn off approval for this task.',
  notWaiting: 'This task isn’t waiting for approval any more.',
  noDone: 'This project has no Done column. Add one in Manage columns, then approve the task.',
  noReason: 'Say why you’re sending it back.',
  noOpenColumn: 'This project has only Done columns. Add another column before adding a task that needs approval.',
  longReason: `Keep the reason under ${SEND_BACK_REASON_MAX} characters.`,
} as const;

export interface TaskServiceDeps {
  tasks: TaskRepository;
  projects: ProjectLookup;
  /** Clock (injectable for tests) used to auto-stamp the start date on creation. */
  now?: () => Date;
  /** Company time zone: anchors board days and turns due dates into calendar days. */
  timeZone?: string;
  /** @deprecated Column stages now come from `tasks.findColumn`, which also checks the project. */
  columns?: { categoryOf: (columnId: string) => Promise<string | null> };
  /**
   * Fired after a task changes column (recurrence on completion + status-change notifications +
   * activity). `prevColumnId` is the column it came from; `actorId` is who moved it. `extra` (passed
   * only when there is one) names an approval step — which can happen without a column change.
   */
  onMoved?: (task: TaskRecord, prevColumnId: string, actorId?: string, extra?: MoveExtra) => void | Promise<void>;
  /** Fired after a task is created (activity feed). */
  /** `autoDue`: its due date was filled in by the project's "new tasks due today" (KPIs: no one's commitment). */
  onCreated?: (task: TaskRecord, info?: { autoDue: boolean }) => void | Promise<void>;
  /** Fired after an edit, with the task before and after it and who made it (activity: what changed). */
  onUpdated?: (before: TaskRecord, after: TaskRecord, actorId?: string) => void | Promise<void>;
  /** Fired before a single task is deleted, while it still exists (a recurring series makes its next copy). */
  onDeleting?: (task: TaskRecord) => void | Promise<void>;
  /** How far a task's checklist is (0-100; 0 without one) — the progress a re-opened task goes back to. */
  checklistPercent?: (taskId: string) => Promise<number>;
  /** Is this inspection form there (not deleted)? A task can only be given a live form. */
  inspectionForms?: { isLive(formId: string): Promise<boolean> };
  /** Task approvals (task-approval). Without it, "Needs approval" is kept but changes nothing. */
  approvals?: TaskApprovalPorts;
  /** A step after an approval or a send-back was saved that failed (logged; the decision stands). */
  onError?: (err: unknown, taskId: string) => void;
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

export function createTaskService({ tasks, projects, now = () => new Date(), timeZone = defaultCompanyTimeZone(), onMoved, onCreated, onUpdated, onDeleting, checklistPercent, inspectionForms, approvals, onError }: TaskServiceDeps) {
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

  /** Tell the hook about a column change, with its approval step when there is one. */
  async function moved(task: TaskRecord, prevColumnId: string, actorId: string | undefined, extra: MoveExtra | null): Promise<void> {
    if (extra?.approval) await onMoved?.(task, prevColumnId, actorId, extra);
    else await onMoved?.(task, prevColumnId, actorId);
  }

  /** Approvals are wired and this person may approve the project's tasks. */
  async function mayApprove(actorId: string | undefined, projectId: string): Promise<boolean> {
    return Boolean(approvals && actorId && (await approvals.canApprove(actorId, projectId)));
  }

  const completionAt = (current: TaskRecord, category: string, at: Date = now()) =>
    columnEntryChange(current, category, { at, todayAnchor: todayAnchor(), reopenedProgress: checklistPercent });

  /**
   * The status change that goes with moving `current` into `columnId` (validated to be in its
   * project): completion follows the column it really goes to, and a task that needs approval waits
   * instead of completing when the mover can't approve (task-approval). `unchanged`: it already waits
   * and someone who can't approve finished it again — nothing is to be written.
   */
  async function columnChange(current: TaskRecord, columnId: string, actorId?: string): Promise<{ patch: UpdateTaskData; event: ApprovalEvent | null; unchanged: boolean; guarded: boolean }> {
    const column = await requireColumn(columnId, current.projectId);
    let target = { columnId, category: column.category };
    let approval: UpdateTaskData = {};
    let event: ApprovalEvent | null = null;
    if (approvals && (current.needsApproval || isAwaitingApproval(current) || current.approvedAt)) {
      const finishing = column.category === 'DONE' && !current.completedAt && Boolean(current.needsApproval);
      const canApprove = finishing ? await mayApprove(actorId, current.projectId) : false;
      const waitColumn = finishing && !canApprove && !isAwaitingApproval(current) ? pickColumn(await approvals.columnsOf(current.projectId), WAIT_CATEGORIES) : null;
      const d = approvalOnEntry(current, target, { canApprove, actorId, at: now(), waitColumn });
      if (d.unchanged) return { patch: {}, event: null, unchanged: true, guarded: false };
      target = { columnId: d.columnId, category: d.category };
      approval = d.patch;
      event = d.event;
    }
    // Entering a DONE column completes the task (once); leaving one re-opens it (task-status).
    const change = await completionAt(current, target.category);
    // An approval step, or a move of a task that waits: saved only from the version just read, so an
    // approval (or a send-back) made meanwhile is never overwritten by a move computed before it.
    const guarded = event !== null || isAwaitingApproval(current);
    return { patch: { columnId: target.columnId, ...change, ...approval }, event, unchanged: false, guarded };
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
    // Per-date boards: a new task lands on today's board unless a board day was given — or, tasks
    // scheduled for the future (owner, 10 Nov), its Start date is later than today: then it waits on
    // its start day's board (scheduled-start.ts). A board day given still wins.
    const boardDate = newTaskBoardDay(input, timeZone, at);
    // Every way a task is created comes through here (the REST API used by the website, extension and
    // Android app, quick add, meeting notes made into tasks): a project whose new tasks are due today
    // gives an undated one the board day it is added to (when later than today), else today; a date
    // someone picked is kept.
    const settings = await projects.getTaskSettings(input.projectId);
    const dueDate = dueDateOnEntry({ dueDate: toDueDay(input.dueDate), startDate: input.startDate, boardDate }, settings, timeZone, at);
    if (input.startDate) assertDateOrder(input.startDate, dueDate);
    // The start date is automatic: the creation time, or the due day when that is already past.
    const startDate = input.startDate ?? (dueDate && dayOf(at) > dayOf(dueDate) ? dueDate : at);
    const recurrenceRule = input.recurrenceRule ? withAnchorDay(asCheckRule(input.recurrenceRule, input.inspectionFormId), dueDate) : input.recurrenceRule;
    // Needs approval: as asked, else the project's "New tasks in this project need approval". Where the
    // project ticks new tasks, only someone who runs it (or an admin) may leave it off: anyone else's
    // "false" is kept on, quietly — the task is still made (owner, 30 Oct).
    const projectTicks = Boolean(settings?.newTasksNeedApproval);
    let needsApproval = input.needsApproval ?? projectTicks;
    if (!needsApproval && projectTicks && approvals && !(await mayApprove(input.createdById, input.projectId))) needsApproval = true;
    // A task created straight into a DONE column is complete from the start — unless it needs approval
    // and its creator can't approve: then it waits, in the first Review column (else the first open one).
    let columnId = input.columnId;
    let completion: Partial<CreateTaskData> = column.category === 'DONE' ? { completedAt: at, progress: 100 } : {};
    let waits = false;
    if (approvals && needsApproval && column.category === 'DONE') {
      if (await mayApprove(input.createdById, input.projectId)) {
        completion = { ...completion, approvedAt: at, approvedById: input.createdById };
      } else {
        const columns = await approvals.columnsOf(input.projectId);
        const wait = pickColumn(columns, WAIT_CATEGORIES) ?? firstOpenColumn(columns);
        // Nowhere to wait but a Done column (where it would count as done): refused.
        if (!wait) throw new ConflictError(APPROVAL_WORDS.noOpenColumn, 'NO_OPEN_COLUMN');
        columnId = wait.id;
        completion = { approvalRequestedAt: at, approvalRequestedById: input.createdById };
        waits = true;
      }
    }
    const data = { ...input, columnId, dueDate, startDate, boardDate, recurrenceRule, needsApproval, ...completion };

    // Keys are sequential per project; two simultaneous creates can pick the same number, so
    // the loser moves on to the next one instead of failing.
    const count = await tasks.countByProject(input.projectId);
    for (let attempt = 0; ; attempt++) {
      const key = `${code}-${count + 1 + attempt}`;
      try {
        const created = await tasks.create({ ...data, key });
        await onCreated?.(created, { autoDue: !toDueDay(input.dueDate) && !!dueDate });
        // Created waiting (into Done by someone who can't approve): its approvers are told.
        if (waits) await moved(created, created.columnId, input.createdById, { approval: 'REQUESTED' });
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
    /**
     * `requireNewest`: the change is meant for its series' newest copy (a schedule's Stop or Edit):
     * refused (409) when this is an earlier copy now — the repeat moved on — or it no longer repeats.
     */
    opts: { requireNewest?: boolean } = {},
  ): Promise<TaskRecord> {
    const current = await getTask(id);
    if (opts.requireNewest && (current.recurrenceNextId || !current.recurrenceRule)) {
      throw new ConflictError('This schedule changed meanwhile (its repeat moved on to a newer copy, or it was stopped). Look at it again.', 'RECURRENCE_NOT_NEWEST');
    }
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

    // "Needs approval" turned off — waiting or not — only by someone who may approve (the project's
    // managers, admins; owner, 30 Oct): anyone else could untick it and then finish without approval.
    // Turning it on is anyone's who can edit the task; an edit that leaves it out changes nothing.
    const turningOff = Boolean(approvals) && patch.needsApproval === false && (Boolean(current.needsApproval) || isAwaitingApproval(current));
    if (turningOff && !(await mayApprove(actorId, current.projectId))) throw new ForbiddenError(APPROVAL_WORDS.switchOff);
    // Turned off while it waits: it then completes as usual, in the first Done column (unless this
    // edit moves it somewhere itself).
    const switchingOff = turningOff && isAwaitingApproval(current);
    // The move is judged with the tick as this edit leaves it.
    const subject: TaskRecord = patch.needsApproval !== undefined ? { ...current, needsApproval: patch.needsApproval } : current;

    // A column change is a move: it must stay in the project and it drives completion status.
    const moving = columnId !== undefined && columnId !== current.columnId;
    let columnChanged = moving;
    let event: ApprovalEvent | null = null;
    let guardVersion = expectedVersion;
    if (moving) {
      const c = await columnChange(subject, columnId, actorId);
      if (c.guarded && guardVersion === undefined) guardVersion = current.version;
      if (c.unchanged) {
        // It already waits and was finished again: the move changes nothing (any other field is saved).
        columnChanged = false;
        if (Object.keys(next).length === 0) return current;
      } else {
        Object.assign(next, c.patch);
        event = c.event;
      }
    } else if (switchingOff) {
      if (guardVersion === undefined) guardVersion = current.version;
      Object.assign(next, { approvalRequestedAt: null, approvalRequestedById: null });
      const done = pickColumn(await approvals!.columnsOf(current.projectId), ['DONE']);
      if (done) {
        Object.assign(next, { columnId: done.id, ...(await completionAt(current, 'DONE')) });
        columnChanged = true;
        event = 'SWITCHED_OFF';
      }
    }

    // Tasks scheduled for the future (owner, 10 Nov): once its start day changed, a task nobody has
    // started moves to that day's board (it waits again) — or, waiting, its start now today or earlier
    // (or cleared), onto today's. One under way, done or handed in stays (scheduled-start.ts). Judged
    // as this edit leaves it (a move made with it counts).
    const startDay = (d: Date | null | undefined) => (d ? dayOf(d) : null);
    if (next.startDate !== undefined && startDay(next.startDate) !== startDay(current.startDate)) {
      const target = next.columnId !== undefined && next.columnId !== current.columnId ? await tasks.findColumn(next.columnId) : null;
      const board = boardDayAfterStartEdit(
        {
          boardDate: next.boardDate !== undefined ? next.boardDate : (current.boardDate ?? null),
          columnCategory: target ? target.category : current.columnCategory,
          completedAt: next.completedAt !== undefined ? next.completedAt : current.completedAt,
          approvalRequestedAt: next.approvalRequestedAt !== undefined ? next.approvalRequestedAt : current.approvalRequestedAt,
        },
        next.startDate ?? null,
        timeZone,
        now(),
      );
      if (board) next.boardDate = board;
    }

    // Saved only if nobody changed the task since `expectedVersion`, in the same statement — the check
    // above answers early, this one also holds when two edits arrive together.
    let updated: TaskRecord;
    try {
      updated = await tasks.update(id, next, guardVersion !== undefined ? { expectedVersion: guardVersion } : undefined);
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

    if (columnChanged || event) await moved(updated, current.columnId, actorId, event ? { approval: event, requestedById: current.approvalRequestedById ?? null } : null);
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
    let patch: UpdateTaskData = { columnId };
    let event: ApprovalEvent | null = null;
    let guardVersion = opts.expectedVersion;
    if (columnId !== current.columnId) {
      const c = await columnChange(current, columnId, actorId);
      // It already waits and someone who can't approve finished it again: nothing changes.
      if (c.unchanged) return current;
      patch = c.patch;
      event = c.event;
      if (c.guarded && guardVersion === undefined) guardVersion = current.version;
    }
    // The drop position is for the column asked for (not where a task waiting for approval goes).
    if (position !== undefined && patch.columnId === columnId) patch.position = position;
    let after: TaskRecord;
    try {
      after = await tasks.update(id, patch, guardVersion !== undefined ? { expectedVersion: guardVersion } : undefined);
    } catch (err) {
      if (err instanceof TaskVersionConflictError) throw stale();
      throw err;
    }
    await moved(after, current.columnId, actorId, event ? { approval: event, requestedById: current.approvalRequestedById ?? null } : null);
    return after;
  }

  /**
   * Bulk lane (Undo of a bulk "Done" that left a task waiting where it was): its approval request is taken
   * back — saved only from the version just read; its people are told as for a request withdrawn by a move.
   * A task that isn't waiting is left as it is.
   */
  async function withdrawApproval(id: string, actorId: string): Promise<TaskRecord> {
    const current = await getTask(id);
    if (!isAwaitingApproval(current)) return current;
    let updated: TaskRecord;
    try {
      updated = await tasks.update(id, { approvalRequestedAt: null, approvalRequestedById: null }, { expectedVersion: current.version });
    } catch (err) {
      if (err instanceof TaskVersionConflictError) throw new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
      throw err;
    }
    await moved(updated, current.columnId, actorId, { approval: 'WITHDRAWN', requestedById: current.approvalRequestedById ?? null });
    return updated;
  }

  /** An approver's refusals, in order: may they (403), does it still wait (409), the version they saw (409). */
  async function waitingForApprover(id: string, actorId: string, expectedVersion?: number): Promise<TaskRecord> {
    const current = await getTask(id);
    if (!(await mayApprove(actorId, current.projectId))) throw new ForbiddenError(APPROVAL_WORDS.notApprover);
    if (!isAwaitingApproval(current)) throw new ConflictError(APPROVAL_WORDS.notWaiting, 'NOT_WAITING');
    if (expectedVersion !== undefined && current.version !== expectedVersion) throw new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
    return current;
  }

  /** What follows a saved decision (history, notices, the comment, the next copy): a failure is reported, never thrown — the decision stands. */
  async function afterDecision(updated: TaskRecord, current: TaskRecord, actorId: string, extra: MoveExtra): Promise<void> {
    try {
      await moved(updated, current.columnId, actorId, extra);
    } catch (err) {
      if (!onError) throw err;
      onError(err, updated.id);
    }
  }

  /** Save an approver's decision from the version just read: when another came first, it isn't waiting any more. */
  async function saveDecision(current: TaskRecord, patch: UpdateTaskData): Promise<TaskRecord> {
    try {
      return await tasks.update(current.id, patch, { expectedVersion: current.version });
    } catch (err) {
      if (!(err instanceof TaskVersionConflictError)) throw err;
      const fresh = await tasks.findById(current.id);
      if (!fresh || !isAwaitingApproval(fresh)) throw new ConflictError(APPROVAL_WORDS.notWaiting, 'NOT_WAITING');
      throw new ConflictError('This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
    }
  }

  /**
   * Approve a task that waits for approval: it moves to its project's first Done column and is done
   * now (completed at the approval time), approved by `actorId` — who must run the project (or be an
   * admin). A repeating task's next copy follows (onMoved).
   */
  async function approveTask(id: string, actorId: string, opts: { expectedVersion?: number } = {}): Promise<TaskRecord> {
    const current = await waitingForApprover(id, actorId, opts.expectedVersion);
    const done = pickColumn(await approvals!.columnsOf(current.projectId), ['DONE']);
    if (!done) throw new ConflictError(APPROVAL_WORDS.noDone, 'NO_DONE_COLUMN');
    const at = now();
    const updated = await saveDecision(current, {
      columnId: done.id,
      ...(await completionAt(current, 'DONE', at)),
      approvedAt: at,
      approvedById: actorId,
      approvalRequestedAt: null,
      approvalRequestedById: null,
    });
    await afterDecision(updated, current, actorId, { approval: 'APPROVED', requestedById: current.approvalRequestedById ?? null });
    return updated;
  }

  /**
   * Send a waiting task back, with a reason (required): it goes to the project's first In progress
   * column (else To do, else Backlog, else it stays where it is), no longer waiting. The reason becomes
   * the approver's comment and goes to the people on the task (onMoved).
   */
  async function sendBackTask(id: string, actorId: string, reason: string, opts: { expectedVersion?: number } = {}): Promise<TaskRecord> {
    const current = await waitingForApprover(id, actorId, opts.expectedVersion);
    const text = reason.trim();
    if (!text) throw new ValidationError(APPROVAL_WORDS.noReason);
    if (text.length > SEND_BACK_REASON_MAX) throw new ValidationError(APPROVAL_WORDS.longReason);
    const back = pickColumn(await approvals!.columnsOf(current.projectId), SEND_BACK_CATEGORIES);
    const target = back ?? { id: current.columnId, category: current.columnCategory ?? 'TODO' };
    const updated = await saveDecision(current, { columnId: target.id, ...(await completionAt(current, target.category)), approvalRequestedAt: null, approvalRequestedById: null });
    await afterDecision(updated, current, actorId, { approval: 'SENT_BACK', reason: text, requestedById: current.approvalRequestedById ?? null });
    return updated;
  }

  /**
   * Delete a task: it goes to the Recycle Bin, saying who deleted it (`actorId`), when, and when it will
   * be erased (60 days: bin-rules). With scope 'series' on a recurring task, delete the whole series
   * (every live instance sharing its recurrenceParentId, plus the origin task) as one batch, so it
   * restores as one. Otherwise just this occurrence — and when it is the newest copy of a series, the
   * `onDeleting` hook makes the next copy first, so the series carries on. Says which tasks went.
   */
  async function deleteTask(id: string, scope: 'one' | 'series' = 'one', actorId?: string): Promise<{ ids: string[]; batchId: string | null }> {
    const task = await getTask(id);
    const recurs = Boolean(task.recurrenceRule || task.recurrenceParentId);
    const at = now();
    const mark = (batchId: string | null): BinMark => ({ by: actorId ?? null, at, expiresAt: binExpiryOf(at, timeZone), batchId });
    if (scope === 'series' && recurs) {
      const seriesId = task.recurrenceParentId ?? task.id;
      const batchId = randomUUID();
      const ids = await tasks.softDeleteSeries(seriesId, mark(batchId));
      return { ids: ids ?? [], batchId };
    }
    await onDeleting?.(task);
    await tasks.softDelete(id, mark(null));
    return { ids: [id], batchId: null };
  }

  /**
   * Re-sequence a column's live tasks to match `orderedIds` (position 0..n), for intra-column
   * drag reordering. Ids that aren't live tasks of this column are ignored.
   */
  async function reorderColumn(columnId: string, orderedIds: string[]): Promise<void> {
    await tasks.reorderInColumn(columnId, orderedIds);
  }

  return { createTask, listTasks, getTask, getColumn, updateTask, moveTask, approveTask, sendBackTask, withdrawApproval, deleteTask, reorderColumn, timeZone };
}

export type TaskService = ReturnType<typeof createTaskService>;
