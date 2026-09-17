import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProjectService } from './project-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { storeImageUpload } from '../../lib/image-upload';
import { ValidationError } from '../../lib/http-errors';
import { computeProjectProgress, type ProgressTask } from './project-progress';

const statusEnum = z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);
const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const createSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  description: z.string().optional(),
  clientName: z.string().optional(),
  managerId: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  color: z.string().optional(),
  notes: z.string().optional(),
});
const updateSchema = createSchema.partial().omit({ code: true });

export interface ProjectRouteDeps {
  projectService: ProjectService;
  guard: AuthGuard;
  /** Lists a project's tasks (with column category) so progress can be computed. */
  listProjectTasks?: (projectId: string) => Promise<ProgressTask[]>;
  /** Records important project changes to the audit log. */
  audit?: AuditService;
  /** File storage for project images; when absent, the image upload endpoint is disabled. */
  storage?: AttachmentStorage;
  imageMaxBytes?: number;
}

export async function registerProjectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): Promise<void> {
  const { projectService, guard } = deps;
  const logAudit = (req: FastifyRequest, action: string, entityId: string | null, newValue?: unknown) =>
    deps.audit?.record({ userId: req.user?.id ?? null, ip: req.ip ?? null, module: 'projects', action, entityId, newValue });

  app.get('/projects', { preHandler: guard.authenticate }, async (req) => {
    // Employees see only projects they own/manage/belong to; admins see everything.
    return { data: await projectService.listVisibleProjects({ id: req.user!.id, roles: req.user!.roles ?? [] }) };
  });

  app.get('/projects/:id', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    return { data: await projectService.getVisibleProject(id, { id: req.user!.id, roles: req.user!.roles ?? [] }) };
  });

  // Per-project progress/dashboard — available to any user who can see the project.
  if (deps.listProjectTasks) {
    app.get('/projects/:id/progress', { preHandler: guard.authenticate }, async (req) => {
      const { id } = req.params as { id: string };
      await projectService.getVisibleProject(id, { id: req.user!.id, roles: req.user!.roles ?? [] }); // 404 if missing or no access
      const tasks = await deps.listProjectTasks!(id);
      return { data: computeProjectProgress(tasks) };
    });
  }

  app.post('/projects', { preHandler: guard.requireRoles('ADMIN') }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const created = await projectService.createProject({ ...body, createdById: req.user!.id });
    await logAudit(req, 'project.create', created.id, { code: created.code, name: created.name });
    return reply.status(201).send({ data: created });
  });

  app.put('/projects/:id', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const updated = await projectService.updateProject(id, body);
    await logAudit(req, 'project.update', id, body);
    return { data: updated };
  });

  // Upload / remove a project image (admin, consistent with other project mutations).
  app.post('/projects/:id/image', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    if (!deps.storage) throw new ValidationError('Uploads are not enabled.');
    const { id } = req.params as { id: string };
    await projectService.getProject(id); // 404 if missing
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded.');
    const content = await file.toBuffer();
    const { url } = await storeImageUpload(
      deps.storage,
      { filename: file.filename, mimeType: file.mimetype, content },
      { maxBytes: deps.imageMaxBytes ?? 5 * 1024 * 1024 },
    );
    const updated = await projectService.updateProject(id, { imageUrl: url });
    await logAudit(req, 'project.image.set', id);
    return { data: updated };
  });

  app.delete('/projects/:id/image', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const { id } = req.params as { id: string };
    const updated = await projectService.updateProject(id, { imageUrl: null });
    await logAudit(req, 'project.image.clear', id);
    return { data: updated };
  });

  // Archive (soft) — a first-class action instead of a raw status PUT (admin-only).
  app.post('/projects/:id/archive', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const { id } = req.params as { id: string };
    const archived = await projectService.archiveProject(id);
    await logAudit(req, 'project.archive', id);
    return { data: archived };
  });

  app.delete('/projects/:id', { preHandler: guard.requireRoles('ADMIN') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await projectService.deleteProject(id);
    await logAudit(req, 'project.delete', id);
    return reply.status(204).send();
  });
}
