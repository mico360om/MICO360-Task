import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AttendeeService } from './attendee-service';
import type { AuthGuard } from '../auth/auth-guard';

const roleEnum = z.enum(['REQUIRED', 'OPTIONAL']);
const attendanceEnum = z.enum(['INVITED', 'PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);

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
  department: z.string().nullable().optional(),
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
}

export async function registerAttendeeRoutes(app: FastifyInstance, deps: AttendeeRouteDeps): Promise<void> {
  const { attendeeService, guard } = deps;
  const forbidden = { error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } };
  const cannotEdit = { error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can change the attendees.' } };
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);
  const canEdit = (req: FastifyRequest, id: string): Promise<boolean> => attendeeService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id);

  app.get('/meetings/:id/attendees', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    return { data: await attendeeService.listAttendees(id) };
  });

  app.post('/meetings/:id/attendees', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const body = addSchema.parse(req.body);
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
    return { data: await attendeeService.suggestAttendees(id, previous) };
  });

  app.patch('/meetings/:id/attendees/:attendeeId', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id, attendeeId } = req.params as { id: string; attendeeId: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    const body = patchSchema.parse(req.body);
    if (!(await canEdit(req, id))) {
      // Attendees may record their own attendance; everything else is the organizer's call.
      const own = await attendeeService.getAttendee(id, attendeeId);
      const attendanceOnly = body.role === undefined && body.department === undefined;
      if (!attendanceOnly || own.userId !== req.user!.id) return reply.status(403).send(cannotEdit);
    }
    let rec = null;
    if (body.attendance !== undefined) rec = await attendeeService.setAttendance(id, attendeeId, body.attendance);
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
