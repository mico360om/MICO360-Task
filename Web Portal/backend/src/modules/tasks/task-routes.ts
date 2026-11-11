import { z } from 'zod';
import { WEIGHT_MAX, WEIGHT_MIN } from '../project-health/completion';
import { checklistTreeSchema } from './checklist-tree-schema';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { NotFoundError } from '../../lib/http-errors';
import type { TaskService } from './task-service';
import type { CarryForwardService } from './carry-forward-service';
import type { TagService } from './tag-service';
import type { AssigneeService } from './assignee-service';
import type { AuthGuard } from '../auth/auth-guard';
import { filterAndSortTasks, SORT_FIELDS, type TaskFilterCriteria } from './task-filter';
import { boardDateFromKey } from './board-date';
import { calendarDay, dateInput, hours, idString, inspectionPlace, longText, queryBoolean, requiredText, VARCHAR_MAX } from './validation';
import { projectOccurrences } from './calendar-projection';
import { dueDayKey, shiftDayKey, todayKey } from '../../lib/due-date';
import type { TaskRecord } from './task-repository';
import type { ApprovalViewer, TaskApprovalDetails } from './task-approval-routes';
import { createNewTask, type NewTaskPipeline } from './task-create';
import { externalContactSchema } from './external-contact-routes';
import { DELETE_NOT_ALLOWED, DELETE_NOT_ALLOWED_CODE, DELETE_SERIES_NOT_ALLOWED, mayDeleteSeries, mayDeleteTask } from './task-delete-rule';
import { NO_PICK, type PickOf } from '../companies/company-pick';
import { isMonthKey } from './board-month';
import { inMonth, monthWindow } from './month-list';
import type { GuestService } from '../guests/guest-service';
import type { CategoryService } from '../categories/category-service';

const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

/** CSV → trimmed non-empty string[] (for repeatable filter params like priority/category/tag). */
function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

const listQuerySchema = z.object({
  projectId: idString.optional(),
  columnId: idString.optional(),
  assigneeId: idString.optional(),
  q: z.string().max(VARCHAR_MAX).optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  dueBefore: dateInput.optional(),
  dueAfter: dateInput.optional(),
  overdue: queryBoolean.optional(),
  /** Only tasks with an external contact from this company (case and extra spaces aside). */
  externalCompany: z.string().max(120).optional(),
  /** 1.24: only tasks with one of these guests (ids, comma-separated). */
  guestId: z.string().max(2000).optional(),
  /** 1.24: only tasks with a guest from this company. */
  guestCompany: z.string().max(120).optional(),
  /** 1.24: only tasks with one of these task categories (ids, comma-separated). `category` is a column stage. */
  categoryId: z.string().max(2000).optional(),
  boardDate: calendarDay.optional(),
  /** Month view (YYYY-MM): only the tasks that show in that month (board-month.ts); meta says how many have no dates. */
  month: z.string().refine(isMonthKey, { message: 'Expected a month (YYYY-MM).' }).optional(),
  /** Month view: the tasks without dates too (the board's "No date" chip). */
  undated: queryBoolean.optional(),
  sort: z.enum(SORT_FIELDS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  /** Optional paging over the filtered, sorted list. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /**
   * Task archive: `only` = a project's "Archived tasks" list (with a projectId only; newest archived first).
   * Left out (or `exclude`), archived tasks are never listed.
   */
  archived: z.enum(['exclude', 'only']).optional(),
});

const recurrenceSchema = z.object({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  interval: z.number().int().min(1).max(1000),
  count: z.number().int().min(1).max(10_000).nullable().optional(),
  until: z.string().max(40).nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  anchorDay: z.number().int().min(1).max(31).optional(),
  /** Month-based "the 2nd Tuesday" / "the last Friday" (week -1 = last). */
  nthWeekday: z.object({ week: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]), day: z.number().int().min(0).max(6) }).optional(),
  paused: z.boolean().optional(),
  /** Make the next copy when this one is completed (default) or on each due date. */
  createNext: z.enum(['ON_COMPLETE', 'ON_SCHEDULE']).optional(),
  /** The day an occurrence moved on its own replaced: the series carries on from it. */
  resumeFrom: calendarDay.nullable().optional(),
});

/** The calendar asks for one visible range at a time (a month grid is 42 days). */
const MAX_CALENDAR_DAYS = 100;
const calendarQuerySchema = z.object({ from: calendarDay, to: calendarDay });

/** 1.23.5: a task's weight — whole points, 1–10 (the live database would keep anything: the server checks). */
const taskWeight = z.number().int().min(WEIGHT_MIN, `A weight is ${WEIGHT_MIN} to ${WEIGHT_MAX} points.`).max(WEIGHT_MAX, `A weight is ${WEIGHT_MIN} to ${WEIGHT_MAX} points.`);

/** The New task form's fields (POST /tasks; Duplicate reads the same, task-duplicate-routes.ts). */
export const createSchema = z.object({
  title: requiredText,
  description: longText.optional(),
  projectId: idString,
  columnId: idString,
  priority: priorityEnum.optional(),
  startDate: dateInput.optional(),
  /** A calendar day, 'YYYY-MM-DD'. */
  dueDate: dateInput.optional(),
  estimatedHours: hours.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  /** A key date or deliverable of the project (shown as a milestone on its dashboard). */
  isMilestone: z.boolean().optional(),
  /** 1.23.5: its weight in its project's completion, 1–10 points; null or absent = the project's default for its priority. */
  weight: taskWeight.nullable().optional(),
  recurrenceRule: recurrenceSchema.nullable().optional(),
  /** Optional board day (YYYY-MM-DD) for per-date boards; defaults to today. */
  boardDate: calendarDay.optional(),
  /** Optional tag names to apply on creation (find-or-create). */
  tags: z.array(z.string().max(VARCHAR_MAX)).max(50).optional(),
  /** Users to assign on creation. Present (even `[]`) means exactly these; absent defaults to the project owner. */
  assigneeIds: z.array(idString).max(100).optional(),
  /** Its checklist's items, in order (a task template fills them in), written with the task. */
  checklist: z.array(requiredText).max(100).optional(),
  /** 1.23.3: its checklists with titles and nesting (the New task form, templates); wins over `checklist`. */
  checklists: checklistTreeSchema.optional(),
  /** Its external contacts, in order, written with the task (checked by the shared rules; at most 20). */
  externalContacts: z.array(externalContactSchema).max(100).optional(),
  /** 1.24: guests picked from the company's list, with the task's note for each (the website's New task form). */
  guests: z.array(z.object({ guestId: idString, note: z.string().max(5000).nullable().optional() })).max(100).optional(),
  /** 1.24: its categories. Present (even []) they are checked — a project that asks for one refuses none; absent (the app) nothing is set. */
  categoryIds: z.array(idString).max(100).optional(),
  /** The inspection form it is carried out with (a scheduled check, or a one-off task with a form). */
  inspectionFormId: idString.nullable().optional(),
  /** Where the check is done ("Rig 3"): trimmed, blank means none. */
  inspectionPlace: inspectionPlace.nullable().optional(),
  /** Needs the OK of whoever runs the project before it counts as done; left out, the project's setting decides. */
  needsApproval: z.boolean().optional(),
});

const updateSchema = z.object({
  title: requiredText.optional(),
  description: longText.nullable().optional(),
  columnId: idString.optional(),
  position: z.number().int().min(0).optional(),
  priority: priorityEnum.optional(),
  startDate: dateInput.nullable().optional(),
  dueDate: dateInput.nullable().optional(),
  estimatedHours: hours.nullable().optional(),
  actualHours: hours.nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  isMilestone: z.boolean().optional(),
  /** 1.23.5: 1–10 points; null = the project's default for its priority. */
  weight: taskWeight.nullable().optional(),
  recurrenceRule: recurrenceSchema.nullable().optional(),
  expectedVersion: z.number().int().optional(),
  /** 'series' applies the edit to every occurrence of a recurring task. */
  scope: z.enum(['one', 'series']).optional(),
  /** Meant for the series' newest copy (a schedule's Stop or Edit): 409 RECURRENCE_NOT_NEWEST otherwise. */
  requireNewest: z.boolean().optional(),
  /** Changing the form only affects inspections started afterwards; null clears it. */
  inspectionFormId: idString.nullable().optional(),
  inspectionPlace: inspectionPlace.nullable().optional(),
  /** Turning it off while the task waits for approval: only for the people who can approve it. */
  needsApproval: z.boolean().optional(),
});

const moveSchema = z.object({ columnId: idString, position: z.number().int().min(0).optional() });
const reorderSchema = z.object({ orderedIds: z.array(idString).min(1).max(1000) });

/** The meeting a task was created from, as one task's details show it. */
export interface TaskMeetingLink {
  id: string;
  /** Null when the person asking may not see the meeting: they learn only that there is one. */
  title: string | null;
  startAt: Date | null;
  canView: boolean;
}

/** Looks up the meeting a task came from, and who may see it. */
export interface TaskMeetingLookup {
  /** The meeting's title and start, or null once it is deleted. */
  summary: (meetingId: string) => Promise<{ id: string; title: string; startAt: Date } | null>;
  canView: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
}

/** Duplicate Task: a task's links to the task it was copied from and to its copies (live tasks, oldest copy first). */
export interface DuplicateLinks {
  from: { id: string; key: string } | null;
  copies: { id: string; key: string }[];
}

export interface TaskRouteDeps {
  taskService: TaskService;
  guard: AuthGuard;
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /**
   * Optional per-project authorization for task deletion (admin or project manager) — who may delete
   * tasks at all; which tasks they may delete is the rule in task-delete-rule.ts.
   */
  canDeleteTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Object-level view/edit authorization: may this user see/touch this task's project? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Project ids a user may see (`null` = admin, no scoping) — scopes the task list to their projects. */
  accessibleProjectIds?: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null>;
  /**
   * 1.22 (owner, 4 Nov — "always show my own"): the projects the caller's OWN tasks are listed from
   * (My Tasks, theirs on the calendar) — "Show my projects only" never narrows them, the pick does.
   * Absent: the list scope above.
   */
  ownProjectIds?: (userId: string, roles: string[], pick: string | null) => Promise<string[] | null>;
  /** companies: the request's picked company (X-Company-Id); the lists and the calendar follow it. Absent: no pick. */
  pickOf?: PickOf;
  /** When provided, `tags` supplied on create are applied to the new task. */
  tagService?: TagService;
  /** When provided, `assigneeIds` supplied on create are checked and the assignees notified. */
  assigneeService?: AssigneeService;
  /** Resolve a project's owner; a new task sent without `assigneeIds` defaults to the owner. */
  projectOwnerOf?: (projectId: string) => Promise<string | null>;
  /** When provided, exposes an admin endpoint to run the per-date carry-forward sweep on demand. */
  carryForwardService?: CarryForwardService;
  /** How many copies a recurring series already has (for series with a set number of occurrences). */
  countSeries?: (seriesId: string) => Promise<number>;
  /** When provided, a task’s details name the meeting it was created from. */
  taskMeeting?: TaskMeetingLookup;
  /** When provided, a task’s details name the inspection form it carries (and whether it was deleted). */
  taskInspectionForm?: (formId: string) => Promise<{ id: string; title: string; deleted: boolean } | null>;
  /** When provided, a task’s details say who may approve it, who finished it and who approved it. */
  taskApproval?: (viewer: ApprovalViewer, task: TaskRecord) => Promise<TaskApprovalDetails>;
  /** 1.23.1: the tasks merged into this one (additive `mergedFrom`; its "Merged from" panel opens from them). */
  mergedFrom?: (taskId: string) => Promise<{ id: string; key: string; mergeId: string }[]>;
  /** Duplicate Task: the task this one was copied from, and its own copies (live tasks; additive `duplicatedFrom`, `copies`). */
  duplicateLinks?: (taskId: string) => Promise<DuplicateLinks>;
  /** 1.23.3: dated checklist items for the calendar, in the caller's scope (see prisma-checklist-queries). */
  checklistDue?: (opts: { from: string; to: string; userId: string; ownIds: string[] | null; listIds: string[] | null }) => Promise<unknown[]>;
  /** 1.24: a new task's guests (and the person who looks after them). */
  guestService?: GuestService;
  /** 1.24: a new task's categories (the project's rule). */
  categoryService?: CategoryService;
  /** Recycle Bin: after a delete — the history line on each task and the audit log's (who deleted it). */
  binDeleted?: (e: { actorId: string; taskIds: string[]; batchId: string | null; ip?: string | null }) => Promise<void>;
  /** How many live tasks a repeating series has (a copy's details say so: "the entire series (12 tasks)"). */
  seriesSize?: (seriesId: string) => Promise<number>;
  /** Recycle Bin: a deleted task opened — 'TASK_DELETED' for its project's people, null for anyone else. */
  binNotice?: (viewer: { id: string; roles: string[] }, taskId: string) => Promise<'TASK_DELETED' | null>;
}

/** Recycle Bin: what opening a deleted task answers its project's people (the app and extension read any 404 as gone). */
const TASK_DELETED = { error: { code: 'TASK_DELETED', message: 'This task was deleted.' } };

/** POST /tasks' pipeline from the routes' deps (server.ts gives Duplicate the same one: task-duplicate.ts). */
export function newTaskPipeline(deps: Pick<TaskRouteDeps, 'taskService' | 'accessibleProjectIds' | 'assigneeService' | 'projectOwnerOf' | 'broadcast' | 'guestService' | 'categoryService'>): NewTaskPipeline {
  return {
    taskService: deps.taskService,
    scopeOf: async (actor) => (deps.accessibleProjectIds ? deps.accessibleProjectIds(actor.id, actor.roles) : null),
    assigneeService: deps.assigneeService,
    projectOwnerOf: deps.projectOwnerOf,
    broadcast: deps.broadcast,
    // 1.24: a new task's guests and categories (POST /tasks and Duplicate alike).
    guestService: deps.guestService,
    categoryService: deps.categoryService,
  };
}

export async function registerTaskRoutes(app: FastifyInstance, deps: TaskRouteDeps): Promise<void> {
  const { taskService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } };

  /** The caller's project scope: `null` for an admin (or when unscoped), else their project ids. */
  async function scopeOf(req: FastifyRequest): Promise<string[] | null> {
    return deps.accessibleProjectIds ? deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []) : null;
  }
  /**
   * companies: a list's scope — the caller's projects in the picked company (X-Company-Id; none =
   * all their companies). An admin with a pick gets that company's project ids. Object checks
   * (one task, one named project) use scopeOf: the pick never decides whether one thing opens.
   */
  const pickOf = deps.pickOf ?? NO_PICK;
  async function listScopeOf(req: FastifyRequest): Promise<string[] | null> {
    const pick = await pickOf(req);
    return deps.accessibleProjectIds ? deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? [], pick) : null;
  }
  /** 1.22: the list scope, and the wider one of the caller's own tasks (see ownProjectIds), from one pick. */
  async function listAndOwnScopeOf(req: FastifyRequest): Promise<{ list: string[] | null; own: string[] | null }> {
    const pick = await pickOf(req);
    const roles = req.user!.roles ?? [];
    const list = deps.accessibleProjectIds ? await deps.accessibleProjectIds(req.user!.id, roles, pick) : null;
    return { list, own: deps.ownProjectIds ? await deps.ownProjectIds(req.user!.id, roles, pick) : list };
  }

  app.get('/tasks', { preHandler: guard.authenticate }, async (req, reply) => {
    const params = listQuerySchema.parse(req.query);
    if (params.month && params.boardDate) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Ask for a day or a month, not both.' } });
    // Task archive: a project's archived tasks are listed one project at a time (anyone who sees it).
    const archivedOnly = params.archived === 'only';
    if (archivedOnly && !params.projectId) return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Archived tasks are listed one project at a time.' } });
    // Object-level scope: a non-admin only ever sees tasks in projects they belong to. One named
    // project (its board, opened by its link) is checked by its own rule; the plain list follows
    // the picked company too (companies).
    const allowedIds = params.projectId ? await scopeOf(req) : await listScopeOf(req);
    if (allowedIds && params.projectId && !allowedIds.includes(params.projectId)) return reply.status(403).send(forbidden);
    const criteria: TaskFilterCriteria = {
      q: params.q,
      priorities: csv(params.priority),
      categories: csv(params.category),
      tagIds: csv(params.tag),
      dueBefore: params.dueBefore,
      dueAfter: params.dueAfter,
      overdue: params.overdue,
      externalCompany: params.externalCompany,
      guestIds: csv(params.guestId),
      guestCompany: params.guestCompany,
      categoryIds: csv(params.categoryId),
      sort: params.sort,
      order: params.order,
      timeZone: taskService.timeZone,
    };
    // Month view: the database narrows to the month's window, the month rule decides (board-month.ts).
    const monthClock = params.month ? { timeZone: taskService.timeZone, today: todayKey(taskService.timeZone) } : null;
    // Scope and the simple filters run in the database; keyword (Arabic-aware) and overdue
    // (company calendar day) run in memory on the already-narrowed rows.
    const tasks = await taskService.listTasks({
      projectId: params.projectId,
      ...(allowedIds ? { projectIds: allowedIds } : {}),
      columnId: params.columnId,
      assigneeId: params.assigneeId,
      ...(params.boardDate ? { boardDate: boardDateFromKey(params.boardDate) } : {}),
      priorities: criteria.priorities,
      categories: criteria.categories,
      tagIds: criteria.tagIds,
      dueBefore: criteria.dueBefore,
      dueAfter: criteria.dueAfter,
      ...(params.month && monthClock ? { month: monthWindow(params.month, monthClock) } : {}),
      ...(archivedOnly ? { archived: 'only' as const } : {}),
    });
    const scoped = allowedIds ? tasks.filter((t) => allowedIds.includes(t.projectId)) : tasks;
    const sorted = filterAndSortTasks(scoped, criteria);
    // The Archived tasks list: newest archived first unless a sort was asked for.
    const filtered = archivedOnly && !params.sort ? [...sorted].sort((a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0)) : sorted;
    const month = params.month && monthClock ? inMonth(filtered, params.month, monthClock, params.undated === true) : null;
    const data = month ? month.rows : filtered;
    const monthMeta = month ? { month: params.month, undated: month.undated } : null;
    if (params.limit === undefined && params.offset === undefined) return monthMeta ? { data, meta: monthMeta } : { data };
    const offset = params.offset ?? 0;
    const limit = params.limit ?? data.length;
    return { data: data.slice(offset, offset + limit), meta: { total: data.length, offset, limit, ...monthMeta } };
  });

  // The calendar: tasks due in one visible range (projects the caller can see), plus the days the
  // repeating ones among them will be copied to — computed, never stored ("projected").
  app.get('/calendar', { preHandler: guard.authenticate }, async (req, reply) => {
    const { from, to } = calendarQuerySchema.parse(req.query);
    const span = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
    if (span < 0 || span > MAX_CALENDAR_DAYS) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: `Ask for 1 to ${MAX_CALENDAR_DAYS + 1} days, ending on or after the start.` } });
    }
    // companies: the calendar follows the pick. 1.22 (owner, 4 Nov): the caller's own tasks always show,
    // whatever the project ("Show my projects only" narrows other people's work only).
    const { list: allowedIds, own: ownIds } = await listAndOwnScopeOf(req);
    const me = req.user!.id;
    const scope = ownIds ? { projectIds: ownIds } : {};
    const shown = (t: { projectId: string; assignees?: { id: string }[] }) =>
      (!ownIds || ownIds.includes(t.projectId)) && (!allowedIds || allowedIds.includes(t.projectId) || !!t.assignees?.some((a) => a.id === me));
    const visible = <T extends { projectId: string; assignees?: { id: string }[] }>(rows: T[]) => rows.filter(shown);
    const tz = taskService.timeZone;
    const dayStart = (key: string) => new Date(`${key}T00:00:00.000Z`);
    // A due date is a day (UTC midnight) or an instant read in company time: a day either side of
    // the range covers both, then each is placed on its own calendar day.
    const near = await taskService.listTasks({ ...scope, dueAfter: dayStart(shiftDayKey(from, -1)), dueBefore: dayStart(shiftDayKey(to, 2)) });
    const tasks = visible(near).filter((t) => {
      const key = dueDayKey(t.dueDate, tz);
      return key !== null && key >= from && key <= to;
    });
    const today = todayKey(tz);
    const occurrences: { taskId: string; seriesId: string; date: string }[] = [];
    const series = [];
    // Task archive (lead's ruling, 11 Nov): archiving a copy doesn't stop its series — an archived newest copy
    // still projects the series' days (it is in `series`, never in `tasks`).
    for (const head of visible(await taskService.listTasks({ ...scope, recurring: true, archived: 'include' }))) {
      if (!head.recurrenceRule) continue;
      const seriesId = head.recurrenceParentId ?? head.id;
      const existing = head.recurrenceRule.count != null && deps.countSeries ? await deps.countSeries(seriesId) : 1;
      const days = projectOccurrences(head, { from, to, today }, existing);
      if (days.length === 0) continue;
      series.push(head);
      for (const date of days) occurrences.push({ taskId: head.id, seriesId, date });
    }
    // 1.23.3: dated checklist items, on their day (the website shows mine, or a viewed project's).
    const checklistItems = deps.checklistDue ? await deps.checklistDue({ from, to, userId: me, ownIds, listIds: allowedIds }) : [];
    return { data: { from, to, timeZone: tz, tasks, occurrences, series, checklistItems } };
  });

  // Tasks assigned to the current user (My Tasks) — only in projects they can still see. 1.22 (owner,
  // 4 Nov): "Show my projects only" doesn't narrow it — an administrator's own tasks always show.
  app.get('/tasks/mine', { preHandler: guard.authenticate }, async (req) => {
    const { own: allowedIds } = await listAndOwnScopeOf(req); // companies: My Tasks follows the pick
    return { data: await taskService.listTasks({ assigneeId: req.user!.id, ...(allowedIds ? { projectIds: allowedIds } : {}) }) };
  });

  // Per-date boards: run the carry-forward sweep on demand (admin) — the automatic sweep runs nightly.
  if (deps.carryForwardService) {
    app.post('/tasks/carry-forward', { preHandler: guard.requireRoles('ADMIN') }, async () => {
      return { data: await deps.carryForwardService!.run() };
    });
  }

  // Reject a task the caller can't see (404 — don't reveal that it exists).
  async function assertTaskView(req: FastifyRequest, id: string): Promise<boolean> {
    if (!deps.canViewTask) return true;
    return deps.canViewTask(req.user!.id, req.user!.roles ?? [], id);
  }

  /** The meeting a task came from, as the person asking may see it (null when none, or deleted). */
  async function meetingLinkOf(req: FastifyRequest, meetingId: string | null): Promise<TaskMeetingLink | null> {
    if (!meetingId || !deps.taskMeeting) return null;
    const meeting = await deps.taskMeeting.summary(meetingId);
    if (!meeting) return null;
    if (!(await deps.taskMeeting.canView(req.user!.id, req.user!.roles ?? [], meetingId))) {
      return { id: meeting.id, title: null, startAt: null, canView: false };
    }
    return { id: meeting.id, title: meeting.title, startAt: meeting.startAt, canView: true };
  }

  /**
   * What the person asking may delete of this task: this task (or copy), and its entire series. Only
   * someone who may delete tasks at all (`mayManage`) gets either, and then only by the owner's rule:
   * its creator, or the one person it's assigned to; the series, its creator — every copy carries
   * the series' creator over (prisma-recurrence-port), so this one says who.
   */
  async function deleteRightsOf(req: FastifyRequest, task: TaskRecord): Promise<{ mayManage: boolean; canDelete: boolean; canDeleteSeries: boolean }> {
    const viewerId = req.user!.id;
    const roles = req.user!.roles ?? [];
    const mayManage = deps.canDeleteTask ? await deps.canDeleteTask(viewerId, roles, task.id) : roles.includes('ADMIN');
    if (!mayManage) return { mayManage, canDelete: false, canDeleteSeries: false };
    const assigneeIds = deps.assigneeService ? (await deps.assigneeService.listAssignees(task.id)).map((u) => u.id) : [];
    return {
      mayManage,
      canDelete: mayDeleteTask({ viewerId, mayManage, createdById: task.createdById, assigneeIds }),
      canDeleteSeries: mayDeleteSeries({ viewerId, mayManage, seriesCreatorId: task.createdById }),
    };
  }

  /** A task that isn't there: deleted (in the Recycle Bin) as its project's people are told, else not found. */
  async function deletedOrNotFound(req: FastifyRequest, reply: FastifyReply, id: string) {
    const notice = deps.binNotice ? await deps.binNotice({ id: req.user!.id, roles: req.user!.roles ?? [] }, id) : null;
    return reply.status(404).send(notice === 'TASK_DELETED' ? TASK_DELETED : { error: { code: 'NOT_FOUND', message: 'Task not found.' } });
  }

  /**
   * Duplicate Task: "Duplicated from MSSP-34" and "Copies: MSSP-40, MSSP-41" — only tasks the reader may
   * open (a copy in a project they can't see is never named or counted).
   */
  async function duplicateLinksFor(req: FastifyRequest, taskId: string): Promise<{ duplicatedFrom: DuplicateLinks['from']; copies: DuplicateLinks['copies'] }> {
    const links = await deps.duplicateLinks!(taskId);
    const opens = (id: string) => assertTaskView(req, id).catch(() => false);
    const from = links.from && (await opens(links.from.id)) ? links.from : null;
    const shown = await Promise.all(links.copies.map((c) => opens(c.id)));
    return { duplicatedFrom: from, copies: links.copies.filter((_, i) => shown[i]) };
  }

  app.get('/tasks/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assertTaskView(req, id))) return deletedOrNotFound(req, reply, id);
    const task = await taskService.getTask(id).catch((err: unknown) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
    if (!task) return deletedOrNotFound(req, reply, id);
    const inspectionForm = task.inspectionFormId && deps.taskInspectionForm ? await deps.taskInspectionForm(task.inspectionFormId) : null;
    const approval = deps.taskApproval ? { approval: await deps.taskApproval({ id: req.user!.id, roles: req.user!.roles ?? [] }, task) } : {};
    const { canDelete, canDeleteSeries } = await deleteRightsOf(req, task);
    // 1.23.1: the tasks merged into it; and, opened by a merged task's id (an old link), which one that was.
    const merged = deps.mergedFrom ? { mergedFrom: await deps.mergedFrom(task.id) } : {};
    const notice = req.mergedFrom ? { mergeNotice: { key: req.mergedFrom.key, mergedAt: req.mergedFrom.mergedAt, mergedByName: req.mergedFrom.mergedByName } } : {};
    const inSeries = Boolean(task.recurrenceRule || task.recurrenceParentId);
    const series = inSeries && deps.seriesSize ? { seriesSize: await deps.seriesSize(task.recurrenceParentId ?? task.id) } : {};
    const duplicates = deps.duplicateLinks ? await duplicateLinksFor(req, task.id) : {};
    return { data: { ...task, meeting: await meetingLinkOf(req, task.meetingId ?? null), inspectionForm, ...approval, canDelete, canDeleteSeries, ...merged, ...notice, ...series, ...duplicates } };
  });

  // A new task: the shared pipeline (task-create.ts) — the project scope, then tags, contacts and
  // assignees checked before the task, its tags, assignees and contacts are written in one go.
  app.post('/tasks', { preHandler: guard.authenticate }, async (req, reply) => {
    const data = await createNewTask(newTaskPipeline(deps), { id: req.user!.id, roles: req.user!.roles ?? [] }, createSchema.parse(req.body));
    return reply.status(201).send({ data });
  });

  app.put('/tasks/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assertTaskView(req, id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } });
    }
    const { expectedVersion, scope, requireNewest, ...patch } = updateSchema.parse(req.body);
    // A `columnId` here is handled as a move (same project only, completion status follows).
    const task = await taskService.updateTask(id, patch, expectedVersion, scope, req.user!.id, { requireNewest });
    deps.broadcast?.(task.projectId, 'task:updated', task);
    return { data: task };
  });

  // Kanban drag-and-drop persistence (T7.3) — broadcasts to everyone on the board (M4).
  app.patch('/tasks/:id/move', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assertTaskView(req, id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } });
    }
    const { columnId, position } = moveSchema.parse(req.body);
    const task = await taskService.moveTask(id, columnId, position, req.user!.id);
    deps.broadcast?.(task.projectId, 'task:moved', task);
    return { data: task };
  });

  // Intra-column drag reordering: re-sequence a column's live tasks to `orderedIds`.
  app.put('/columns/:columnId/tasks/reorder', { preHandler: guard.authenticate }, async (req, reply) => {
    const { columnId } = req.params as { columnId: string };
    const { orderedIds } = reorderSchema.parse(req.body);
    // Authorize against the column in the URL — only its own live tasks are touched.
    const column = await taskService.getColumn(columnId);
    const allowed = await scopeOf(req);
    if (allowed && !allowed.includes(column.projectId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } });
    }
    await taskService.reorderColumn(columnId, orderedIds);
    // Nudge other board viewers to refetch.
    deps.broadcast?.(column.projectId, 'task:moved', { id: orderedIds[0], columnId });
    return { data: { ok: true } };
  });

  app.delete('/tasks/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // Look the task up first: one that is already gone answers 404 for everyone (an offline delete
    // replayed late counts that as done), and 403 means a real refusal of a task that is still there.
    // It also gives us the project to scope the broadcast.
    const task = await taskService.getTask(id);
    const rights = await deleteRightsOf(req, task);
    if (!rights.mayManage) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } });
    const scope = (req.query as { scope?: string }).scope === 'series' ? 'series' : 'one';
    // The entire series only when it is one (the service deletes just this task otherwise).
    const wholeSeries = scope === 'series' && Boolean(task.recurrenceRule || task.recurrenceParentId);
    if (!(wholeSeries ? rights.canDeleteSeries : rights.canDelete)) {
      return reply.status(403).send({ error: { code: DELETE_NOT_ALLOWED_CODE, message: wholeSeries ? DELETE_SERIES_NOT_ALLOWED : DELETE_NOT_ALLOWED } });
    }
    // To the Recycle Bin, saying who deleted it; then its history and audit lines (never failing the delete).
    const gone = await taskService.deleteTask(id, scope, req.user!.id);
    await deps.binDeleted?.({ actorId: req.user!.id, taskIds: gone.ids, batchId: gone.batchId, ip: req.ip ?? null }).catch((err: unknown) => req.log.error({ err }, 'recycle bin: recording a delete failed'));
    deps.broadcast?.(task.projectId, 'task:deleted', { id });
    return reply.status(204).send();
  });
}
