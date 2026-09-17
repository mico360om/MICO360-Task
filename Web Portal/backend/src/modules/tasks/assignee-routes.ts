import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AssigneeService } from './assignee-service';
import type { AuthGuard } from '../auth/auth-guard';

const assignSchema = z.object({ userIds: z.array(z.string().min(1)).min(1) });

export interface AssigneeRouteDeps {
  assigneeService: AssigneeService;
  guard: AuthGuard;
  /** Broadcast assignee changes so open boards/detail views refresh in real time. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Resolve a task's project so a broadcast can be scoped to its board. */
  projectIdOfTask?: (taskId: string) => Promise<string | null>;
  /** Object-level guard: only users who can view the task may read or change its assignees. */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
}

export async function registerAssigneeRoutes(app: FastifyInstance, deps: AssigneeRouteDeps): Promise<void> {
  const { assigneeService, guard } = deps;
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };
  const canView = (req: FastifyRequest, taskId: string): Promise<boolean> =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], taskId) : Promise.resolve(true);

  async function announce(taskId: string, assignees: unknown): Promise<void> {
    if (!deps.broadcast || !deps.projectIdOfTask) return;
    const projectId = await deps.projectIdOfTask(taskId);
    if (projectId) deps.broadcast(projectId, 'task:assignees', { taskId, assignees });
  }

  app.get('/tasks/:id/assignees', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    return { data: await assigneeService.listAssignees(id) };
  });

  app.post('/tasks/:id/assignees', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { userIds } = assignSchema.parse(req.body);
    const assignees = await assigneeService.assignUsers(id, userIds, req.user!.id);
    await announce(id, assignees);
    return { data: assignees };
  });

  app.delete('/tasks/:id/assignees/:userId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    await assigneeService.unassignUser(id, userId);
    await announce(id, await assigneeService.listAssignees(id));
    return reply.status(204).send();
  });
}
