import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ProjectService } from './project-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { ProjectAuthz } from './project-authz';
import type { ProjectRecord } from './project-repository';
import type { ProjectNotices } from './project-notices';
import type { AuditService } from '../audit/audit-service';
import type { AttachmentStorage } from '../tasks/attachment-repository';
import { storeImageUpload } from '../../lib/image-upload';
import { ForbiddenError, ValidationError } from '../../lib/http-errors';
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

/** A new project as asked for (also the project part of "make a project from a template"). */
export const createSchema = z.object({
  code: z.string().max(40).transform(normalizeCode).refine((c) => CODE_PATTERN.test(c), CODE_RULE),
  // The project's own number (e.g. the client's job number): free text, up to 40 characters; empty = none.
  number: z.string().trim().max(40, 'A project number has at most 40 characters.').transform((n) => n || null).nullable().optional(),
  name: requiredText,
  description: longText.optional(),
  clientName: shortText.optional(),
  // The named manager: an administrator's to set or clear (null); others may only leave it as it is.
  managerId: idString.nullable().optional(),
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
  // New projects only: the people put on its team at once (the creator and the owner join anyway).
  memberIds: z.array(idString).max(500).optional(),
});
const updateSchema = createSchema.partial().omit({ code: true, memberIds: true });

/** What a refused change says (the project's other members see it; outsiders get a 404). */
export const CHANGE_REFUSED = 'Only this project’s owner, its managers or an administrator can change it.';

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
  /**
   * Who may change a project (its owner, named manager or MANAGER members, and admins). Without it,
   * only administrators may.
   */
  authz?: ProjectAuthz;
  /** Tells the owner and the team of a new project that they're on it. */
  notices?: ProjectNotices;
}

export async function registerProjectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): Promise<void> {
  const { projectService, guard } = deps;
  const logAudit = (req: FastifyRequest, action: string, entityId: string | null, newValue?: unknown) =>
    deps.audit?.record({ userId: req.user?.id ?? null, ip: req.ip ?? null, module: 'projects', action, entityId, newValue });
  const viewer = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const isAdmin = (roles: string[]) => roles.includes('ADMIN');
  const canManage = (user: { id: string; roles: string[] }, projectId: string) =>
    deps.authz ? deps.authz.canManageProject(user.id, user.roles, projectId) : Promise.resolve(isAdmin(user.roles));
  const manageable = async (user: { id: string; roles: string[] }, ids: string[]): Promise<Set<string>> =>
    deps.authz ? deps.authz.manageableProjectIds(user.id, user.roles, ids) : new Set(isAdmin(user.roles) ? ids : []);
  /** A project as sent back: with whether the person asking may change it. */
  const withCanManage = async (user: { id: string; roles: string[] }, project: ProjectRecord) => ({ ...project, canManage: await canManage(user, project.id) });

  /**
   * The project, if the person asking may change it: hidden (404) from someone who can't even see
   * it, refused (403) for its other members.
   */
  async function projectToChange(req: FastifyRequest, id: string): Promise<ProjectRecord> {
    const user = viewer(req);
    const project = await projectService.getVisibleProject(id, user);
    if (!(await canManage(user, id))) throw new ForbiddenError(CHANGE_REFUSED);
    return project;
  }

  app.get('/projects', { preHandler: guard.authenticate }, async (req) => {
    // Employees see only projects they own/manage/belong to; admins see everything.
    const user = viewer(req);
    const projects = await projectService.listVisibleProjects(user);
    const can = await manageable(user, projects.map((p) => p.id));
    return { data: projects.map((p) => ({ ...p, canManage: can.has(p.id) })) };
  });

  // The Projects page: every project the caller may see, with only what its card shows — figures
  // (tasks done, open and overdue, the next due day, its last update), owner, up to four team faces
  // and the team's size, and whether it is the caller's — one request for the whole list, answered
  // by a fixed number of grouped queries.
  if (deps.overview) {
    app.get('/projects/overview', { preHandler: guard.authenticate }, async (req) => {
      const user = viewer(req);
      const projects = await projectService.listVisibleProjects(user);
      const ownerIds = [...new Set(projects.map((p) => p.ownerId).filter((id): id is string => !!id))];
      const ids = projects.map((p) => p.id);
      const [rows, can] = await Promise.all([deps.overview!.load(ids, ownerIds), manageable(user, ids)]);
      return { data: buildProjectOverview(projects, rows, { timeZone: deps.timeZone ?? defaultCompanyTimeZone(), viewerId: user.id, manageable: can }) };
    });
  }

  // Is a code well formed and free (deleted projects keep theirs)? Asked while typing a new project —
  // which anyone signed in may create.
  app.get('/projects/code-check', { preHandler: guard.authenticate }, async (req) => {
    const { code } = z.object({ code: z.string().max(40) }).parse(req.query);
    return { data: await projectService.checkCode(code) };
  });

  app.get('/projects/:id', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const user = viewer(req);
    return { data: await withCanManage(user, await projectService.getVisibleProject(id, user)) };
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

  // Anyone signed in may create a project. An employee owns it unless they pick someone else, and is
  // on its team as a manager either way (project-service: newProjectTeam).
  app.post('/projects', { preHandler: guard.authenticate }, async (req, reply) => {
    const user = viewer(req);
    const body = createSchema.parse(req.body);
    const { team, ...created } = await projectService.createProject({ ...body, createdById: user.id }, user);
    await logAudit(req, 'project.create', created.id, { code: created.code, name: created.name, createdById: user.id, ownerId: created.ownerId, team });
    await deps.notices?.projectCreated({ actorId: user.id, project: created, userIds: team.map((m) => m.userId) });
    return reply.status(201).send({ data: await withCanManage(user, created) });
  });

  // Its owner, named manager or MANAGER members (or an admin) change its details, status and owner.
  app.put('/projects/:id', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const user = viewer(req);
    await projectToChange(req, id);
    const body = updateSchema.parse(req.body);
    const { project, keptAsManagers } = await projectService.editProject(id, body, user);
    await logAudit(req, 'project.update', id, keptAsManagers.length ? { ...body, keptAsManagers } : body);
    return { data: await withCanManage(user, project) };
  });

  // Upload / remove a project image (whoever may change the project, as for its other details).
  app.post('/projects/:id/image', { preHandler: guard.authenticate }, async (req) => {
    if (!deps.storage) throw new ValidationError('Uploads are not enabled.');
    const { id } = req.params as { id: string };
    const before = await projectToChange(req, id); // 404 if missing or hidden, 403 if not theirs to change
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
    return { data: await withCanManage(viewer(req), updated) };
  });

  app.delete('/projects/:id/image', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    const before = await projectToChange(req, id);
    const updated = await projectService.updateProject(id, { imageUrl: null });
    const old = storedKey(before.imageUrl);
    if (old && deps.storage) await deps.storage.remove(old).catch(() => {});
    await logAudit(req, 'project.image.clear', id);
    return { data: await withCanManage(viewer(req), updated) };
  });

  // Archive (soft) — a first-class action instead of a raw status PUT (whoever may change the project).
  app.post('/projects/:id/archive', { preHandler: guard.authenticate }, async (req) => {
    const { id } = req.params as { id: string };
    await projectToChange(req, id);
    const archived = await projectService.archiveProject(id);
    await logAudit(req, 'project.archive', id);
    return { data: await withCanManage(viewer(req), archived) };
  });

  // Deleting a project stays an administrator's alone.
  app.delete('/projects/:id', { preHandler: guard.requireRoles('ADMIN') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await projectService.deleteProject(id);
    await logAudit(req, 'project.delete', id);
    return reply.status(204).send();
  });
}
