import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProjectService } from './project-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { AuditService } from '../audit/audit-service';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { storeImageUpload } from '../../lib/image-upload';
import { ValidationError } from '../../lib/http-errors';
import { computeProjectProgress, type ProgressTask } from './project-progress';
import { buildProjectOverview, type ProjectOverviewSource } from './project-overview';
import { defaultCompanyTimeZone } from '../tasks/task-status';
import { idString, longText, requiredText, shortText } from '../tasks/validation';
import { CODE_PATTERN, CODE_RULE, HEX_COLOR, PROJECT_ICONS, normalizeCode } from './project-icons';

/** Project pictures: what the web app's cropper sends, with room for a logo uploaded as is. */
export const PROJECT_IMAGE_RULES = {
  allowedMime: ['image/png', 'image/jpeg', 'image/webp'],
  typeMessage: 'Use a PNG, JPG or WebP image.',
  contentMessage: 'This file isn’t a real PNG, JPG or WebP picture — it may be damaged or renamed.',
  maxBytes: 2 * 1024 * 1024,
  minSide: 16,
  maxSide: 4096,
};

/** '/uploads/<key>' → '<key>' (only for files this server stored). */
const storedKey = (url: string | null | undefined) => (url && url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null);

const statusEnum = z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']);
const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const createSchema = z.object({
  code: z.string().max(40).transform(normalizeCode).refine((c) => CODE_PATTERN.test(c), CODE_RULE),
  // The project's own number (e.g. the client's job number): free text, up to 40 characters; empty = none.
  number: z.string().trim().max(40, 'A project number has at most 40 characters.').transform((n) => n || null).nullable().optional(),
  name: requiredText,
  description: longText.optional(),
  clientName: shortText.optional(),
  managerId: idString.optional(),
  ownerId: idString.nullable().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  color: z.string().trim().regex(HEX_COLOR, 'Use a colour like #8B1E1E.').optional(),
  icon: z.enum(PROJECT_ICONS).nullable().optional(),
  notes: longText.optional(),
  // Task settings. Missing on create = what every project starts with; missing on update = unchanged
  // (older apps, including the Android app, send project updates without them).
  carryForward: z.boolean().optional(),
  defaultDueToday: z.boolean().optional(),
});
const updateSchema = createSchema.partial().omit({ code: true });

export interface ProjectRouteDeps {
  projectService: ProjectService;
  guard: AuthGuard;
  /** Lists a project's tasks (with column category) so progress can be computed. */
  listProjectTasks?: (projectId: string) => Promise<ProgressTask[]>;
  /** Company time zone for "overdue" in progress (defaults to COMPANY_TIMEZONE). */
  timeZone?: string;
  /** The projects list's figures (counts, next due day, team) in grouped queries; enables GET /projects/overview. */
  overview?: ProjectOverviewSource;
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

  // The Projects page: every project the caller may see, with only what its card shows — figures
  // (tasks done, open and overdue, the next due day, its last update), owner, up to four team faces
  // and the team's size, and whether it is the caller's — one request for the whole list, answered
  // by a fixed number of grouped queries.
  if (deps.overview) {
    app.get('/projects/overview', { preHandler: guard.authenticate }, async (req) => {
      const projects = await projectService.listVisibleProjects({ id: req.user!.id, roles: req.user!.roles ?? [] });
      const ownerIds = [...new Set(projects.map((p) => p.ownerId).filter((id): id is string => !!id))];
      const rows = await deps.overview!.load(projects.map((p) => p.id), ownerIds);
      return { data: buildProjectOverview(projects, rows, { timeZone: deps.timeZone ?? defaultCompanyTimeZone(), viewerId: req.user!.id }) };
    });
  }

  // Is a code well formed and free (deleted projects keep theirs)? Asked while typing a new project.
  app.get('/projects/code-check', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const { code } = z.object({ code: z.string().max(40) }).parse(req.query);
    return { data: await projectService.checkCode(code) };
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
      return { data: computeProjectProgress(tasks, new Date(), deps.timeZone) };
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
    const before = await projectService.getProject(id); // 404 if missing
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded.');
    const content = await file.toBuffer();
    const { url } = await storeImageUpload(
      deps.storage,
      { filename: file.filename, mimeType: file.mimetype, content },
      { ...PROJECT_IMAGE_RULES, maxBytes: Math.min(PROJECT_IMAGE_RULES.maxBytes, deps.imageMaxBytes ?? PROJECT_IMAGE_RULES.maxBytes) },
    );
    const updated = await projectService.updateProject(id, { imageUrl: url });
    // The picture it replaces is no longer used anywhere.
    const old = storedKey(before.imageUrl);
    if (old) await deps.storage.remove(old).catch(() => {});
    await logAudit(req, 'project.image.set', id);
    return { data: updated };
  });

  app.delete('/projects/:id/image', { preHandler: guard.requireRoles('ADMIN') }, async (req) => {
    const { id } = req.params as { id: string };
    const before = await projectService.getProject(id);
    const updated = await projectService.updateProject(id, { imageUrl: null });
    const old = storedKey(before.imageUrl);
    if (old && deps.storage) await deps.storage.remove(old).catch(() => {});
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
