import { ForbiddenError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { dueDayKey } from '../../lib/due-date';
import { firstOpenColumn, pickColumn, type PickableColumn } from './task-approval';
import { createNewTask, NO_PROJECT_ACCESS, type CreatedTask, type NewTaskBody, type NewTaskPipeline, type TaskActor } from './task-create';
import { noteActivity, type RecordTaskActivity } from '../activity/task-activity';
import type { ChecklistTree } from './checklist-tree';
import type { ExternalContactFields } from './external-contacts';
import type { Priority } from './task-repository';
import { VARCHAR_MAX } from './validation';

/**
 * Duplicate Task (owner, 10 Nov 2026): a new task made from an existing one — reviewed in the New task
 * form, then created exactly as any new task in the chosen project (task-create.ts), with a reference
 * back to the original (`tasks.duplicatedFromId`), the original's watchers who can see that project, its
 * files when the person ticks "Copy files" (each one through the upload checks), and a history line on
 * both tasks.
 *
 * `copyOf` is the one place that says what a copy carries. Never copied: comments, history, completion
 * and status (the copy starts in its project's first To-do column), approvals, the repeat rule, merge and
 * bin state, the meeting link, and "Show to client" (the project's own rules decide, as for any new task).
 */

/** One of the original's files, as stored. */
export interface OriginalFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

/** The original task as Duplicate reads it (a live task; prisma-task-duplicate-source.ts). */
export interface OriginalTask {
  id: string;
  key: string;
  title: string;
  description: string | null;
  projectId: string;
  priority: Priority;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  isMilestone: boolean;
  weight: number | null;
  inspectionFormId: string | null;
  /** Its inspection form is still there (a deleted one is left out of the copy). */
  inspectionFormLive: boolean;
  inspectionPlace: string | null;
  tagNames: string[];
  assigneeIds: string[];
  watcherIds: string[];
  /** Its live checklists as a tree: titles, items and nesting — no ticks, people or dates. */
  checklists: ChecklistTree;
  /** Its external contacts not (yet) on a guest list (the minute sweep makes them guests). */
  externalContacts: ExternalContactFields[];
  /** 1.24: its guests, each with this task's note (as the Assign box shows them). */
  guests: OriginalGuest[];
  /** 1.24: its categories (a retired one is kept on the task but can't be given to a new one). */
  categories: { id: string; retired: boolean }[];
  files: OriginalFile[];
}

/** 1.24: one of the original's guests. */
export interface OriginalGuest {
  guestId: string;
  note: string | null;
  name: string;
  company: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  /** Retired from the company's list: kept on the original, never put on a copy. */
  retired: boolean;
}

/** What a copy of a task carries (before the target project's rules are applied). */
export interface TaskCopy {
  title: string;
  description: string | null;
  priority: Priority;
  startDate: Date | null;
  dueDate: Date | null;
  estimatedHours: number | null;
  isMilestone: boolean;
  weight: number | null;
  inspectionFormId: string | null;
  inspectionPlace: string | null;
  tags: string[];
  assigneeIds: string[];
  watcherIds: string[];
  /** Every item unticked (a tree carries no ticks), the nesting kept. */
  checklists: ChecklistTree;
  /** Its external contacts not on a guest list yet. */
  externalContacts: ExternalContactFields[];
  /** 1.24: its guests (not retired), with this task's notes. */
  guests: { guestId: string; note: string | null }[];
  /** 1.24: its categories (not retired). */
  categoryIds: string[];
  files: OriginalFile[];
}

/** What is never carried over to a copy (the design's list; copyOf has no field for any of them). */
export const NEVER_COPIED = ['comments', 'history', 'status', 'completion', 'approvals', 'repeat', 'merge', 'bin', 'meeting', 'clientVisible'] as const;

/** Added to the title of a copy made without a review (Bulk Duplicate, a later release). */
export const COPY_SUFFIX = ' (copy)';

/** "Rig check (copy)" — cut so it still fits a title. */
export function withCopySuffix(title: string): string {
  const room = VARCHAR_MAX - COPY_SUFFIX.length;
  return `${title.length > room ? title.slice(0, room).trimEnd() : title}${COPY_SUFFIX}`;
}

/**
 * What a copy of `original` carries. `markCopy`: the title ends " (copy)" (Bulk Duplicate, made without
 * the review form).
 */
export function copyOf(original: OriginalTask, opts: { markCopy?: boolean } = {}): TaskCopy {
  const formLive = Boolean(original.inspectionFormId) && original.inspectionFormLive;
  return {
    title: opts.markCopy ? withCopySuffix(original.title) : original.title,
    description: original.description,
    priority: original.priority,
    startDate: original.startDate,
    dueDate: original.dueDate,
    estimatedHours: original.estimatedHours,
    isMilestone: original.isMilestone,
    weight: original.weight,
    // A deleted inspection form is left out (a new task can only be given a live form), and its place with it.
    inspectionFormId: formLive ? original.inspectionFormId : null,
    inspectionPlace: formLive ? original.inspectionPlace : null,
    tags: [...original.tagNames],
    assigneeIds: [...new Set(original.assigneeIds)],
    watcherIds: [...new Set(original.watcherIds)],
    checklists: original.checklists.map((l) => ({ title: l.title, items: l.items })),
    externalContacts: original.externalContacts.map((c) => ({ ...c })),
    // 1.24: a retired guest or category stays on the original only (a new task can't be given one).
    guests: original.guests.filter((g) => !g.retired).map((g) => ({ guestId: g.guestId, note: g.note })),
    categoryIds: original.categories.filter((c) => !c.retired).map((c) => c.id),
    files: [...original.files],
    // ── LATER LANES ADD THEIR FIELDS HERE (and to OriginalTask, TaskCopy and the source) ──
  };
}

/** The column a copy starts in: the project's first To-do column (else Backlog, else its first open one). */
export function startColumn<C extends PickableColumn>(columns: C[]): C | null {
  return pickColumn(columns, ['TODO', 'BACKLOG']) ?? firstOpenColumn(columns);
}

/** The review form's pre-fill (GET /tasks/:id/duplicate): only what the person may see. */
export interface DuplicatePrefill {
  original: { id: string; key: string; title: string; projectId: string };
  /** The New task form's fields, filled in from the original. Dates are company calendar days. */
  task: {
    title: string;
    description: string | null;
    projectId: string;
    /** The original project's first To-do column (null: it has none open). */
    columnId: string | null;
    priority: Priority;
    startDate: string | null;
    dueDate: string | null;
    estimatedHours: number | null;
    isMilestone: boolean;
    weight: number | null;
    tags: string[];
    /** Only people who may still be given the task in its project. */
    assigneeIds: string[];
    checklists: ChecklistTree;
    externalContacts: ExternalContactFields[];
    /** 1.24: its guests as the Assign box shows them (with this task's note). */
    guests: { id: string; name: string; company: string | null; designation: string | null; email: string | null; phone: string | null; note: string | null }[];
    /** 1.24: its categories. */
    categoryIds: string[];
    inspectionFormId: string | null;
    inspectionPlace: string | null;
  };
  /** Its watchers who can see its project (the copy keeps those who can see the chosen project). */
  watchers: { id: string; name: string }[];
  /** Its files, for the "Copy files (N)" tick. */
  files: { id: string; filename: string; sizeBytes: number; mimeType: string }[];
}

/** The review form's fields (POST /tasks/:id/duplicate): the New task form's, `columnId` optional. */
export type DuplicateBody = Omit<NewTaskBody, 'columnId' | 'startDate'> & {
  columnId?: string;
  /** Null: no start date of its own (the automatic one). Left out: the original's. */
  startDate?: Date | null;
};

/** How the copy's files went. */
export interface FilesOutcome {
  total: number;
  copied: number;
  failed: { filename: string; reason: string }[];
}

export interface DuplicateResult {
  task: CreatedTask;
  files: FilesOutcome;
}

export interface DuplicateOptions {
  /** The reviewed fields (the New task form). Absent: the original as it is, in its own project (Bulk Duplicate). */
  body?: DuplicateBody;
  /** Copy its files (default: yes). */
  copyFiles?: boolean;
  /** The title ends " (copy)" (Bulk Duplicate). */
  markCopy?: boolean;
}

export interface TaskDuplicatePorts {
  /** The original as it is now (live tasks only), or null. */
  original(taskId: string): Promise<OriginalTask | null>;
  canViewTask(actor: TaskActor, taskId: string): Promise<boolean>;
  /** Of these people, those who can see the project (active; its team in its companies, and administrators). */
  peopleWhoSee(projectId: string, userIds: string[]): Promise<string[]>;
  namesOf(userIds: string[]): Promise<Map<string, string>>;
  columnsOf(projectId: string): Promise<PickableColumn[]>;
  addWatchers(taskId: string, userIds: string[]): Promise<void>;
  /** A stored file's bytes (null: not there any more). */
  readFile(storageKey: string): Promise<Buffer | null>;
  /** A new file on a task, through every upload check (size, type, contents, picture shrinking, the task's quota). */
  uploadFile(taskId: string, uploadedById: string, file: { filename: string; mimeType: string; content: Buffer }): Promise<unknown>;
  recordActivity?: RecordTaskActivity;
  /** The new task's pipeline (task-create.ts): the target project's rules, as for any new task. */
  pipeline: NewTaskPipeline;
  /** Company time zone: the review form's dates are its calendar days. */
  timeZone: string;
  /** A step after the copy was saved that failed (logged; the copy stands). */
  onError?: (err: unknown, what: string) => void;
}

/** Plain words for why one file wasn't copied. */
function fileFailure(err: unknown): string {
  if (err instanceof HttpError && err.status < 500 && err.message) return err.message;
  return 'It couldn’t be copied.';
}

/** The start date is copied only when it fits the copy's due date (on or before it). */
function startFits(start: Date | null, due: Date | null | undefined, timeZone: string): boolean {
  if (!start || !due) return true;
  return (dueDayKey(start, timeZone) ?? '') <= (dueDayKey(due, timeZone) ?? '');
}

export function createTaskDuplicateService(ports: TaskDuplicatePorts) {
  const notFound = () => new NotFoundError('Task not found.');

  /** The original, for someone who may open it (404 for anyone else: its existence isn't revealed). */
  async function visibleOriginal(actor: TaskActor, taskId: string): Promise<OriginalTask> {
    if (!(await ports.canViewTask(actor, taskId))) throw notFound();
    const original = await ports.original(taskId);
    if (!original) throw notFound();
    return original;
  }

  async function prefill(actor: TaskActor, taskId: string): Promise<DuplicatePrefill> {
    const original = await visibleOriginal(actor, taskId);
    const copy = copyOf(original);
    const seeing = new Set(await ports.peopleWhoSee(original.projectId, [...copy.assigneeIds, ...copy.watcherIds]));
    const watcherIds = copy.watcherIds.filter((id) => seeing.has(id));
    const names = await ports.namesOf(watcherIds);
    const day = (d: Date | null) => (d ? dueDayKey(d, ports.timeZone) : null);
    return {
      original: { id: original.id, key: original.key, title: original.title, projectId: original.projectId },
      task: {
        title: copy.title,
        description: copy.description,
        projectId: original.projectId,
        columnId: startColumn(await ports.columnsOf(original.projectId))?.id ?? null,
        priority: copy.priority,
        startDate: day(copy.startDate),
        dueDate: day(copy.dueDate),
        estimatedHours: copy.estimatedHours,
        isMilestone: copy.isMilestone,
        weight: copy.weight,
        tags: copy.tags,
        assigneeIds: copy.assigneeIds.filter((id) => seeing.has(id)),
        checklists: copy.checklists,
        externalContacts: copy.externalContacts,
        guests: original.guests
          .filter((g) => !g.retired)
          .map((g) => ({ id: g.guestId, name: g.name, company: g.company, designation: g.designation, email: g.email, phone: g.phone, note: g.note })),
        categoryIds: copy.categoryIds,
        inspectionFormId: copy.inspectionFormId,
        inspectionPlace: copy.inspectionPlace,
      },
      watchers: watcherIds.map((id) => ({ id, name: names.get(id) ?? 'Someone' })),
      files: copy.files.map((f) => ({ id: f.id, filename: f.filename, sizeBytes: f.sizeBytes, mimeType: f.mimeType })),
    };
  }

  /** The new task's fields: the reviewed ones, and — for what the form has no field for — the original's. */
  async function newTaskBody(actor: TaskActor, copy: TaskCopy, opts: DuplicateOptions, projectId: string, columnId: string): Promise<NewTaskBody> {
    const body = opts.body;
    if (body) {
      // 1.24: a guest the form sends without a note keeps the original's note for them.
      const notes = new Map(copy.guests.map((g) => [g.guestId, g.note]));
      const guests = body.guests?.map((g) => (g.note === undefined && notes.get(g.guestId) ? { ...g, note: notes.get(g.guestId)! } : g));
      // (Its project and column are the ones worked out above: they follow the spread.)
      const { startDate, ...fields } = body;
      const due = fields.dueDate;
      // Left out: the original's start date — when it fits the copy's due date (else the automatic one).
      const start = startDate !== undefined ? startDate : startFits(copy.startDate, due, ports.timeZone) ? copy.startDate : null;
      return {
        ...fields,
        ...(guests ? { guests } : {}),
        projectId,
        columnId,
        ...(start ? { startDate: start } : {}),
        ...(fields.tags === undefined && copy.tags.length ? { tags: copy.tags } : {}),
        ...(fields.estimatedHours === undefined && copy.estimatedHours !== null ? { estimatedHours: copy.estimatedHours } : {}),
        ...(fields.weight === undefined ? { weight: copy.weight } : {}),
      };
    }
    // No review (Bulk Duplicate): the original as it is; only people who may be given it in the project.
    let assigneeIds = await ports.peopleWhoSee(projectId, copy.assigneeIds);
    // 1.24: guests need someone from the team — none left on it: the person copying it (when they may be given it).
    if (copy.guests.length && assigneeIds.length === 0) assigneeIds = await ports.peopleWhoSee(projectId, [actor.id]);
    return {
      title: copy.title,
      projectId,
      columnId,
      priority: copy.priority,
      ...(copy.description ? { description: copy.description } : {}),
      ...(copy.startDate ? { startDate: copy.startDate } : {}),
      ...(copy.dueDate ? { dueDate: copy.dueDate } : {}),
      ...(copy.estimatedHours !== null ? { estimatedHours: copy.estimatedHours } : {}),
      isMilestone: copy.isMilestone,
      weight: copy.weight,
      tags: copy.tags,
      assigneeIds,
      ...(copy.checklists.length ? { checklists: copy.checklists } : {}),
      ...(copy.externalContacts.length ? { externalContacts: copy.externalContacts } : {}),
      ...(copy.guests.length ? { guests: copy.guests } : {}),
      // Always sent: the project's "every task needs a category" rule is checked, as for any new task.
      categoryIds: copy.categoryIds,
      ...(copy.inspectionFormId ? { inspectionFormId: copy.inspectionFormId, inspectionPlace: copy.inspectionPlace } : {}),
    };
  }

  /** Copy the files one by one through the upload checks: one that fails is listed, the rest go on. */
  async function copyFiles(files: OriginalFile[], taskId: string, actorId: string): Promise<FilesOutcome> {
    const failed: FilesOutcome['failed'] = [];
    let copied = 0;
    for (const f of files) {
      try {
        const content = await ports.readFile(f.storageKey);
        if (!content) {
          failed.push({ filename: f.filename, reason: 'The stored file couldn’t be found.' });
          continue;
        }
        await ports.uploadFile(taskId, actorId, { filename: f.filename, mimeType: f.mimeType, content });
        copied += 1;
      } catch (err) {
        failed.push({ filename: f.filename, reason: fileFailure(err) });
        if (!(err instanceof HttpError) || err.status >= 500) ports.onError?.(err, 'copying a file');
      }
    }
    return { total: files.length, copied, failed };
  }

  async function duplicate(actor: TaskActor, taskId: string, opts: DuplicateOptions = {}): Promise<DuplicateResult> {
    const original = await visibleOriginal(actor, taskId);
    const copy = copyOf(original, { markCopy: opts.markCopy });
    const projectId = opts.body?.projectId ?? original.projectId;
    // The chosen project's rule first (403), before anything is looked up there.
    const allowed = await ports.pipeline.scopeOf(actor);
    if (allowed && !allowed.includes(projectId)) throw new ForbiddenError(NO_PROJECT_ACCESS);
    const columnId = opts.body?.columnId ?? startColumn(await ports.columnsOf(projectId))?.id;
    if (!columnId) throw new ValidationError('That project has no columns to put the task in. Add one in Manage columns first.');

    const task = await createNewTask(ports.pipeline, actor, await newTaskBody(actor, copy, opts, projectId, columnId), { duplicatedFromId: original.id });

    // The copy is saved: what follows never undoes it (a failure is logged, or listed for the files).
    try {
      const watchers = copy.watcherIds.length ? await ports.peopleWhoSee(task.projectId, copy.watcherIds) : [];
      if (watchers.length) await ports.addWatchers(task.id, watchers);
    } catch (err) {
      ports.onError?.(err, 'copying the watchers');
    }
    // Not ticked: no files were to be copied.
    const files = opts.copyFiles === false ? { total: 0, copied: 0, failed: [] } : await copyFiles(copy.files, task.id, actor.id);
    await noteActivity(ports.recordActivity, { taskId: task.id, userId: actor.id, action: 'DUPLICATED_FROM', meta: { fromTaskId: original.id, fromKey: original.key } });
    await noteActivity(ports.recordActivity, { taskId: original.id, userId: actor.id, action: 'DUPLICATED', meta: { copyTaskId: task.id, copyKey: task.key } });
    return { task, files };
  }

  return { prefill, duplicate };
}

export type TaskDuplicateService = ReturnType<typeof createTaskDuplicateService>;
