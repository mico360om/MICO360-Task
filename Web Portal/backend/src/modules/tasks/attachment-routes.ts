import type { FastifyInstance } from 'fastify';
import type { AttachmentService } from './attachment-service';
import type { AuthGuard } from '../auth/auth-guard';
import { noteActivity, type RecordTaskActivity } from '../activity/task-activity';
import { ValidationError } from '../../lib/http-errors';
import { PreviewError } from '../../lib/office-preview';

export interface AttachmentRouteDeps {
  attachmentService: AttachmentService;
  guard: AuthGuard;
  /** @deprecated Multipart is now registered once at the app level; kept for call-site compatibility. */
  maxSizeBytes?: number;
  /** Object-level view authorization: may this user see/attach to this task? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Write a line to the task's activity timeline (who did what). */
  recordActivity?: RecordTaskActivity;
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
    await noteActivity(deps.recordActivity, { taskId: id, userId: req.user!.id, action: 'ATTACHED', meta: { filename: rec.filename } });
    return reply.status(201).send({ data: rec });
  });

  // A Word / Excel / PowerPoint file as plain text, for viewing in the app.
  app.get('/attachments/:attachmentId/preview', { preHandler: guard.authenticate }, async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const rec = await attachmentService.get(attachmentId);
    if (!(await canView(req, rec.taskId))) return reply.status(403).send(denied);
    try {
      const data = await attachmentService.preview(rec);
      if (!data) return reply.status(415).send({ error: { code: 'NOT_PREVIEWABLE', message: 'This file has no preview — download it to open it.' } });
      return { data };
    } catch (err) {
      if (err instanceof PreviewError) return reply.status(422).send({ error: { code: 'PREVIEW_FAILED', message: err.message } });
      throw err;
    }
  });

  app.delete('/attachments/:attachmentId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const isAdmin = (req.user!.roles ?? []).includes('ADMIN');
    const removed = await attachmentService.remove(attachmentId, req.user!.id, isAdmin);
    await noteActivity(deps.recordActivity, { taskId: removed.taskId, userId: req.user!.id, action: 'ATTACHMENT_REMOVED', meta: { filename: removed.filename } });
    return reply.status(204).send();
  });
}
