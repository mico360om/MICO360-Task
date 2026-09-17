import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { DependencyService } from './dependency-service';
import type { AuthGuard } from '../auth/auth-guard';

const addSchema = z.object({ dependsOnTaskId: z.string().min(1) });

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

  app.get('/tasks/:id/dependencies', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    return { data: await dependencyService.listDependencies(id) };
  });

  app.post('/tasks/:id/dependencies', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { dependsOnTaskId } = addSchema.parse(req.body);
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
