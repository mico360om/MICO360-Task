import type { FastifyInstance } from 'fastify';
import type { AttachmentService } from './attachment-service';
import type { AuthGuard } from '../auth/auth-guard';
import { ValidationError } from '../../lib/http-errors';

export interface AttachmentRouteDeps {
  attachmentService: AttachmentService;
  guard: AuthGuard;
  /** @deprecated Multipart is now registered once at the app level; kept for call-site compatibility. */
  maxSizeBytes?: number;
  /** Object-level view authorization: may this user see/attach to this task? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
}

export async function registerAttachmentRoutes(app: FastifyInstance, deps: AttachmentRouteDeps): Promise<void> {
  const { attachmentService, guard } = deps;
  const canView = (req: { user?: { id: string; roles?: string[] } }, taskId: string) =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], taskId) : Promise.resolve(true);
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };

  app.get('/tasks/:id/attachments', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    return { data: await attachmentService.list(id) };
  });

  app.post('/tasks/:id/attachments', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded.');
    const content = await file.toBuffer();
    const rec = await attachmentService.upload(id, req.user!.id, {
      filename: file.filename,
      mimeType: file.mimetype,
      content,
    });
    return reply.status(201).send({ data: rec });
  });

  app.delete('/attachments/:attachmentId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const isAdmin = (req.user!.roles ?? []).includes('ADMIN');
    await attachmentService.remove(attachmentId, req.user!.id, isAdmin);
    return reply.status(204).send();
  });
}
