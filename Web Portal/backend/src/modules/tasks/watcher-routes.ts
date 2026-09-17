import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WatcherService } from './watcher-service';
import type { AuthGuard } from '../auth/auth-guard';

export interface WatcherRouteDeps {
  watcherService: WatcherService;
  guard: AuthGuard;
  /** Broadcast watcher changes so open detail views refresh. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  projectIdOfTask?: (taskId: string) => Promise<string | null>;
  /** Object-level guard: only users who can view the task may see/change its watchers. */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
}

/** Task watchers — follow a task you're not assigned to; watchers get its notifications. */
export async function registerWatcherRoutes(app: FastifyInstance, deps: WatcherRouteDeps): Promise<void> {
  const { watcherService, guard } = deps;
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };

  const canView = (req: FastifyRequest, taskId: string): Promise<boolean> =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles, taskId) : Promise.resolve(true);

  async function announce(taskId: string): Promise<void> {
    if (!deps.broadcast || !deps.projectIdOfTask) return;
    const projectId = await deps.projectIdOfTask(taskId);
    if (projectId) deps.broadcast(projectId, 'task:watchers', { taskId, watchers: await watcherService.listWatchers(taskId) });
  }

  app.get('/tasks/:id/watchers', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    return { data: await watcherService.listWatchers(id) };
  });

  app.get('/tasks/:id/watch', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    return { data: { watching: await watcherService.isWatching(id, req.user!.id) } };
  });

  app.post('/tasks/:id/watch', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const watchers = await watcherService.watch(id, req.user!.id);
    await announce(id);
    return { data: { watching: true, watchers } };
  });

  app.delete('/tasks/:id/watch', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    await watcherService.unwatch(id, req.user!.id);
    await announce(id);
    return reply.status(204).send();
  });
}
