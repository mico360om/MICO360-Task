import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AttendeeService } from './attendee-service';
import type { AuthGuard } from '../auth/auth-guard';
import { InviteeOnlyError, type MeetingViewOf } from './invitee-view';
import type { InviteTarget, MeetingInvitees } from './meeting-invitees';

const roleEnum = z.enum(['REQUIRED', 'OPTIONAL']);
const attendanceEnum = z.enum(['INVITED', 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);
const responseEnum = z.enum(['PENDING', 'ACCEPTED', 'TENTATIVE', 'DECLINED']);

const addSchema = z
  .object({
    userId: z.string().min(1).nullable().optional(),
    externalName: z.string().min(1).nullable().optional(),
    externalEmail: z.string().email().nullable().optional(),
    role: roleEnum.optional(),
    attendance: attendanceEnum.optional(),
    department: z.string().nullable().optional(),
  })
  .refine((v) => !!v.userId || !!v.externalName, { message: 'An attendee needs either a user or an external name.' });

const patchSchema = z.object({
  role: roleEnum.optional(),
  attendance: attendanceEnum.optional(),
  response: responseEnum.optional(),
  department: z.string().nullable().optional(),
  /** A guest's email address, added later ("Add email"): the organizer's call, as adding the guest is. */
  externalEmail: z.string().trim().email().max(254).optional(),
});

const suggestQuery = z.object({
  from: z.string().optional(), // comma-separated previous meeting ids
});

/** Upper bound on "suggest from previous meetings" sources per request. */
const MAX_SUGGESTION_SOURCES = 20;

export interface AttendeeRouteDeps {
  attendeeService: AttendeeService;
  guard: AuthGuard;
  /** Object-level view authorization on the parent meeting. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** companies: how a person sees the meeting — an invitee may read its people and answer their own invitation. */
  viewOf?: MeetingViewOf;
  /** companies: who may be invited to a meeting (adding someone outside its companies is refused). */
  invitees?: MeetingInvitees;
  /** companies: where a meeting's people come from — its project, or its company. */
  inviteTargetOf?: (meetingId: string) => Promise<InviteTarget | null>;
  /**
   * companies: the meeting's people by name (its organizer first, then its attendees) — someone invited
   * from another company doesn't find them in their directory, so the roster carries them.
   */
  peopleOf?: (meetingId: string, attendeeUserIds: string[]) => Promise<MeetingPerson[]>;
}

/** One of a meeting's people as its roster names them. */
export interface MeetingPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** 1.23: a client account (the roster marks them "Client"). */
  client?: boolean;
}

export async function registerAttendeeRoutes(app: FastifyInstance, deps: AttendeeRouteDeps): Promise<void> {
  const { attendeeService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } };
  const cannotEdit = { error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can change the attendees.' } };
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);
  const canEdit = (req: FastifyRequest, id: string): Promise<boolean> => attendeeService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id);
  /** 'full', 'invitee' (invited from outside the project's companies) or null. */
  const viewOf = async (req: FastifyRequest, id: string) =>
    deps.viewOf ? deps.viewOf(req.user!.id, req.user!.roles ?? [], id) : (await canView(req, id)) ? ('full' as const) : null;
  const viewer = (req: FastifyRequest) => ({ id: req.user!.id, roles: req.user!.roles ?? [] });

  app.get('/meetings/:id/attendees', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await viewOf(req, id))) return reply.status(404).send(notFound);
    const attendees = await attendeeService.listAttendees(id);
    if (!deps.peopleOf) return { data: attendees };
    // companies: names beside `data` (the rows stay what every client reads), as chat's `authors`.
    const people = await deps.peopleOf(id, attendees.flatMap((a) => (a.userId ? [a.userId] : [])));
    return { data: attendees, people };
  });

  app.post('/meetings/:id/attendees', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const body = addSchema.parse(req.body);
    // companies: a colleague from the meeting's project or company (outside guests by email as before).
    if (body.userId && deps.invitees && deps.inviteTargetOf) {
      const target = await deps.inviteTargetOf(id);
      if (target) await deps.invitees.assertInvitable(viewer(req), target, [body.userId]);
    }
    const attendee = await attendeeService.addAttendee(id, body);
    return reply.status(201).send({ data: attendee });
  });

  app.get('/meetings/:id/attendees/suggestions', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    const q = suggestQuery.parse(req.query);
    const requested = [...new Set((q.from ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_SUGGESTION_SOURCES);
    // Only meetings the caller can see may be mined for names — others' rosters stay private.
    const visible = await Promise.all(requested.map(async (mid) => ((await canView(req, mid)) ? mid : null)));
    const previous = visible.filter((mid): mid is string => mid !== null);
    const suggested = await attendeeService.suggestAttendees(id, previous);
    // companies: only people who could be invited to this meeting.
    if (!deps.invitees || !deps.inviteTargetOf || suggested.length === 0) return { data: suggested };
    const target = await deps.inviteTargetOf(id);
    const allowed = target ? new Set((await deps.invitees.candidates(viewer(req), target).catch(() => [])).map((p) => p.id)) : new Set<string>();
    return { data: suggested.filter((u) => allowed.has(u)) };
  });

  app.patch('/meetings/:id/attendees/:attendeeId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, attendeeId } = req.params as { id: string; attendeeId: string };
    const view = await viewOf(req, id);
    if (!view) return reply.status(403).send(forbidden);
    const body = patchSchema.parse(req.body);
    if (view === 'invitee') {
      // companies: someone invited from another company answers their own invitation, nothing more.
      const own = await attendeeService.getAttendee(id, attendeeId);
      if (own.userId !== req.user!.id || body.role !== undefined || body.department !== undefined || body.externalEmail !== undefined) throw new InviteeOnlyError();
    } else if (!(await canEdit(req, id))) {
      // Attendees may record their own attendance and answer their own invitation; everything else
      // is the organizer's call (who may also record a guest's emailed answer, or add their address).
      const own = await attendeeService.getAttendee(id, attendeeId);
      const ownFieldsOnly = body.role === undefined && body.department === undefined && body.externalEmail === undefined;
      if (!ownFieldsOnly || own.userId !== req.user!.id) return reply.status(403).send(cannotEdit);
    }
    let rec = null;
    if (body.externalEmail !== undefined) rec = await attendeeService.setGuestEmail(id, attendeeId, body.externalEmail);
    if (body.attendance !== undefined) rec = await attendeeService.setAttendance(id, attendeeId, body.attendance);
    if (body.response !== undefined) rec = await attendeeService.setResponse(id, attendeeId, body.response);
    if (body.role !== undefined || body.department !== undefined) {
      rec = await attendeeService.updateAttendee(id, attendeeId, { role: body.role, department: body.department });
    }
    if (!rec) rec = await attendeeService.getAttendee(id, attendeeId);
    return { data: rec };
  });

  app.delete('/meetings/:id/attendees/:attendeeId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, attendeeId } = req.params as { id: string; attendeeId: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    await attendeeService.removeAttendee(id, attendeeId);
    return reply.status(204).send();
  });
}
