import { HttpError, NotFoundError, ValidationError } from '../../../lib/http-errors';
import { PROJECT_ARCHIVED_CODE, PROJECT_ARCHIVED_MESSAGE, TASK_ARCHIVED_CODE, TASK_ARCHIVED_MESSAGE } from '../../companies/archive-guard';
import { pickColumn } from '../task-approval';
import type { CreateNotificationData } from '../../notifications/notification-repository';
import type { ArchiveResult } from '../task-archive';

/**
 * Bulk task changes (owner, 10 Nov 2026). Anyone may select tasks; ONE change is applied to up to 500 of
 * them, each task checked by the same rules as its single-task change (who may see it, an archived project
 * or task, its project's team, approvals, the delete rule, the guests rule …). A dry run (the website's
 * confirmation) says what would change and what would be skipped and why, writing nothing. Applying says
 * the same of what happened, keeps each changed task's before/after values for a short Undo (only fields
 * nobody changed since are put back), writes one audit line, sends ONE combined notice per person and one
 * live update per project. A task the person can't open is "not found" and never named.
 */

export const MAX_BULK_TASKS = 500;
export const MAX_BULK_DUPLICATES = 50;
/** How long Undo is kept on the server (the website offers it for 15 seconds). */
export const BULK_UNDO_MS = 30_000;

export const BULK_STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE'] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];
export type BulkPriority = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';

export type BulkAction =
  | { type: 'status'; status: BulkStatus }
  | { type: 'priority'; priority: BulkPriority }
  | { type: 'assign'; userIds: string[] }
  | { type: 'reassign'; userIds: string[] }
  | { type: 'unassign'; userIds?: string[] }
  | { type: 'dueDate'; mode: 'set'; date: string }
  | { type: 'dueDate'; mode: 'clear' }
  | { type: 'dueDate'; mode: 'shift'; days: number }
  | { type: 'project'; projectId: string; columnId?: string; assignees?: 'ADD_TO_TEAM' | 'UNASSIGN' }
  | { type: 'category'; add?: string[]; remove?: string[] }
  | { type: 'guests'; add: string[] }
  | { type: 'duplicate' }
  | { type: 'archive' }
  | { type: 'unarchive' }
  | { type: 'delete' };
export type BulkActionType = BulkAction['type'];

export interface BulkActor {
  id: string;
  roles: string[];
}

/** A live task (not deleted or merged; archived or not) as bulk changes read it. */
export interface BulkTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  columnId: string;
  columnCategory: string | null;
  completedAt: Date | null;
  priority: BulkPriority;
  /** Its due day ('YYYY-MM-DD', company calendar) and start day. */
  dueDay: string | null;
  startDay: string | null;
  needsApproval: boolean;
  approvalRequestedAt: Date | null;
  archivedAt: Date | null;
  assigneeIds: string[];
  /** Its guests (guest ids). */
  guestIds: string[];
  categoryIds: string[];
  isMilestone: boolean;
}

export interface BulkNote {
  code: string;
  text: string;
}

export interface BulkChanged {
  id: string;
  key: string;
  title: string;
  projectId: string;
  note?: BulkNote;
  copy?: { id: string; key: string };
}

export interface BulkSkipped {
  id: string;
  key?: string;
  title?: string;
  code: string;
  reason: string;
}

export interface BulkResult {
  action: BulkActionType;
  dryRun: boolean;
  total: number;
  changed: BulkChanged[];
  skipped: BulkSkipped[];
  undo: { id: string; until: string } | null;
}

export interface BulkUndoResult {
  restored: { id: string; key: string; title: string; projectId: string }[];
  skipped: BulkSkipped[];
}

/** What Undo needs of one changed task (kept as JSON with the bulk action). */
export type UndoEntry =
  | { kind: 'status'; taskId: string; beforeColumnId: string; afterColumnId: string; waits: boolean }
  | { kind: 'priority'; taskId: string; before: BulkPriority; after: BulkPriority }
  | { kind: 'people'; taskId: string; before: string[]; after: string[] }
  | { kind: 'due'; taskId: string; before: string | null; after: string | null }
  | { kind: 'project'; taskId: string; before: { projectId: string; columnId: string; key: string; assigneeIds: string[]; categoryIds: string[]; isMilestone: boolean }; afterProjectId: string }
  | { kind: 'categories'; taskId: string; before: string[]; after: string[] }
  | { kind: 'guests'; taskId: string; added: string[] }
  | { kind: 'copy'; taskId: string; copyId: string }
  | { kind: 'archive'; taskId: string; archived: boolean }
  | { kind: 'delete'; taskId: string };

/** A saved bulk action (for its Undo). */
export interface BulkRecord {
  id: string;
  actorId: string;
  action: BulkActionType;
  undoUntil: Date;
  undoneAt: Date | null;
  entries: UndoEntry[];
}

/** A project move as the move service answers it (preview and the move itself), task by task. */
export interface MovePorts {
  preview(actor: BulkActor, taskIds: string[], projectId: string): Promise<{ tasks: { id: string; canMove: boolean; reason: string | null; outsiders: { id: string }[] }[] }>;
  move(actor: BulkActor, taskIds: string[], input: { projectId: string; columnId?: string; assignees?: 'ADD_TO_TEAM' | 'UNASSIGN' }): Promise<{ results: ({ taskId: string; ok: true; task: { key: string; projectId: string } } | { taskId: string; ok: false; error: { code: string; message: string } })[] }>;
  /** Undo: back into its old project and column, its old number back when it is still its own. */
  moveBack(actor: BulkActor, taskId: string, to: { projectId: string; columnId: string; key: string }): Promise<void>;
}

export interface TaskBulkPorts {
  /** These live tasks (archived or not); ids not found are left out. */
  load(ids: string[]): Promise<BulkTask[]>;
  /** May this person open the project's tasks (the task view rule)? */
  canViewProject(actor: BulkActor, projectId: string): Promise<boolean>;
  projectName(projectId: string): Promise<string>;
  isProjectArchived(projectId: string): Promise<boolean>;
  columnsOf(projectId: string): Promise<{ id: string; name: string; category: string; position: number; enabled: boolean }[]>;
  canApprove(actor: BulkActor, projectId: string): Promise<boolean>;
  /** Of these people, those who may be assigned in the project. */
  assignableIn(projectId: string, userIds: string[]): Promise<string[]>;
  namesOf(userIds: string[]): Promise<Map<string, string>>;
  /** The project's categories (and its "every task needs a category" switch). */
  categoriesOf(projectId: string): Promise<{ requireCategory: boolean; categories: { id: string; name: string; retired: boolean }[] }>;
  /** The guests that may be put on the project's tasks (its company list, not retired): id → name. */
  guestsFor(actor: BulkActor, projectId: string, guestIds: string[]): Promise<Map<string, string>>;

  // The single-task changes (each throws an HttpError to refuse, as its route would).
  moveToColumn(actor: BulkActor, taskId: string, columnId: string): Promise<{ columnId: string; waits: boolean }>;
  withdrawApproval(actor: BulkActor, taskId: string): Promise<void>;
  setPriority(actor: BulkActor, taskId: string, priority: BulkPriority): Promise<void>;
  setDueDay(actor: BulkActor, taskId: string, day: string | null): Promise<void>;
  addPeople(actor: BulkActor, taskId: string, userIds: string[]): Promise<void>;
  removePerson(actor: BulkActor, taskId: string, userId: string): Promise<void>;
  setCategories(actor: BulkActor, taskId: string, categoryIds: string[]): Promise<void>;
  addGuest(actor: BulkActor, taskId: string, guestId: string): Promise<void>;
  removeGuest(actor: BulkActor, taskId: string, guestId: string): Promise<void>;
  move: MovePorts;
  /** A copy made without a review ("… (copy)", files too): Duplicate's own rules. */
  duplicate(actor: BulkActor, taskId: string): Promise<{ id: string; key: string }>;
  /** Undo of a copy: erase it at once (never the Recycle Bin) — only a copy this person made, still as made. */
  eraseCopy(actor: BulkActor, copyId: string): Promise<boolean>;
  archive: {
    plan(actor: BulkActor, taskIds: string[], archiving: boolean): Promise<ArchiveResult>;
    archive(actor: BulkActor, taskIds: string[]): Promise<ArchiveResult>;
    unarchive(actor: BulkActor, taskIds: string[]): Promise<ArchiveResult>;
  };
  /** The delete rule for one task: null when they may, else why not. */
  deleteRefusal(actor: BulkActor, taskId: string): Promise<string | null>;
  deleteTask(actor: BulkActor, taskId: string): Promise<void>;
  /** Undo of a delete: restore from the Recycle Bin (its own rules). */
  restore(actor: BulkActor, taskIds: string[]): Promise<{ restored: string[]; refused: { id: string; message: string }[] }>;

  store: {
    save(r: Omit<BulkRecord, 'id' | 'undoneAt'> & { changed: number }): Promise<string>;
    find(id: string): Promise<BulkRecord | null>;
    /** Mark it undone — only once (false: it already was). */
    claim(id: string, at: Date): Promise<boolean>;
  };
  /** Run the changes gathering their notices; then deliver one per person. */
  collectNotices<T>(fn: () => Promise<T>): Promise<{ result: T; notices: CreateNotificationData[] }>;
  deliverNotices(notices: CreateNotificationData[], ctx: { actorId: string; projectOf: Map<string, string> }): Promise<void>;
  audit?(entry: { userId: string; module: string; action: string; entityId: string | null; newValue: Record<string, unknown>; ip?: string | null }): Promise<unknown>;
  broadcast?(projectId: string, event: string, payload: unknown): void;
  onError?(err: unknown, what: string): void;
  now?(): Date;
}

const NOT_FOUND = 'Task not found.';
const STATUS_WORD: Record<BulkStatus, string> = { BACKLOG: 'Backlog', TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', REVIEW: 'Review', DONE: 'Done' };
const PRIORITY_WORD: Record<BulkPriority, string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
const WAITS: BulkNote = { code: 'WAITS_FOR_APPROVAL', text: 'Waits for approval' };

/** "Sara", "Sara and Omar", "Sara, Omar and Nadia". */
function namesText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A calendar day moved by `days` ('YYYY-MM-DD'). */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** A refusal from a single-task change, as a skip (anything unexpected: a plain sentence, logged). */
function skipOf(err: unknown): { code: string; reason: string } {
  if (err instanceof HttpError) {
    const code = (err.details as { code?: string } | undefined)?.code ?? err.code;
    return { code, reason: err.message };
  }
  return { code: 'INTERNAL', reason: 'Something went wrong changing this task.' };
}

class Skip extends Error {
  constructor(
    readonly code: string,
    readonly reason: string,
  ) {
    super(reason);
  }
}

export function createTaskBulkService(ports: TaskBulkPorts) {
  const now = ports.now ?? (() => new Date());

  /** Per request: each project read once. */
  function reader(actor: BulkActor) {
    const memo = <T>() => new Map<string, Promise<T>>();
    const seen = memo<boolean>();
    const names = memo<string>();
    const closed = memo<boolean>();
    const cols = memo<Awaited<ReturnType<TaskBulkPorts['columnsOf']>>>();
    const approver = memo<boolean>();
    const once = <T>(m: Map<string, Promise<T>>, k: string, f: () => Promise<T>) => {
      let p = m.get(k);
      if (!p) m.set(k, (p = f()));
      return p;
    };
    return {
      sees: (p: string) => once(seen, p, () => ports.canViewProject(actor, p)),
      name: (p: string) => once(names, p, () => ports.projectName(p)),
      archived: (p: string) => once(closed, p, () => ports.isProjectArchived(p)),
      columns: (p: string) => once(cols, p, () => ports.columnsOf(p)),
      approves: (p: string) => once(approver, p, () => ports.canApprove(actor, p)),
    };
  }
  type Reader = ReturnType<typeof reader>;

  function validate(action: BulkAction, count: number): void {
    if (count > MAX_BULK_TASKS) throw new HttpError(`At most ${MAX_BULK_TASKS} tasks at a time.`, 'TOO_MANY', 400);
    if (action.type === 'duplicate' && count > MAX_BULK_DUPLICATES) throw new HttpError(`Duplicate at most ${MAX_BULK_DUPLICATES} tasks at a time.`, 'TOO_MANY', 400);
    if (action.type === 'category' && (action.add ?? []).length + (action.remove ?? []).length === 0) throw new ValidationError('Pick a category to add or remove.');
  }

  /**
   * The checks every change shares, in order: a task the person can't open (or that isn't there) is "not
   * found"; an archived project's tasks and archived tasks are read-only. Archiving, unarchiving, deleting
   * and duplicating have their own (an archived task can be unarchived, deleted or copied).
   */
  async function common(t: BulkTask | undefined, r: Reader, type: BulkActionType): Promise<void> {
    if (!t || !(await r.sees(t.projectId))) throw new Skip('NOT_FOUND', NOT_FOUND);
    // Deleting is never refused for an archived project or task (as today); archiving has its own rules.
    if (type === 'archive' || type === 'unarchive' || type === 'delete') return;
    if (await r.archived(t.projectId)) throw new Skip(PROJECT_ARCHIVED_CODE, PROJECT_ARCHIVED_MESSAGE);
    // An archived task can still be copied (the copy is a new, live task).
    if (t.archivedAt && type !== 'duplicate') throw new Skip(TASK_ARCHIVED_CODE, TASK_ARCHIVED_MESSAGE);
  }

  // ── Each change: `check` says (without writing) whether a task would change and how; `apply` changes it. ──

  interface Plan {
    note?: BulkNote;
    /** What apply needs (worked out once). */
    data?: unknown;
  }
  interface Applied {
    undo?: UndoEntry;
    note?: BulkNote;
    copy?: { id: string; key: string };
  }
  interface Handler {
    check(t: BulkTask, r: Reader, actor: BulkActor): Promise<Plan>;
    apply(t: BulkTask, plan: Plan, r: Reader, actor: BulkActor): Promise<Applied>;
  }

  function handlerFor(action: BulkAction, names: Map<string, string>): Handler {
    const name = (id: string) => names.get(id) ?? 'Someone';
    switch (action.type) {
      case 'status':
        return {
          async check(t, r) {
            const column = pickColumn(
              (await r.columns(t.projectId)).filter((c) => c.category === action.status),
              [action.status],
            );
            if (!column) throw new Skip('NO_COLUMN', `${await r.name(t.projectId)} has no ${STATUS_WORD[action.status]} column.`);
            if (t.columnCategory === action.status) throw new Skip('UNCHANGED', `Already ${STATUS_WORD[action.status]}.`);
            // A task needing approval finished by someone who can't approve waits for approval (as one finished alone).
            const waits = action.status === 'DONE' && t.needsApproval && !t.completedAt && !(await r.approves(t.projectId));
            if (waits && t.approvalRequestedAt) throw new Skip('UNCHANGED', 'It is already waiting for approval.');
            return { ...(waits ? { note: WAITS } : {}), data: column.id };
          },
          async apply(t, plan, _r, actor) {
            const moved = await ports.moveToColumn(actor, t.id, plan.data as string);
            return {
              undo: { kind: 'status', taskId: t.id, beforeColumnId: t.columnId, afterColumnId: moved.columnId, waits: moved.waits },
              ...(moved.waits ? { note: WAITS } : {}),
            };
          },
        };
      case 'priority':
        return {
          async check(t) {
            if (t.priority === action.priority) throw new Skip('UNCHANGED', `Already ${PRIORITY_WORD[action.priority]}.`);
            return {};
          },
          async apply(t, _p, _r, actor) {
            await ports.setPriority(actor, t.id, action.priority);
            return { undo: { kind: 'priority', taskId: t.id, before: t.priority, after: action.priority } };
          },
        };
      case 'assign':
      case 'reassign': {
        const wanted = [...new Set(action.userIds)];
        return {
          async check(t, r) {
            const ok = new Set(await ports.assignableIn(t.projectId, wanted));
            const outside = wanted.filter((id) => !ok.has(id));
            if (outside.length) throw new Skip('NOT_ON_TEAM', `${namesText(outside.map(name))} ${outside.length === 1 ? 'isn’t' : 'aren’t'} on the ${await r.name(t.projectId)} team.`);
            const after = action.type === 'assign' ? [...new Set([...t.assigneeIds, ...wanted])] : wanted;
            if (sameSet(after, t.assigneeIds)) throw new Skip('UNCHANGED', action.type === 'assign' ? 'Already assigned to them.' : 'Already assigned to exactly them.');
            return { data: after };
          },
          async apply(t, plan, _r, actor) {
            const after = plan.data as string[];
            const adding = after.filter((id) => !t.assigneeIds.includes(id));
            if (adding.length) await ports.addPeople(actor, t.id, adding);
            // Added first, then taken off: a task with guests always keeps someone from the team.
            for (const id of t.assigneeIds.filter((x) => !after.includes(x))) await ports.removePerson(actor, t.id, id);
            return { undo: { kind: 'people', taskId: t.id, before: t.assigneeIds, after } };
          },
        };
      }
      case 'unassign': {
        const who = action.userIds ? [...new Set(action.userIds)] : null;
        return {
          async check(t) {
            const leaving = who ? t.assigneeIds.filter((id) => who.includes(id)) : t.assigneeIds;
            if (leaving.length === 0) throw new Skip('UNCHANGED', who ? 'They aren’t assigned to it.' : 'Nobody is assigned to it.');
            const after = t.assigneeIds.filter((id) => !leaving.includes(id));
            // The guests rule (call 5): guests always need someone from the team.
            if (t.guestIds.length > 0 && after.length === 0) throw new Skip('NEEDS_TEAM_MEMBER', 'It has guests, so it needs at least one person from the team.');
            return { data: after };
          },
          async apply(t, plan, _r, actor) {
            const after = plan.data as string[];
            for (const id of t.assigneeIds.filter((x) => !after.includes(x))) await ports.removePerson(actor, t.id, id);
            return { undo: { kind: 'people', taskId: t.id, before: t.assigneeIds, after } };
          },
        };
      }
      case 'dueDate':
        return {
          async check(t) {
            let due: string | null;
            if (action.mode === 'set') due = action.date;
            else if (action.mode === 'clear') due = null;
            else {
              if (!t.dueDay) throw new Skip('NO_DUE_DATE', 'It has no due date to move.');
              due = shiftDay(t.dueDay, action.days);
            }
            if (due === t.dueDay) throw new Skip('UNCHANGED', due ? 'Already due that day.' : 'It has no due date.');
            if (due && t.startDay && t.startDay > due) throw new Skip('START_AFTER_DUE', 'It starts after that day: the start date must be on or before the due date.');
            return { data: due };
          },
          async apply(t, plan, _r, actor) {
            const due = plan.data as string | null;
            await ports.setDueDay(actor, t.id, due);
            return { undo: { kind: 'due', taskId: t.id, before: t.dueDay, after: due } };
          },
        };
      case 'category': {
        const add = [...new Set(action.add ?? [])];
        const remove = [...new Set(action.remove ?? [])];
        return {
          async check(t, r) {
            const { requireCategory, categories } = await ports.categoriesOf(t.projectId);
            const mine = new Map(categories.map((c) => [c.id, c]));
            if ([...add, ...remove].some((id) => !mine.has(id))) throw new Skip('CATEGORY_OTHER_PROJECT', `Those categories aren’t ${await r.name(t.projectId)}’s.`);
            if (add.some((id) => mine.get(id)!.retired)) throw new Skip('CATEGORY_RETIRED', 'A retired category can’t be given to a task.');
            const after = [...new Set([...t.categoryIds.filter((id) => !remove.includes(id)), ...add])];
            if (sameSet(after, t.categoryIds)) throw new Skip('UNCHANGED', add.length ? 'It already has them.' : 'It doesn’t have them.');
            if (after.length === 0 && requireCategory) throw new Skip('CATEGORY_REQUIRED', `Every task in ${await r.name(t.projectId)} needs a category.`);
            return { data: after };
          },
          async apply(t, plan, _r, actor) {
            const after = plan.data as string[];
            await ports.setCategories(actor, t.id, after);
            return { undo: { kind: 'categories', taskId: t.id, before: t.categoryIds, after } };
          },
        };
      }
      case 'guests': {
        const add = [...new Set(action.add)];
        return {
          async check(t, r, actor) {
            const listed = await ports.guestsFor(actor, t.projectId, add);
            if (add.some((id) => !listed.has(id))) throw new Skip('GUEST_OTHER_LIST', `Those guests aren’t on ${await r.name(t.projectId)}’s guest list.`);
            const adding = add.filter((id) => !t.guestIds.includes(id));
            if (adding.length === 0) throw new Skip('UNCHANGED', 'They are already on it.');
            if (t.assigneeIds.length === 0) throw new Skip('NEEDS_TEAM_MEMBER', 'Assign someone from the team first: guests need a team member on the task.');
            return { data: adding };
          },
          async apply(t, plan, _r, actor) {
            const added: string[] = [];
            try {
              for (const g of plan.data as string[]) {
                await ports.addGuest(actor, t.id, g);
                added.push(g);
              }
            } catch (err) {
              // Some went on before one was refused: those count (Undo takes them off).
              if (added.length === 0) throw err;
            }
            return { undo: { kind: 'guests', taskId: t.id, added } };
          },
        };
      }
      case 'duplicate':
        return {
          async check() {
            return {};
          },
          async apply(t, _p, _r, actor) {
            const copy = await ports.duplicate(actor, t.id);
            return { copy, undo: { kind: 'copy', taskId: t.id, copyId: copy.id } };
          },
        };
      case 'delete':
        return {
          async check(t, _r, actor) {
            const why = await ports.deleteRefusal(actor, t.id);
            if (why) throw new Skip('DELETE_NOT_ALLOWED', why);
            return {};
          },
          async apply(t, _p, _r, actor) {
            await ports.deleteTask(actor, t.id);
            return { undo: { kind: 'delete', taskId: t.id } };
          },
        };
      default:
        throw new Error(`no per-task handler for ${action.type}`);
    }
  }

  /** The tasks asked for, in order, once each, with what each verdict needs. */
  async function read(taskIds: string[]) {
    const ids = [...new Set(taskIds)];
    const byId = new Map((await ports.load(ids)).map((t) => [t.id, t]));
    return { ids, byId };
  }

  const named = (t: BulkTask) => ({ id: t.id, key: t.key, title: t.title, projectId: t.projectId });

  async function run(actor: BulkActor, input: { taskIds: string[]; action: BulkAction; dryRun?: boolean; ip?: string | null }): Promise<BulkResult> {
    const { action } = input;
    const dryRun = Boolean(input.dryRun);
    validate(action, new Set(input.taskIds).size);
    const { ids, byId } = await read(input.taskIds);
    const r = reader(actor);
    const changed: BulkChanged[] = [];
    const skipped: BulkSkipped[] = [];
    const undo: UndoEntry[] = [];
    const skip = (id: string, t: BulkTask | undefined, code: string, reason: string, visible: boolean) =>
      skipped.push(visible && t ? { id, key: t.key, title: t.title, code, reason } : { id, code: 'NOT_FOUND', reason: NOT_FOUND });

    // Visibility first, for every action: what the person can't open is never named or looked at further.
    const visible = new Set<string>();
    for (const id of ids) {
      const t = byId.get(id);
      if (t && (await r.sees(t.projectId))) visible.add(id);
    }

    const work = async () => {
      if (action.type === 'archive' || action.type === 'unarchive') {
        const archiving = action.type === 'archive';
        const shown = ids.filter((id) => visible.has(id));
        const result = dryRun ? await ports.archive.plan(actor, shown, archiving) : archiving ? await ports.archive.archive(actor, shown) : await ports.archive.unarchive(actor, shown);
        const done = new Set(result.done.map((d) => d.id));
        const refusals = new Map(result.refused.map((x) => [x.id, x]));
        for (const id of ids) {
          const t = byId.get(id);
          if (!visible.has(id)) skip(id, t, 'NOT_FOUND', NOT_FOUND, false);
          else if (done.has(id)) {
            changed.push(named(t!));
            if (!dryRun) undo.push({ kind: 'archive', taskId: id, archived: archiving });
          } else {
            const x = refusals.get(id);
            skip(id, t, x?.code ?? 'NOT_FOUND', x?.message ?? NOT_FOUND, true);
          }
        }
        return;
      }

      if (action.type === 'project') {
        const shown: string[] = [];
        for (const id of ids) {
          const t = byId.get(id);
          if (!visible.has(id)) {
            skip(id, t, 'NOT_FOUND', NOT_FOUND, false);
            continue;
          }
          try {
            await common(t, r, 'project');
            shown.push(id);
          } catch (err) {
            if (!(err instanceof Skip)) throw err;
            skip(id, t, err.code, err.reason, true);
          }
        }
        if (shown.length === 0) return;
        if (dryRun) {
          const preview = await ports.move.preview(actor, shown, action.projectId);
          for (const p of preview.tasks) {
            const t = byId.get(p.id)!;
            if (!p.canMove) skip(p.id, t, 'CANT_MOVE', p.reason ?? 'It can’t be moved.', true);
            else if (p.outsiders.length > 0 && !action.assignees) skip(p.id, t, 'ASSIGNEES_NOT_ON_TEAM', 'Someone assigned to it isn’t on the new project’s team: choose to add them or unassign them.', true);
            else changed.push(named(t));
          }
          return;
        }
        const moved = await ports.move.move(actor, shown, { projectId: action.projectId, ...(action.columnId ? { columnId: action.columnId } : {}), ...(action.assignees ? { assignees: action.assignees } : {}) });
        for (const m of moved.results) {
          const t = byId.get(m.taskId)!;
          if (m.ok) {
            changed.push({ ...named(t), key: m.task.key, projectId: m.task.projectId });
            undo.push({
              kind: 'project',
              taskId: t.id,
              before: { projectId: t.projectId, columnId: t.columnId, key: t.key, assigneeIds: t.assigneeIds, categoryIds: t.categoryIds, isMilestone: t.isMilestone },
              afterProjectId: m.task.projectId,
            });
          } else skip(t.id, t, m.error.code, m.error.message, true);
        }
        return;
      }

      const people = action.type === 'assign' || action.type === 'reassign' || (action.type === 'unassign' && action.userIds) ? (action as { userIds: string[] }).userIds : [];
      const handler = handlerFor(action, await ports.namesOf(people));
      for (const id of ids) {
        const t = byId.get(id);
        if (!visible.has(id)) {
          skip(id, t, 'NOT_FOUND', NOT_FOUND, false);
          continue;
        }
        try {
          await common(t, r, action.type);
          const plan = await handler.check(t!, r, actor);
          if (dryRun) {
            changed.push({ ...named(t!), ...(plan.note ? { note: plan.note } : {}) });
            continue;
          }
          const done = await handler.apply(t!, plan, r, actor);
          changed.push({ ...named(t!), ...(done.note ? { note: done.note } : {}), ...(done.copy ? { copy: done.copy } : {}) });
          if (done.undo) undo.push(done.undo);
        } catch (err) {
          if (err instanceof Skip) skip(id, t, err.code, err.reason, true);
          else {
            if (!(err instanceof HttpError) || err.status >= 500) ports.onError?.(err, `bulk ${action.type} of a task`);
            const s = skipOf(err);
            skip(id, t, s.code === 'NOT_FOUND' ? 'NOT_FOUND' : s.code, s.code === 'NOT_FOUND' ? NOT_FOUND : s.reason, s.code !== 'NOT_FOUND');
          }
        }
      }
    };

    if (dryRun) {
      await work();
      return { action: action.type, dryRun, total: ids.length, changed, skipped, undo: null };
    }

    const { notices } = await ports.collectNotices(work);
    const projectOf = new Map([...byId.values()].map((t) => [t.id, t.projectId]));
    for (const c of changed) projectOf.set(c.id, c.projectId);
    try {
      await ports.deliverNotices(notices, { actorId: actor.id, projectOf });
    } catch (err) {
      ports.onError?.(err, 'the combined notices of a bulk change');
    }

    let undoRef: BulkResult['undo'] = null;
    if (changed.length) {
      const until = new Date(now().getTime() + BULK_UNDO_MS);
      try {
        const id = await ports.store.save({ actorId: actor.id, action: action.type, undoUntil: until, entries: undo, changed: changed.length });
        if (undo.length) undoRef = { id, until: until.toISOString() };
      } catch (err) {
        ports.onError?.(err, 'saving a bulk change for its Undo');
      }
      await audit(actor, `task.bulk.${action.type}`, { action: action.type, changed: changed.length, skipped: skipped.length, taskKeys: changed.map((c) => c.key).slice(0, MAX_BULK_TASKS) }, input.ip);
      announce(changed.map((c) => c.projectId), changed, byId);
    }
    return { action: action.type, dryRun, total: ids.length, changed, skipped, undo: undoRef };
  }

  async function audit(actor: BulkActor, action: string, newValue: Record<string, unknown>, ip?: string | null) {
    try {
      await ports.audit?.({ userId: actor.id, module: 'tasks', action, entityId: null, newValue, ip: ip ?? null });
    } catch (err) {
      ports.onError?.(err, 'the audit log line of a bulk change');
    }
  }

  /** One live update per project (its boards refetch), naming the tasks that changed there. */
  function announce(_projects: string[], changed: { id: string; projectId: string }[], before: Map<string, BulkTask>) {
    const byProject = new Map<string, Set<string>>();
    const add = (p: string, id: string) => byProject.set(p, (byProject.get(p) ?? new Set()).add(id));
    for (const c of changed) {
      add(c.projectId, c.id);
      const was = before.get(c.id)?.projectId;
      if (was && was !== c.projectId) add(was, c.id); // a move: the old board loses it
    }
    for (const [projectId, ids] of byProject) {
      try {
        ports.broadcast?.(projectId, 'task:updated', { bulk: true, ids: [...ids] });
      } catch (err) {
        ports.onError?.(err, 'a live update of a bulk change');
      }
    }
  }

  // ── Undo ────────────────────────────────────────────────────────────────────────────────────────

  const CHANGED_SINCE = 'Changed since — left as it is.';

  /**
   * Put back what a bulk change did: only the person who made it, inside its window, once. Each task is
   * checked again — still one they may change (it may have been archived, or its project archived, since),
   * and the field still as the change left it (else "changed since" and left alone).
   */
  async function undo(actor: BulkActor, bulkId: string, opts: { ip?: string | null } = {}): Promise<BulkUndoResult> {
    const rec = await ports.store.find(bulkId);
    if (!rec || rec.actorId !== actor.id) throw new NotFoundError('That change isn’t there.');
    if (rec.undoneAt) throw new HttpError('This was already undone.', 'UNDO_DONE', 409);
    if (now().getTime() > rec.undoUntil.getTime()) throw new HttpError('Undo is no longer available.', 'UNDO_EXPIRED', 409);
    if (!(await ports.store.claim(bulkId, now()))) throw new HttpError('This was already undone.', 'UNDO_DONE', 409);

    const restored: BulkUndoResult['restored'] = [];
    const skipped: BulkSkipped[] = [];
    const taskIds = rec.entries.map((e) => e.taskId);
    const work = async () => {
      // Deletes come back together (the bin's own rules); copies are erased; the rest task by task.
      if (rec.action === 'delete') {
        const back = await ports.restore(actor, taskIds);
        const now = new Map((await ports.load(back.restored)).map((t) => [t.id, t]));
        for (const id of back.restored) {
          const t = now.get(id);
          if (t) restored.push(named(t));
        }
        for (const x of back.refused) skipped.push({ id: x.id, code: 'NOT_RESTORED', reason: x.message });
        return;
      }
      const r = reader(actor);
      const current = new Map((await ports.load([...new Set([...taskIds, ...rec.entries.flatMap((e) => (e.kind === 'copy' ? [e.copyId] : []))])])).map((t) => [t.id, t]));
      for (const e of rec.entries) {
        const t = current.get(e.taskId);
        try {
          if (!t || !(await r.sees(t.projectId))) throw new Skip('NOT_FOUND', NOT_FOUND);
          if (e.kind === 'copy') {
            const copy = current.get(e.copyId);
            if (!copy || !(await ports.eraseCopy(actor, e.copyId))) throw new Skip('CHANGED_SINCE', 'Its copy was changed or removed since — left as it is.');
            restored.push(named(t));
            continue;
          }
          if (e.kind === 'archive') {
            if (Boolean(t.archivedAt) !== e.archived) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
            const res = e.archived ? await ports.archive.unarchive(actor, [t.id]) : await ports.archive.archive(actor, [t.id]);
            if (res.refused[0]) throw new Skip(res.refused[0].code, res.refused[0].message);
            restored.push(named(t));
            continue;
          }
          // Everything else: the task must still take changes.
          if (await r.archived(t.projectId)) throw new Skip(PROJECT_ARCHIVED_CODE, PROJECT_ARCHIVED_MESSAGE);
          if (t.archivedAt) throw new Skip(TASK_ARCHIVED_CODE, TASK_ARCHIVED_MESSAGE);
          await undoOne(actor, e, t);
          restored.push(named(t));
        } catch (err) {
          if (err instanceof Skip) skipped.push(t && err.code !== 'NOT_FOUND' ? { id: e.taskId, key: t.key, title: t.title, code: err.code, reason: err.reason } : { id: e.taskId, code: 'NOT_FOUND', reason: NOT_FOUND });
          else {
            if (!(err instanceof HttpError) || err.status >= 500) ports.onError?.(err, 'undoing a bulk change of a task');
            const s = skipOf(err);
            skipped.push(t ? { id: e.taskId, key: t.key, title: t.title, code: s.code, reason: s.reason } : { id: e.taskId, code: 'NOT_FOUND', reason: NOT_FOUND });
          }
        }
      }
    };
    const { notices } = await ports.collectNotices(work);
    const projectOf = new Map<string, string>(restored.map((x) => [x.id, x.projectId]));
    try {
      await ports.deliverNotices(notices, { actorId: actor.id, projectOf });
    } catch (err) {
      ports.onError?.(err, 'the combined notices of an Undo');
    }
    if (restored.length) {
      await audit(actor, `task.bulk.${rec.action}.undone`, { bulkId, restored: restored.length, skipped: skipped.length, taskKeys: restored.map((x) => x.key) }, opts.ip);
      // A move put back: its old board (where it is now) hears it too.
      const back = rec.entries.flatMap((e) => (e.kind === 'project' && restored.some((x) => x.id === e.taskId) ? [{ id: e.taskId, projectId: e.before.projectId }] : []));
      announce([], [...restored, ...back], new Map());
    }
    return { restored, skipped };
  }

  /** One task's Undo, field by field as the change left it. */
  async function undoOne(actor: BulkActor, e: UndoEntry, t: BulkTask): Promise<void> {
    switch (e.kind) {
      case 'status':
        if (t.columnId !== e.afterColumnId) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
        if (e.beforeColumnId !== e.afterColumnId) await ports.moveToColumn(actor, t.id, e.beforeColumnId);
        else if (e.waits) {
          if (!t.approvalRequestedAt) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
          await ports.withdrawApproval(actor, t.id);
        }
        return;
      case 'priority':
        if (t.priority !== e.after) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
        await ports.setPriority(actor, t.id, e.before);
        return;
      case 'due':
        if (t.dueDay !== e.after) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
        await ports.setDueDay(actor, t.id, e.before);
        return;
      case 'people': {
        if (!sameSet(t.assigneeIds, e.after)) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
        const adding = e.before.filter((id) => !t.assigneeIds.includes(id));
        if (adding.length) {
          // Someone who has left the project's team since can't be put back on (the single-task rule).
          const ok = await ports.assignableIn(t.projectId, adding);
          if (ok.length) await ports.addPeople(actor, t.id, ok);
        }
        for (const id of t.assigneeIds.filter((x) => !e.before.includes(x))) await ports.removePerson(actor, t.id, id);
        return;
      }
      case 'categories':
        if (!sameSet(t.categoryIds, e.after)) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
        await ports.setCategories(actor, t.id, e.before);
        return;
      case 'guests': {
        const still = e.added.filter((g) => t.guestIds.includes(g));
        if (still.length === 0) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
        for (const g of still) await ports.removeGuest(actor, t.id, g);
        return;
      }
      case 'project': {
        if (t.projectId !== e.afterProjectId) throw new Skip('CHANGED_SINCE', CHANGED_SINCE);
        await ports.move.moveBack(actor, t.id, { projectId: e.before.projectId, columnId: e.before.columnId, key: e.before.key });
        // What the move took with it: the people it took off (still on the old team), its categories, its milestone.
        const back = (await ports.load([t.id]))[0];
        if (back) {
          const missing = e.before.assigneeIds.filter((id) => !back.assigneeIds.includes(id));
          if (missing.length) {
            const ok = await ports.assignableIn(back.projectId, missing);
            if (ok.length) await ports.addPeople(actor, t.id, ok);
          }
          if (!sameSet(back.categoryIds, e.before.categoryIds)) {
            const live = new Set((await ports.categoriesOf(back.projectId)).categories.map((c) => c.id));
            await ports.setCategories(actor, t.id, e.before.categoryIds.filter((id) => live.has(id))).catch((err) => ports.onError?.(err, 'restoring categories after a move'));
          }
        }
        return;
      }
      default:
        return;
    }
  }

  return { run, undo };
}

export type TaskBulkService = ReturnType<typeof createTaskBulkService>;
