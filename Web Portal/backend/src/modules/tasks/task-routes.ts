import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TaskService } from './task-service';
import type { CarryForwardService } from './carry-forward-service';
import type { TagService } from './tag-service';
import type { AssigneeService } from './assignee-service';
import type { AuthGuard } from '../auth/auth-guard';
import { filterAndSortTasks, SORT_FIELDS, type TaskFilterCriteria } from './task-filter';
import { boardDateFromKey } from './board-date';

const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** CSV → trimmed non-empty string[] (for repeatable filter params like priority/category/tag). */
function csv(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  columnId: z.string().optional(),
  assigneeId: z.string().optional(),
  q: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  tag: z.string().optional(),
  dueBefore: z.coerce.date().optional(),
  dueAfter: z.coerce.date().optional(),
  overdue: z.coerce.boolean().optional(),
  boardDate: dateKey.optional(),
  sort: z.enum(SORT_FIELDS).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const recurrenceSchema = z.object({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  interval: z.number().int().min(1),
  count: z.number().int().min(1).nullable().optional(),
  until: z.string().nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  paused: z.boolean().optional(),
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().min(1),
  columnId: z.string().min(1),
  priority: priorityEnum.optional(),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  estimatedHours: z.number().optional(),
  progress: z.number().min(0).max(100).optional(),
  recurrenceRule: recurrenceSchema.nullable().optional(),
  /** Optional board day (YYYY-MM-DD) for per-date boards; defaults to today. */
  boardDate: dateKey.optional(),
  /** Optional tag names to apply on creation (find-or-create). */
  tags: z.array(z.string()).optional(),
  /** Optional user ids to assign on creation. */
  assigneeIds: z.array(z.string().min(1)).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  columnId: z.string().optional(),
  position: z.number().optional(),
  priority: priorityEnum.optional(),
  startDate: z.coerce.date().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  estimatedHours: z.number().nullable().optional(),
  actualHours: z.number().nullable().optional(),
  progress: z.number().min(0).max(100).optional(),
  recurrenceRule: recurrenceSchema.nullable().optional(),
  expectedVersion: z.number().int().optional(),
  /** 'series' applies the edit to every occurrence of a recurring task. */
  scope: z.enum(['one', 'series']).optional(),
});

const moveSchema = z.object({ columnId: z.string().min(1), position: z.number().optional() });
const reorderSchema = z.object({ orderedIds: z.array(z.string().min(1)).min(1) });

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
  /** When provided, `assigneeIds` supplied on create are assigned to the new task. */
  assigneeService?: AssigneeService;
  /** Resolve a project's owner; a new task with no explicit assignees defaults to the owner. */
  projectOwnerOf?: (projectId: string) => Promise<string | null>;
  /** When provided, exposes an admin endpoint to run the per-date carry-forward sweep on demand. */
  carryForwardService?: CarryForwardService;
}

export async function registerTaskRoutes(app: FastifyInstance, deps: TaskRouteDeps): Promise<void> {
  const { taskService, guard } = deps;

  app.get('/tasks', { preHandler: guard.authenticate }, async (req, reply) => {
    const params = listQuerySchema.parse(req.query);
    // Object-level scope: a non-admin only ever sees tasks in projects they belong to.
    let allowedIds: string[] | null = null;
    if (deps.accessibleProjectIds) {
      allowedIds = await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []);
      if (allowedIds && params.projectId && !allowedIds.includes(params.projectId)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } });
      }
    }
    // Repository-level scope filters (project / column / assignee) hit the DB…
    const tasks = await taskService.listTasks({
      projectId: params.projectId,
      columnId: params.columnId,
      assigneeId: params.assigneeId,
      ...(params.boardDate ? { boardDate: boardDateFromKey(params.boardDate) } : {}),
    });
    const scoped = allowedIds ? tasks.filter((t) => allowedIds!.includes(t.projectId)) : tasks;
    // …then combined keyword / priority / status / tag / date filters + sorting.
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
    };
    return { data: filterAndSortTasks(scoped, criteria) };
  });

  // Tasks assigned to the current user (My Tasks).
  app.get('/tasks/mine', { preHandler: guard.authenticate }, async (req) => {
    return { data: await taskService.listTasks({ assigneeId: req.user!.id }) };
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
    if (deps.accessibleProjectIds) {
      const allowed = await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []);
      if (allowed && !allowed.includes(body.projectId)) {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } });
      }
    }
    const created = await taskService.createTask({
      ...body,
      ...(boardDate ? { boardDate: boardDateFromKey(boardDate) } : {}),
      createdById: req.user!.id,
    });
    // Apply tags + assignees in the same request so lightweight clients can create-with-them in one call.
    let appliedTags;
    if (deps.tagService && tags && tags.length > 0) {
      appliedTags = await deps.tagService.setTaskTags(created.id, tags);
    }
    let appliedAssignees;
    if (deps.assigneeService && assigneeIds && assigneeIds.length > 0) {
      appliedAssignees = await deps.assigneeService.assignUsers(created.id, assigneeIds, req.user!.id);
    } else if (deps.assigneeService && deps.projectOwnerOf) {
      // No explicit assignees → default-assign the task to the project owner (if one is set).
      const ownerId = await deps.projectOwnerOf(created.projectId);
      if (ownerId) appliedAssignees = await deps.assigneeService.assignUsers(created.id, [ownerId], req.user!.id);
    }
    deps.broadcast?.(created.projectId, 'task:created', created);
    const data = {
      ...created,
      ...(appliedTags ? { tags: appliedTags } : {}),
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
    const task = await taskService.updateTask(id, patch, expectedVersion, scope);
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

  // Intra-column drag reordering: re-sequence a column's tasks to `orderedIds`.
  app.put('/columns/:columnId/tasks/reorder', { preHandler: guard.authenticate }, async (req, reply) => {
    const { orderedIds } = reorderSchema.parse(req.body);
    // Every task in a column shares its project, so gating on the first id covers the whole batch.
    if (!(await assertTaskView(req, orderedIds[0]!))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have permission to do that.' } });
    }
    await taskService.reorderColumn(orderedIds);
    // Nudge other board viewers to refetch (best-effort — scope the room by the first task's project).
    if (deps.broadcast) {
      try {
        const first = await taskService.getTask(orderedIds[0]!);
        deps.broadcast(first.projectId, 'task:moved', { id: first.id });
      } catch {
        /* ignore broadcast issues */
      }
    }
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
