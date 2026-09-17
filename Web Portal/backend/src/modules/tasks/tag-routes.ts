import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TagService } from './tag-service';
import type { AuthGuard } from '../auth/auth-guard';

const setSchema = z.object({ tags: z.array(z.string()).max(50) });

export interface TagRouteDeps {
  tagService: TagService;
  guard: AuthGuard;
  /** Broadcast tag changes so open boards refresh in real time. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Resolve a task's project so a broadcast can be scoped to its board. */
  projectIdOfTask?: (taskId: string) => Promise<string | null>;
  /** Object-level guard: only users who can view the task may read or change its tags. */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
}

export async function registerTagRoutes(app: FastifyInstance, deps: TagRouteDeps): Promise<void> {
  const { tagService, guard } = deps;
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };
  const canView = (req: FastifyRequest, taskId: string): Promise<boolean> =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], taskId) : Promise.resolve(true);

  async function announce(taskId: string, tags: unknown): Promise<void> {
    if (!deps.broadcast || !deps.projectIdOfTask) return;
    const projectId = await deps.projectIdOfTask(taskId);
    if (projectId) deps.broadcast(projectId, 'task:tagged', { taskId, tags });
  }

  // Shared tag catalog (for suggestions / autocomplete).
  app.get('/tags', { preHandler: guard.authenticate }, async () => ({ data: await tagService.listCatalog() }));

  app.get('/tasks/:id/tags', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    return { data: await tagService.getTaskTags(id) };
  });

  app.put('/tasks/:id/tags', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { tags } = setSchema.parse(req.body);
    const result = await tagService.setTaskTags(id, tags);
    await announce(id, result);
    return { data: result };
  });

  app.delete('/tasks/:id/tags/:tagId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, tagId } = req.params as { id: string; tagId: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    await tagService.removeTaskTag(id, tagId);
    await announce(id, await tagService.getTaskTags(id));
    return reply.status(204).send();
  });
}
