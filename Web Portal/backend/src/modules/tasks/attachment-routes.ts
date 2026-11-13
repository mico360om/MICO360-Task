import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AttachmentService } from './attachment-service';
import type { AttachmentRecord } from './attachment-repository';
import type { AuthGuard } from '../auth/auth-guard';
import { noteActivity, type RecordTaskActivity } from '../activity/task-activity';
import { ValidationError } from '../../lib/http-errors';
import { PreviewError } from '../../lib/office-preview';
import { signFiles, viewerOfRequest, type FileLinks } from '../files/file-links';

export interface AttachmentRouteDeps {
  attachmentService: AttachmentService;
  guard: AuthGuard;
  /** @deprecated Multipart is now registered once at the app level; kept for call-site compatibility. */
  maxSizeBytes?: number;
  /** Object-level view authorization: may this user see/attach to this task? */
  canViewTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** Write a line to the task's activity timeline (who did what). */
  recordActivity?: RecordTaskActivity;
  /** 1.23.7: may this person show a task's files to clients (who runs its project, an administrator)? Enables the route. */
  canManageTask?: (userId: string, roles: string[], taskId: string) => Promise<boolean>;
  /** 1.23.7: a file was just shown to clients (their notice). */
  onShownToClient?: (attachmentId: string) => void | Promise<void>;
  audit?: { record(entry: { userId: string | null; ip: string | null; module: string; action: string; entityId: string | null; newValue?: unknown }): Promise<unknown> };
  /** 1.23.29 private file links: each file's `url` is signed for the person asking. Absent: the stored address. */
  fileLinks?: FileLinks;
}

/** 1.23.7: who may tick "Show to client" on a file — as for a task's own tick. */
export const FILE_SHOW_REFUSED = 'Only the project manager or an administrator can show a file to clients.';

export async function registerAttachmentRoutes(app: FastifyInstance, deps: AttachmentRouteDeps): Promise<void> {
  const { attachmentService, guard } = deps;
  const canView = (req: { user?: { id: string; roles?: string[] } }, taskId: string) =>
    deps.canViewTask ? deps.canViewTask(req.user!.id, req.user!.roles ?? [], taskId) : Promise.resolve(true);
  const denied = { error: { code: 'FORBIDDEN', message: 'You do not have access to this task.' } };
  /** 1.23.29: a task's files as the person asking may open them (each link signed for them). */
  const signed = (req: { user?: { id: string; ver?: number } }, files: AttachmentRecord[]) => signFiles(deps.fileLinks, files, viewerOfRequest(req));

  app.get('/tasks/:id/attachments', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(denied);
    return { data: signed(req, await attachmentService.list(id)) };
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
    return reply.status(201).send({ data: signed(req, [rec])[0] });
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

  // 1.23.7 "Show to client" on a task's file: clients of the project who may view tasks see it in the Client
  // portal (never on the share-link page). Who runs the project, or an administrator, as for the task's tick.
  if (deps.canManageTask) {
    const canManageTask = deps.canManageTask;
    const visibleBody = z.object({ visible: z.boolean() }).strict();
    app.put('/tasks/:id/attachments/:attachmentId/client-visible', { preHandler: guard.authenticate }, async (req, reply) => {
      const { id, attachmentId } = req.params as { id: string; attachmentId: string };
      if (!(await canView(req, id))) return reply.status(403).send(denied);
      const { visible } = visibleBody.parse(req.body ?? {});
      if (!(await canManageTask(req.user!.id, req.user!.roles ?? [], id))) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: FILE_SHOW_REFUSED } });
      const { before, record } = await attachmentService.setClientVisible(id, attachmentId, visible);
      if (before !== visible) {
        await deps.audit?.record({ userId: req.user!.id, ip: req.ip ?? null, module: 'client-view', action: visible ? 'client-view.file.shown' : 'client-view.file.hidden', entityId: attachmentId, newValue: { taskId: id, filename: record.filename } });
        if (visible) await Promise.resolve(deps.onShownToClient?.(attachmentId)).catch(() => undefined);
      }
      return { data: signed(req, [record])[0] };
    });
  }

  app.delete('/attachments/:attachmentId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const isAdmin = (req.user!.roles ?? []).includes('ADMIN');
    const removed = await attachmentService.remove(attachmentId, req.user!.id, isAdmin);
    await noteActivity(deps.recordActivity, { taskId: removed.taskId, userId: req.user!.id, action: 'ATTACHMENT_REMOVED', meta: { filename: removed.filename } });
    return reply.status(204).send();
  });
}
