import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { CategoryService } from './category-service';
import { idString } from '../tasks/validation';
import { CATEGORY_WORDS } from '../tasks/task-categories';

/**
 * 1.24 Task categories. A project's list: anyone who can see the project reads it; admins and the project's
 * managers change it (403 otherwise). A task's categories: whoever may edit the task.
 *
 *   GET    /projects/:id/categories                 the list in order (retired marked; managers also see usage)
 *   POST   /projects/:id/categories                 add { name, color? }
 *   PUT    /projects/:id/categories/order           { orderedIds }
 *   PUT    /projects/:id/category-settings          { requireCategory }
 *   PUT    /project-categories/:categoryId          { name?, color?, retired? }
 *   DELETE /project-categories/:categoryId          only when no task uses it (409 CATEGORY_IN_USE)
 *   PUT    /tasks/:id/categories                    { categoryIds } — exactly these
 */
const createSchema = z.object({ name: z.string().max(500).nullable().optional(), color: z.string().max(20).nullable().optional() });
const updateSchema = z.object({ name: z.string().max(500).nullable().optional(), color: z.string().max(20).optional(), retired: z.boolean().optional() });
const orderSchema = z.object({ orderedIds: z.array(idString).max(200) });
const settingsSchema = z.object({ requireCategory: z.boolean() });
const taskSchema = z.object({ categoryIds: z.array(idString).max(100) });

type Check = (userId: string, roles: string[], id: string) => Promise<boolean>;

export interface CategoryRouteDeps {
  service: CategoryService;
  guard: AuthGuard;
  canViewProject?: Check;
  /** Admins and the project's managers. */
  canManageProject?: Check;
  canViewTask?: Check;
  canEditTask?: Check;
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  taskOf?: (taskId: string) => Promise<{ projectId: string } | null>;
}

const noProject = { error: { code: 'NOT_FOUND', message: 'Project not found.' } };
const notManager = { error: { code: 'FORBIDDEN', message: CATEGORY_WORDS.notManager } };
const noTask = { error: { code: 'NOT_FOUND', message: 'Task not found.' } };

export async function registerCategoryRoutes(app: FastifyInstance, deps: CategoryRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const ask = (check: Check | undefined, req: FastifyRequest, id: string, fallback = true) => (check ? check(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(fallback));
  const isAdmin = (req: FastifyRequest) => (req.user!.roles ?? []).includes('ADMIN');
  /** Who may change the list: 404 for someone who can't see the project, 403 for a non-manager. */
  async function mayManage(req: FastifyRequest, projectId: string): Promise<'ok' | 'hidden' | 'refused'> {
    if (!(await ask(deps.canViewProject, req, projectId))) return 'hidden';
    return (await ask(deps.canManageProject, req, projectId, isAdmin(req))) ? 'ok' : 'refused';
  }
  const refuse = (verdict: 'hidden' | 'refused') => (verdict === 'hidden' ? { status: 404, body: noProject } : { status: 403, body: notManager });

  app.get('/projects/:id/categories', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ask(deps.canViewProject, req, id))) return reply.status(404).send(noProject);
    const manager = await ask(deps.canManageProject, req, id, isAdmin(req));
    return { data: { ...(await service.list(id, { usage: manager })), canManage: manager } };
  });

  app.post('/projects/:id/categories', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const verdict = await mayManage(req, id);
    if (verdict !== 'ok') return reply.status(refuse(verdict).status).send(refuse(verdict).body);
    const body = createSchema.parse(req.body ?? {});
    return reply.status(201).send({ data: await service.create(id, body, req.user!.id) });
  });

  app.put('/projects/:id/categories/order', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const verdict = await mayManage(req, id);
    if (verdict !== 'ok') return reply.status(refuse(verdict).status).send(refuse(verdict).body);
    return { data: await service.reorder(id, orderSchema.parse(req.body ?? {}).orderedIds) };
  });

  app.put('/projects/:id/category-settings', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const verdict = await mayManage(req, id);
    if (verdict !== 'ok') return reply.status(refuse(verdict).status).send(refuse(verdict).body);
    return { data: await service.setRequired(id, settingsSchema.parse(req.body ?? {}).requireCategory) };
  });

  app.put('/project-categories/:categoryId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { categoryId } = req.params as { categoryId: string };
    const body = updateSchema.parse(req.body ?? {});
    const projectId = await service.projectOf(idString.parse(categoryId));
    const verdict = await mayManage(req, projectId);
    if (verdict !== 'ok') return reply.status(refuse(verdict).status).send(refuse(verdict).body);
    return { data: await service.update(categoryId, body) };
  });

  app.delete('/project-categories/:categoryId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { categoryId } = req.params as { categoryId: string };
    const projectId = await service.projectOf(idString.parse(categoryId));
    const verdict = await mayManage(req, projectId);
    if (verdict !== 'ok') return reply.status(refuse(verdict).status).send(refuse(verdict).body);
    await service.remove(categoryId);
    return reply.status(204).send();
  });

  app.put('/tasks/:id/categories', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ask(deps.canViewTask, req, id)) || !(await ask(deps.canEditTask, req, id))) return reply.status(404).send(noTask);
    const { categoryIds } = taskSchema.parse(req.body ?? {});
    const categories = await service.setForTask(id, categoryIds, req.user!.id);
    if (deps.broadcast && deps.taskOf) {
      const task = await deps.taskOf(id).catch(() => null);
      if (task) deps.broadcast(task.projectId, 'task:updated', task);
    }
    return { data: categories };
  });
}
