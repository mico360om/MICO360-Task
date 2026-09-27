import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TaskService } from './task-service';
import type { CarryForwardService } from './carry-forward-service';
import { normalizeTagNames, type TagService } from './tag-service';
import type { AssigneeService } from './assignee-service';
import type { AuthGuard } from '../auth/auth-guard';
import { filterAndSortTasks, SORT_FIELDS, type TaskFilterCriteria } from './task-filter';
import { boardDateFromKey } from './board-date';
import { calendarDay, dateInput, hours, idString, longText, queryBoolean, requiredText, VARCHAR_MAX } from './validation';

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
  boardDate: calendarDay.optional(),
  sort: z.enum(SORT_FIELDS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  /** Optional paging over the filtered, sorted list. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const recurrenceSchema = z.object({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  interval: z.number().int().min(1).max(1000),
  count: z.number().int().min(1).max(10_000).nullable().optional(),
  until: z.string().max(40).nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  anchorDay: z.number().int().min(1).max(31).optional(),
  paused: z.boolean().optional(),
});

const createSchema = z.object({
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
  recurrenceRule: recurrenceSchema.nullable().optional(),
  /** Optional board day (YYYY-MM-DD) for per-date boards; defaults to today. */
  boardDate: calendarDay.optional(),
  /** Optional tag names to apply on creation (find-or-create). */
  tags: z.array(z.string().max(VARCHAR_MAX)).max(50).optional(),
  /** Users to assign on creation. Present (even `[]`) means exactly these; absent defaults to the project owner. */
  assigneeIds: z.array(idString).max(100).optional(),
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
  recurrenceRule: recurrenceSchema.nullable().optional(),
  expectedVersion: z.number().int().optional(),
  /** 'series' applies the edit to every occurrence of a recurring task. */
  scope: z.enum(['one', 'series']).optional(),
});

const moveSchema = z.object({ columnId: idString, position: z.number().int().min(0).optional() });
const reorderSchema = z.object({ orderedIds: z.array(idString).min(1).max(1000) });

export interface TaskRouteDeps {
  taskService: TaskService;
  guard: AuthGuard;
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Optional per-project authorization for task deletion (admin or project manager). */
  canDeleteTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Object-level view/edit authorization: may this user see/touch this task's project? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Project ids a user may see (`null` = admin, no scoping) — scopes the task list to their projects. */
  accessibleProjectIds?: (userId: string, roles: string[]) => Promise<string[] | null>;
  /** When provided, `tags` supplied on create are applied to the new task. */
  tagService?: TagService;
  /** When provided, `assigneeIds` supplied on create are checked and the assignees notified. */
  assigneeService?: AssigneeService;
  /** Resolve a project's owner; a new task sent without `assigneeIds` defaults to the owner. */
  projectOwnerOf?: (projectId: string) => Promise<string | null>;
  /** When provided, exposes an admin endpoint to run the per-date carry-forward sweep on demand. */
  carryForwardService?: CarryForwardService;
}

export async function registerTaskRoutes(app: FastifyInstance, deps: TaskRouteDeps): Promise<void> {
  const { taskService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } };

  /** The caller's project scope: `null` for an admin (or when unscoped), else their project ids. */
  async function scopeOf(req: FastifyRequest): Promise<string[] | null> {
    return deps.accessibleProjectIds ? deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []) : null;
  }

  app.get('/tasks', { preHandler: guard.authenticate }, async (req, reply) => {
    const params = listQuerySchema.parse(req.query);
    // Object-level scope: a non-admin only ever sees tasks in projects they belong to.
    const allowedIds = await scopeOf(req);
    if (allowedIds && params.projectId && !allowedIds.includes(params.projectId)) return reply.status(403).send(forbidden);
    const criteria: TaskFilterCriteria = {
      q: params.q,
      priorities: csv(params.priority),
      categories: csv(params.category),
      tagIds: csv(params.tag),
      dueBefore: params.dueBefore,
      dueAfter: params.dueAfter,
      overdue: params.overdue,
      sort: params.sort,
      order: params.order,
      timeZone: taskService.timeZone,
    };
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
    });
    const scoped = allowedIds ? tasks.filter((t) => allowedIds.includes(t.projectId)) : tasks;
    const data = filterAndSortTasks(scoped, criteria);
    if (params.limit === undefined && params.offset === undefined) return { data };
    const offset = params.offset ?? 0;
    const limit = params.limit ?? data.length;
    return { data: data.slice(offset, offset + limit), meta: { total: data.length, offset, limit } };
  });

  // Tasks assigned to the current user (My Tasks) — only in projects they can still see.
  app.get('/tasks/mine', { preHandler: guard.authenticate }, async (req) => {
    const allowedIds = await scopeOf(req);
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

  app.get('/tasks/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assertTaskView(req, id))) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
    }
    return { data: await taskService.getTask(id) };
  });

  app.post('/tasks', { preHandler: guard.authenticate }, async (req, reply) => {
    const { tags, assigneeIds, boardDate, ...body } = createSchema.parse(req.body);
    // Object-level authorization: a non-admin may only create tasks in projects they belong to.
    const allowed = await scopeOf(req);
    if (allowed && !allowed.includes(body.projectId)) return reply.status(403).send(forbidden);

    // Everything is validated before anything is written: tag names, and the assignees (who must
    // be active members of the project). An explicit list — even an empty one — is used as is;
    // only a request without `assigneeIds` falls back to the project owner.
    const tagNames = tags && tags.length > 0 ? normalizeTagNames(tags) : [];
    let assignees: string[] = [];
    if (assigneeIds !== undefined) {
      assignees = deps.assigneeService ? await deps.assigneeService.assertAssignable(body.projectId, assigneeIds) : [...new Set(assigneeIds)];
    } else if (deps.assigneeService && deps.projectOwnerOf) {
      const ownerId = await deps.projectOwnerOf(body.projectId);
      if (ownerId) assignees = await deps.assigneeService.eligibleAssignees(body.projectId, [ownerId]);
    }

    // The task, its tags and its assignees are created in one write.
    const created = await taskService.createTask({
      ...body,
      ...(boardDate ? { boardDate: boardDateFromKey(boardDate) } : {}),
      createdById: req.user!.id,
      tagNames,
      assigneeIds: assignees,
    });
    let appliedAssignees;
    if (deps.assigneeService && assignees.length > 0) {
      await deps.assigneeService.notifyAssigned(created.id, assignees, req.user!.id);
      appliedAssignees = await deps.assigneeService.listAssignees(created.id);
    }
    deps.broadcast?.(created.projectId, 'task:created', created);
    const data = {
      ...created,
      ...(tagNames.length > 0 ? { tags: created.tags ?? [] } : {}),
      ...(appliedAssignees ? { assignees: appliedAssignees } : {}),
    };
    return reply.status(201).send({ data });
  });

  app.put('/tasks/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assertTaskView(req, id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } });
    }
    const { expectedVersion, scope, ...patch } = updateSchema.parse(req.body);
    // A `columnId` here is handled as a move (same project only, completion status follows).
    const task = await taskService.updateTask(id, patch, expectedVersion, scope, req.user!.id);
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
    const allowed = deps.canDeleteTask
      ? await deps.canDeleteTask(req.user!.id, req.user!.roles ?? [], id)
      : (req.user!.roles ?? []).includes('ADMIN');
    if (!allowed) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } });
    const task = await taskService.getTask(id); // 404 if already gone; also gives us the project to scope the broadcast
    const scope = (req.query as { scope?: string }).scope === 'series' ? 'series' : 'one';
    await taskService.deleteTask(id, scope);
    deps.broadcast?.(task.projectId, 'task:deleted', { id });
    return reply.status(204).send();
  });
}
