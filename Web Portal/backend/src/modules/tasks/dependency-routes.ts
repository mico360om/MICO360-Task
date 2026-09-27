import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DependencyService } from './dependency-service';
import type { AuthGuard } from '../auth/auth-guard';
import { idString } from './validation';

const addSchema = z.object({ dependsOnTaskId: idString });

export interface DependencyRouteDeps {
  dependencyService: DependencyService;
  guard: AuthGuard;
  /** Object-level view authorization: may this user see/edit this task's dependencies? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
}

export async function registerDependencyRoutes(app: FastifyInstance, deps: DependencyRouteDeps): Promise<void> {
  const { dependencyService, guard } = deps;
  const canView = (req: { user?: { id: string; roles?: string[] } }, taskId: string) =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], taskId) : Promise.resolve(true);
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };

  /** Keep only the task ids the caller may see — a dependency must not reveal hidden tasks. */
  async function visibleOnly(req: { user?: { id: string; roles?: string[] } }, ids: string[]): Promise<string[]> {
    if (!deps.canViewTask) return ids;
    const seen = await Promise.all(ids.map((taskId) => canView(req, taskId)));
    return ids.filter((_, i) => seen[i]);
  }

  app.get('/tasks/:id/dependencies', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const view = await dependencyService.listDependencies(id);
    return { data: { blockedBy: await visibleOnly(req, view.blockedBy), blocks: await visibleOnly(req, view.blocks) } };
  });

  app.post('/tasks/:id/dependencies', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { dependsOnTaskId } = addSchema.parse(req.body);
    // Both ends must be visible; an inaccessible blocker looks exactly like a missing one.
    if (!(await canView(req, dependsOnTaskId))) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Task not found.' } });
    }
    const edge = await dependencyService.addDependency(id, dependsOnTaskId);
    return reply.status(201).send({ data: edge });
  });

  app.delete('/tasks/:id/dependencies/:dependsOnTaskId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, dependsOnTaskId } = req.params as { id: string; dependsOnTaskId: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    await dependencyService.removeDependency(id, dependsOnTaskId);
    return reply.status(204).send();
  });
}
