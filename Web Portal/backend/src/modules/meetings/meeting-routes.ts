import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MeetingService } from './meeting-service';
import type { MeetingNotifyService } from './meeting-notify-service';
import type { AuthGuard } from '../auth/auth-guard';
import type { Logger } from '../../lib/logger';

const statusEnum = z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
const recurrenceSchema = z.object({
  freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  interval: z.number().int().min(1),
  count: z.number().int().min(1).nullable().optional(),
  until: z.string().nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  paused: z.boolean().optional(),
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: statusEnum.optional(),
  projectId: z.string().min(1).nullable().optional(),
  organizerId: z.string().min(1).optional(),
  location: z.string().nullable().optional(),
  onlineLink: z.string().nullable().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullable().optional(),
  timeZone: z.string().nullable().optional(),
  recurrenceRule: recurrenceSchema.nullable().optional(),
  templateId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: statusEnum.optional(),
  projectId: z.string().min(1).nullable().optional(),
  organizerId: z.string().min(1).optional(),
  location: z.string().nullable().optional(),
  onlineLink: z.string().nullable().optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().nullable().optional(),
  timeZone: z.string().nullable().optional(),
  recurrenceRule: recurrenceSchema.nullable().optional(),
});

const listQuery = z.object({
  projectId: z.string().optional(),
  status: statusEnum.optional(),
  mine: z.coerce.boolean().optional(),
});

export interface MeetingRouteDeps {
  meetingService: MeetingService;
  guard: AuthGuard;
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Object-level view/edit authorization. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** Project ids the user may see (null = admin) — scopes the list + gates project meetings on create. */
  accessibleProjectIds?: (userId: string, roles: string[]) => Promise<string[] | null>;
  /** Calendar invitations / cancellations (enables POST /meetings/:id/invites + auto-cancel notices). */
  notify?: Pick<MeetingNotifyService, 'sendInvites' | 'sendCancellation'>;
  /** Structured logger for best-effort background sends. */
  logger?: Pick<Logger, 'error'>;
}

export async function registerMeetingRoutes(app: FastifyInstance, deps: MeetingRouteDeps): Promise<void> {
  const { meetingService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } };
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);

  app.get('/meetings', { preHandler: guard.authenticate }, async (req) => {
    const q = listQuery.parse(req.query);
    const projectIds = deps.accessibleProjectIds ? await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []) : null;
    const data = await meetingService.listMeetings({
      projectId: q.projectId,
      status: q.status,
      scope: q.mine ? { userId: req.user!.id, projectIds: [] } : { userId: req.user!.id, projectIds },
    });
    return { data };
  });

  app.post('/meetings', { preHandler: guard.authenticate }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    // Creating a *project* meeting requires access to that project (standalone meetings are always allowed).
    if (body.projectId && deps.accessibleProjectIds) {
      const allowed = await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []);
      if (allowed && !allowed.includes(body.projectId)) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } });
    }
    const meeting = await meetingService.createMeeting({
      ...body,
      organizerId: body.organizerId ?? req.user!.id,
      createdById: req.user!.id,
    });
    if (meeting.projectId) deps.broadcast?.(meeting.projectId, 'meeting:created', { id: meeting.id });
    return reply.status(201).send({ data: meeting });
  });

  app.get('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    return { data: await meetingService.getMeeting(id) };
  });

  app.put('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const meeting = await meetingService.updateMeeting(id, updateSchema.parse(req.body));
    if (meeting.projectId) deps.broadcast?.(meeting.projectId, 'meeting:updated', { id: meeting.id });
    return { data: meeting };
  });

  app.post('/meetings/:id/duplicate', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    return reply.status(201).send({ data: await meetingService.duplicateMeeting(id, req.user!.id) });
  });

  app.post('/meetings/:id/cancel', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const meeting = await meetingService.cancelMeeting(id);
    // If invitations went out, notify attendees with a cancelling calendar update (best-effort).
    if (meeting.invitesSentAt && deps.notify) {
      deps.notify.sendCancellation(id).catch((err) => deps.logger?.error('meeting cancellation notice failed', { err, meetingId: id }));
    }
    return { data: meeting };
  });

  // Send (or re-send) calendar invitations with an .ics to the organizer + attendees.
  app.post('/meetings/:id/invites', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!deps.notify) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    const result = await deps.notify.sendInvites(id);
    return { data: result };
  });

  app.delete('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    await meetingService.deleteMeeting(id);
    return reply.status(204).send();
  });
}
