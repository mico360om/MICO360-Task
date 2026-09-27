import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MeetingService } from './meeting-service';
import type { MeetingNotifyService } from './meeting-notify-service';
import type { MeetingRecord } from './meeting-repository';
import type { AuthGuard } from '../auth/auth-guard';
import type { Logger } from '../../lib/logger';
import { onlineLinkField, timeZoneField } from './meeting-validation';

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
  onlineLink: onlineLinkField,
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullable().optional(),
  timeZone: timeZoneField,
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
  onlineLink: onlineLinkField,
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().nullable().optional(),
  timeZone: timeZoneField,
  recurrenceRule: recurrenceSchema.nullable().optional(),
});

const listQuery = z.object({
  projectId: z.string().optional(),
  status: statusEnum.optional(),
  // "Organized by me". Parsed explicitly: z.coerce.boolean() would read "false" as true.
  mine: z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1').optional(),
});

export interface MeetingRouteDeps {
  meetingService: MeetingService;
  guard: AuthGuard;
  /**
   * Accepted for app wiring but unused: meeting events are broadcast once, by the meeting
   * service's onChanged hook (server.ts), so clients don't refetch twice per change.
   */
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** Object-level view authorization. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** Project ids the user may see (null = admin) — scopes the list + gates project meetings on create/move. */
  accessibleProjectIds?: (userId: string, roles: string[]) => Promise<string[] | null>;
  /** Calendar invitations / cancellations (enables POST /meetings/:id/invites + automatic updates). */
  notify?: Pick<MeetingNotifyService, 'sendInvites' | 'sendCancellation'>;
  /** Structured logger for best-effort background sends. */
  logger?: Pick<Logger, 'error'>;
}

/** Did a change alter what invitees see in their calendar (so an updated invitation is due)? */
function calendarChanged(before: MeetingRecord, after: MeetingRecord): boolean {
  const time = (d: Date | null) => (d ? d.getTime() : null);
  return (
    time(before.startAt) !== time(after.startAt) ||
    time(before.endAt) !== time(after.endAt) ||
    before.title !== after.title ||
    before.description !== after.description ||
    before.location !== after.location ||
    before.onlineLink !== after.onlineLink ||
    before.timeZone !== after.timeZone ||
    JSON.stringify(before.recurrenceRule ?? null) !== JSON.stringify(after.recurrenceRule ?? null)
  );
}

export async function registerMeetingRoutes(app: FastifyInstance, deps: MeetingRouteDeps): Promise<void> {
  const { meetingService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } };
  const cannotEdit = { error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can change this meeting.' } };
  const noProject = { error: { code: 'FORBIDDEN', message: 'You do not have access to this project.' } };
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const actor = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);
  const canEdit = (req: FastifyRequest, id: string): Promise<boolean> => meetingService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id);

  async function canUseProject(req: FastifyRequest, projectId: string): Promise<boolean> {
    if (!deps.accessibleProjectIds) return true;
    const allowed = await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []);
    return !allowed || allowed.includes(projectId);
  }

  /** Attach `canEdit` to each meeting; project-manager lookups are shared per project. */
  async function withEditFlags(req: FastifyRequest, list: MeetingRecord[]) {
    const { id: userId, roles } = actor(req);
    const byProject = new Map<string, Promise<boolean>>();
    return Promise.all(
      list.map(async (m) => {
        let canEditThis: Promise<boolean>;
        if (m.organizerId === userId || m.createdById === userId || !m.projectId) {
          canEditThis = meetingService.canEditMeetingRecord(m, userId, roles);
        } else {
          // Not the organizer/creator: the answer depends only on the project (manager / admin).
          canEditThis = byProject.get(m.projectId) ?? meetingService.canEditMeetingRecord({ organizerId: '', createdById: '', projectId: m.projectId }, userId, roles);
          byProject.set(m.projectId, canEditThis);
        }
        return { ...m, canEdit: await canEditThis };
      }),
    );
  }

  /** Fire a best-effort email job without failing (or slowing) the request. */
  function background(job: Promise<unknown>, what: string, meetingId: string): void {
    job.catch((err) => deps.logger?.error(what, { err, meetingId }));
  }

  app.get('/meetings', { preHandler: guard.authenticate }, async (req) => {
    const q = listQuery.parse(req.query);
    const projectIds = deps.accessibleProjectIds ? await deps.accessibleProjectIds(req.user!.id, req.user!.roles ?? []) : null;
    const data = await meetingService.listMeetings({
      projectId: q.projectId,
      status: q.status,
      ...(q.mine ? { organizerId: req.user!.id } : {}),
      scope: q.mine ? { userId: req.user!.id, projectIds: [] } : { userId: req.user!.id, projectIds },
    });
    return { data: await withEditFlags(req, data) };
  });

  app.post('/meetings', { preHandler: guard.authenticate }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    // Invitations go out in the organizer's name: only an admin may schedule on someone else's behalf.
    if (body.organizerId && body.organizerId !== req.user!.id && !actor(req).roles.includes('ADMIN')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You can only schedule meetings that you organize.' } });
    }
    // Creating a *project* meeting requires access to that project (standalone meetings are always allowed).
    if (body.projectId && !(await canUseProject(req, body.projectId))) return reply.status(403).send(noProject);
    const meeting = await meetingService.createMeeting({
      ...body,
      organizerId: body.organizerId ?? req.user!.id,
      createdById: req.user!.id,
    });
    return reply.status(201).send({ data: { ...meeting, canEdit: true } });
  });

  app.get('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    const [meeting] = await withEditFlags(req, [await meetingService.getMeeting(id)]);
    return { data: meeting };
  });

  app.put('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const patch = updateSchema.parse(req.body);
    const before = await meetingService.getMeeting(id);
    // Moving the meeting into a project requires access to that project.
    if (patch.projectId && patch.projectId !== before.projectId && !(await canUseProject(req, patch.projectId))) {
      return reply.status(403).send(noProject);
    }
    // The organizer can be handed over only to someone already in the meeting (attendee or project member).
    if (
      patch.organizerId &&
      patch.organizerId !== before.organizerId &&
      !actor(req).roles.includes('ADMIN') &&
      deps.canViewMeeting &&
      !(await deps.canViewMeeting(patch.organizerId, [], id))
    ) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'The new organizer must be an attendee or a member of the meeting’s project.' } });
    }
    const meeting = await meetingService.updateMeeting(id, patch);
    // Keep invitees' calendars in step once invitations have gone out.
    if (before.invitesSentAt && deps.notify) {
      if (meeting.status === 'CANCELLED' && before.status !== 'CANCELLED') {
        background(deps.notify.sendCancellation(id), 'meeting cancellation notice failed', id);
      } else if (meeting.status !== 'CANCELLED' && calendarChanged(before, meeting)) {
        background(deps.notify.sendInvites(id), 'meeting update notice failed', id);
      }
    }
    const [data] = await withEditFlags(req, [meeting]);
    return { data };
  });

  app.post('/meetings/:id/duplicate', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const copy = await meetingService.duplicateMeeting(id, req.user!.id);
    return reply.status(201).send({ data: { ...copy, canEdit: true } });
  });

  app.post('/meetings/:id/cancel', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const before = await meetingService.getMeeting(id);
    const meeting = await meetingService.cancelMeeting(id);
    // If invitations went out, notify attendees with a cancelling calendar update (best-effort).
    if (meeting.invitesSentAt && before.status !== 'CANCELLED' && deps.notify) {
      background(deps.notify.sendCancellation(id), 'meeting cancellation notice failed', id);
    }
    return { data: { ...meeting, canEdit: true } };
  });

  // Send (or re-send) calendar invitations with an .ics to the organizer + attendees.
  app.post('/meetings/:id/invites', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    if (!deps.notify) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    const result = await deps.notify.sendInvites(id);
    return { data: result };
  });

  app.delete('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const deleted = await meetingService.deleteMeeting(id);
    // Deleting an invited meeting removes it from everyone's calendar.
    if (deleted.invitesSentAt && deleted.status !== 'CANCELLED' && deps.notify) {
      background(deps.notify.sendCancellation(id, { meeting: deleted }), 'meeting cancellation notice failed', id);
    }
    return reply.status(204).send();
  });
}
