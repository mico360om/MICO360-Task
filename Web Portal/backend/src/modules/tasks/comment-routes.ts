import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { CommentService } from './comment-service';
import type { AuthGuard } from '../auth/auth-guard';

const bodySchema = z.object({ body: z.string().min(1) });
const createSchema = z.object({ body: z.string().min(1), parentId: z.string().optional() });

export interface CommentRouteDeps {
  commentService: CommentService;
  guard: AuthGuard;
  /** Broadcast comment changes so open task views update in real time. */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Resolve a task's project so a broadcast can be scoped to its board. */
  projectIdOfTask?: (taskId: string) => Promise<string | null>;
  /** Object-level view authorization: may this user see/comment on this task? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
}

export async function registerCommentRoutes(app: FastifyInstance, deps: CommentRouteDeps): Promise<void> {
  const { commentService, guard } = deps;

  async function announce(taskId: string, event: string, payload: unknown): Promise<void> {
    if (!deps.broadcast || !deps.projectIdOfTask) return;
    const projectId = await deps.projectIdOfTask(taskId);
    if (projectId) deps.broadcast(projectId, event, payload);
  }
  const canView = (req: { user?: { id: string; roles?: string[] } }, taskId: string) =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], taskId) : Promise.resolve(true);
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };

  app.get('/tasks/:id/comments', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    return { data: await commentService.listComments(id) };
  });

  app.post('/tasks/:id/comments', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const { body, parentId } = createSchema.parse(req.body);
    const comment = await commentService.addComment(id, req.user!.id, body, parentId);
    await announce(id, 'comment:created', { taskId: id, comment });
    return reply.status(201).send({ data: comment });
  });

  app.put('/comments/:commentId', { preHandler: guard.authenticate }, async (req) => {
    const { commentId } = req.params as { commentId: string };
    const { body } = bodySchema.parse(req.body);
    const comment = await commentService.editComment(commentId, req.user!.id, body);
    await announce(comment.taskId, 'comment:updated', { taskId: comment.taskId, comment });
    return { data: comment };
  });

  app.delete('/comments/:commentId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { commentId } = req.params as { commentId: string };
    const isAdmin = (req.user!.roles ?? []).includes('ADMIN');
    const removed = await commentService.deleteComment(commentId, req.user!.id, isAdmin);
    if (removed) await announce(removed.taskId, 'comment:deleted', { taskId: removed.taskId, id: commentId });
    return reply.status(204).send();
  });
}
