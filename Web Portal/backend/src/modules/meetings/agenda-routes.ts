import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AgendaService } from './agenda-service';
import type { AuthGuard } from '../auth/auth-guard';

const addSchema = z.object({
  title: z.string().min(1),
  ownerId: z.string().min(1).nullable().optional(),
  expectedMinutes: z.number().int().min(0).nullable().optional(),
  linkedPrevActionId: z.string().min(1).nullable().optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  expectedMinutes: z.number().int().min(0).nullable().optional(),
  completed: z.boolean().optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)),
});

export interface AgendaRouteDeps {
  agendaService: AgendaService;
  guard: AuthGuard;
  /** Object-level view/edit authorization on the parent meeting. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
}

export async function registerAgendaRoutes(app: FastifyInstance, deps: AgendaRouteDeps): Promise<void> {
  const { agendaService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } };
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const cannotEdit = { error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can change the agenda.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);
  const canEdit = (req: FastifyRequest, id: string): Promise<boolean> => agendaService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id);

  app.get('/meetings/:id/agenda', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    return { data: await agendaService.listAgenda(id) };
  });

  app.post('/meetings/:id/agenda', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const item = await agendaService.addItem(id, addSchema.parse(req.body));
    return reply.status(201).send({ data: item });
  });

  app.put('/meetings/:id/agenda/reorder', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const { orderedIds } = reorderSchema.parse(req.body);
    return { data: await agendaService.reorder(id, orderedIds) };
  });

  app.patch('/meetings/:id/agenda/:itemId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const body = patchSchema.parse(req.body);
    const completedOnly = body.completed !== undefined && Object.keys(body).length === 1;
    if (!(await canEdit(req, id))) {
      // An item's presenter may tick it off; any other change is the organizer's.
      const item = await agendaService.getItem(id, itemId);
      if (!completedOnly || item.ownerId !== req.user!.id) return reply.status(403).send(cannotEdit);
    }
    if (completedOnly) {
      return { data: await agendaService.setCompleted(id, itemId, body.completed!) };
    }
    let rec = await agendaService.updateItem(id, itemId, { title: body.title, ownerId: body.ownerId, expectedMinutes: body.expectedMinutes });
    if (body.completed !== undefined) rec = await agendaService.setCompleted(id, itemId, body.completed);
    return { data: rec };
  });

  app.delete('/meetings/:id/agenda/:itemId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    await agendaService.removeItem(id, itemId);
    return reply.status(204).send();
  });
}
