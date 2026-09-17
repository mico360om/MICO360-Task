import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ActionItemService } from './action-item-service';
import type { ActionItemRecord } from './action-item-repository';
import type { AuthGuard } from '../auth/auth-guard';

const statusEnum = z.enum(['OPEN', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'CANCELLED']);
const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const createSchema = z.object({
  description: z.string().min(1),
  assigneeId: z.string().min(1).nullable().optional(),
  priority: priorityEnum.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  agendaItemId: z.string().min(1).nullable().optional(),
  sourceNoteId: z.string().min(1).nullable().optional(),
});

const patchSchema = z.object({
  description: z.string().min(1).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  priority: priorityEnum.optional(),
  dueDate: z.coerce.date().nullable().optional(),
  progress: z.number().int().min(0).max(100).optional(),
  status: statusEnum.optional(),
});

const mineQuery = z.object({
  status: statusEnum.optional(),
  openOnly: z.coerce.boolean().optional(),
});

export interface ActionItemRouteDeps {
  actionItemService: ActionItemService;
  guard: AuthGuard;
  /** Object-level view/edit authorization on the parent meeting. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** Inherit the meeting's project on creation (so the item shows up in project scope). */
  resolveMeetingProjectId?: (meetingId: string) => Promise<string | null>;
}

export async function registerActionItemRoutes(app: FastifyInstance, deps: ActionItemRouteDeps): Promise<void> {
  const { actionItemService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this action item.' } };
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };

  const canViewMeeting = (req: FastifyRequest, meetingId: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], meetingId) : Promise.resolve(true);

  // Access to a single item: via its meeting, or (standalone) creator/assignee/admin.
  async function canAccessItem(req: FastifyRequest, item: ActionItemRecord): Promise<boolean> {
    if (item.meetingId) return canViewMeeting(req, item.meetingId);
    return item.createdById === req.user!.id || item.assigneeId === req.user!.id || (req.user!.roles ?? []).includes('ADMIN');
  }

  // ── Cross-meeting: the caller's own action items ("My Action Items") ──
  app.get('/me/action-items', { preHandler: guard.authenticate }, async (req) => {
    const q = mineQuery.parse(req.query);
    return { data: await actionItemService.listMine(req.user!.id, { status: q.status, openOnly: q.openOnly }) };
  });

  // ── Meeting-scoped register ──
  app.get('/meetings/:id/action-items', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canViewMeeting(req, id))) return reply.status(404).send(notFound);
    return { data: await actionItemService.listByMeeting(id) };
  });

  app.post('/meetings/:id/action-items', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canViewMeeting(req, id))) return reply.status(403).send(forbidden);
    const body = createSchema.parse(req.body);
    const projectId = deps.resolveMeetingProjectId ? await deps.resolveMeetingProjectId(id) : null;
    const item = await actionItemService.addItem(id, req.user!.id, { ...body, projectId });
    return reply.status(201).send({ data: item });
  });

  app.patch('/action-items/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await actionItemService.getItem(id);
    if (!(await canAccessItem(req, item))) return reply.status(403).send(forbidden);
    const body = patchSchema.parse(req.body);
    let rec = item;
    const { status, ...fields } = body;
    if (Object.keys(fields).length) rec = await actionItemService.updateItem(id, fields);
    if (status !== undefined) rec = await actionItemService.setStatus(id, status);
    return { data: rec };
  });

  app.delete('/action-items/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await actionItemService.getItem(id);
    if (!(await canAccessItem(req, item))) return reply.status(403).send(forbidden);
    await actionItemService.removeItem(id);
    return reply.status(204).send();
  });
}
