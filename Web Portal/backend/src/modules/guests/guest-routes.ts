import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthGuard } from '../auth/auth-guard';
import type { GuestService } from './guest-service';
import { idString } from '../tasks/validation';

/**
 * 1.24 Guests: the website's way to the company guest list and to a task's guests. Staff only (a client's
 * session is refused by the guard's route table); a guest never becomes a user and gets nothing sent.
 *
 *   GET    /projects/:projectId/guests?q=          the project's company list, for picking (who can see it)
 *   POST   /projects/:projectId/guests/check       the New guest form's duplicate check
 *   POST   /projects/:projectId/guests             a new guest on that list (409 GUEST_DUPLICATE unless confirmNew)
 *   GET    /tasks/:id/guests                       a task's guests in full
 *   POST   /tasks/:id/guests                       put a guest on it (400 NEEDS_TEAM_MEMBER without a team member)
 *   PATCH  /tasks/:id/guests/:guestId              the task's note for the guest
 *   DELETE /tasks/:id/guests/:guestId              take the guest off it
 *   GET    /guests?companyId=&q=&status=           admins: the Guest contacts page
 *   PUT    /guests/:guestId                        admins: change details and notes (every task shows them)
 *   POST   /guests/:guestId/retire | /unretire     admins: hide from picking / use again
 *   POST   /guests/merge                           admins: merge duplicates into one
 *   DELETE /guests/:guestId                        admins: remove (409 GUEST_IN_USE while on any task)
 */
/** A field as sent: checked and cleaned by the shared rules; bounded here only so a huge body can't reach them. */
const field = z.string().max(5000).nullable().optional();
const guestSchema = z.object({ name: field, company: field, designation: field, email: field, phone: field });
const createSchema = guestSchema.extend({ confirmNew: z.boolean().optional() });
const adminSchema = guestSchema.extend({ notes: field });
const linkSchema = z.object({ guestId: idString, note: field });
const noteSchema = z.object({ note: field });
const listQuery = z.object({ q: z.string().max(120).optional() });
const adminQuery = z.object({ companyId: idString.optional(), q: z.string().max(120).optional(), status: z.enum(['active', 'retired', 'all']).optional() });
const mergeSchema = z.object({ keepId: idString, mergeIds: z.array(idString).min(1).max(50) });

type Check = (userId: string, roles: string[], id: string) => Promise<boolean>;

export interface GuestRouteDeps {
  service: GuestService;
  guard: AuthGuard;
  canViewTask?: Check;
  /** Whoever may edit the task may change its guests (the task's own rule). Defaults to canViewTask. */
  canEditTask?: Check;
  canViewProject?: Check;
  /** Open boards and task views refresh (`task:updated`). */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  taskOf?: (taskId: string) => Promise<{ projectId: string } | null>;
}

const noTask = { error: { code: 'NOT_FOUND', message: 'Task not found.' } };
const noProject = { error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } };

export async function registerGuestRoutes(app: FastifyInstance, deps: GuestRouteDeps): Promise<void> {
  const { service, guard } = deps;
  const ask = (check: Check | undefined, req: FastifyRequest, id: string) => (check ? check(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true));
  const canView = (req: FastifyRequest, taskId: string) => ask(deps.canViewTask, req, taskId);
  const canEdit = async (req: FastifyRequest, taskId: string) => (await canView(req, taskId)) && (await ask(deps.canEditTask, req, taskId));
  const announce = async (taskId: string) => {
    if (!deps.broadcast || !deps.taskOf) return;
    const task = await deps.taskOf(taskId).catch(() => null);
    if (task) deps.broadcast(task.projectId, 'task:updated', task);
  };

  // ---- the company list, through a project ----------------------------------------------------------
  app.get('/projects/:projectId/guests', { preHandler: guard.authenticate }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await ask(deps.canViewProject, req, projectId))) return reply.status(403).send(noProject);
    const { q } = listQuery.parse(req.query);
    return { data: await service.listForProject(projectId, q ?? '') };
  });

  app.post('/projects/:projectId/guests/check', { preHandler: guard.authenticate }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await ask(deps.canViewProject, req, projectId))) return reply.status(403).send(noProject);
    return { data: await service.duplicatesFor(projectId, guestSchema.parse(req.body ?? {})) };
  });

  app.post('/projects/:projectId/guests', { preHandler: guard.authenticate }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    if (!(await ask(deps.canViewProject, req, projectId))) return reply.status(403).send(noProject);
    const { confirmNew, ...draft } = createSchema.parse(req.body ?? {});
    return reply.status(201).send({ data: await service.createForProject(projectId, draft, req.user!.id, { confirmNew }) });
  });

  // ---- a task's guests --------------------------------------------------------------------------------
  app.get('/tasks/:id/guests', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(noTask);
    return { data: await service.taskGuests(id) };
  });

  app.post('/tasks/:id/guests', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canEdit(req, id))) return reply.status(404).send(noTask);
    const { guestId, note } = linkSchema.parse(req.body ?? {});
    const link = await service.addToTask(id, guestId, note, req.user!.id);
    await announce(id);
    return reply.status(201).send({ data: link });
  });

  app.patch('/tasks/:id/guests/:guestId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, guestId } = req.params as { id: string; guestId: string };
    if (!(await canEdit(req, id))) return reply.status(404).send(noTask);
    const { note } = noteSchema.parse(req.body ?? {});
    const link = await service.setNote(id, idString.parse(guestId), note);
    await announce(id);
    return { data: link };
  });

  app.delete('/tasks/:id/guests/:guestId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, guestId } = req.params as { id: string; guestId: string };
    if (!(await canEdit(req, id))) return reply.status(404).send(noTask);
    await service.removeFromTask(id, idString.parse(guestId), req.user!.id);
    await announce(id);
    return reply.status(204).send();
  });

  // ---- admins: the Guest contacts page ------------------------------------------------------------------
  const admin = { preHandler: guard.requireRoles('ADMIN') };
  app.get('/guests', admin, async (req) => {
    const q = adminQuery.parse(req.query);
    return { data: await service.adminList({ companyId: q.companyId ?? null, q: q.q, status: q.status }) };
  });
  app.put('/guests/:guestId', admin, async (req) => {
    const { guestId } = req.params as { guestId: string };
    return { data: await service.adminUpdate(idString.parse(guestId), adminSchema.parse(req.body ?? {})) };
  });
  app.post('/guests/:guestId/retire', admin, async (req) => {
    const { guestId } = req.params as { guestId: string };
    return { data: await service.setRetired(idString.parse(guestId), true) };
  });
  app.post('/guests/:guestId/unretire', admin, async (req) => {
    const { guestId } = req.params as { guestId: string };
    return { data: await service.setRetired(idString.parse(guestId), false) };
  });
  app.post('/guests/merge', admin, async (req) => {
    const { keepId, mergeIds } = mergeSchema.parse(req.body ?? {});
    return { data: await service.merge(keepId, mergeIds, req.user!.id) };
  });
  app.delete('/guests/:guestId', admin, async (req, reply) => {
    const { guestId } = req.params as { guestId: string };
    await service.remove(idString.parse(guestId));
    return reply.status(204).send();
  });
}
