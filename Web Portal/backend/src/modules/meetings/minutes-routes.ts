import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MeetingService } from './meeting-service';
import type { AttendeeService } from './attendee-service';
import type { AgendaService } from './agenda-service';
import type { NoteService } from './note-service';
import type { AuthGuard } from '../auth/auth-guard';
import { buildMinutesPdf, type MinutesData } from './minutes';
import { resolveBrand } from '../email/brand';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
const ATTENDANCE_LABELS: Record<string, string> = {
  INVITED: 'Invited', PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused',
};
const ROLE_LABELS: Record<string, string> = { REQUIRED: 'Required', OPTIONAL: 'Optional' };
const NOTE_TYPE_LABELS: Record<string, string> = {
  DISCUSSION: 'Discussion', DECISION: 'Decision', ACTION: 'Action Item', ISSUE: 'Issue', QUESTION: 'Question', INFORMATION: 'Information',
};
const PROJECT_STATUS_LABELS: Record<string, string> = {
  PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On Hold', COMPLETED: 'Completed', ARCHIVED: 'Archived',
};

/** Rich project details for the minutes header (a superset of just the name). */
export interface MinutesProjectSource {
  name: string;
  code: string | null;
  clientName: string | null;
  status: string;
  ownerId: string | null;
  startDate: string | null; // ISO
  targetDate: string | null; // ISO
}

function slugify(title: string): string {
  const s = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || 'meeting';
}

export interface MinutesRouteDeps {
  meetingService: MeetingService;
  attendeeService: AttendeeService;
  agendaService: AgendaService;
  noteService: NoteService;
  guard: AuthGuard;
  /** Object-level view authorization on the meeting. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** Resolve a set of user ids to display names (best-effort; missing ids omitted). */
  resolveUserNames: (ids: string[]) => Promise<Map<string, string>>;
  /** Resolve a project id to its details for the header (null when unknown/standalone). */
  resolveProject?: (projectId: string) => Promise<MinutesProjectSource | null>;
  /** Email distribution of the minutes PDF (enables POST /meetings/:id/minutes/send). */
  notify?: { sendMinutes: (meetingId: string, pdf: Buffer) => Promise<{ sent: number }> };
}

export async function registerMinutesRoutes(app: FastifyInstance, deps: MinutesRouteDeps): Promise<void> {
  const { meetingService, attendeeService, agendaService, noteService, guard } = deps;
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);

  /** Assemble the minutes data and render the branded PDF for a meeting the caller may view. */
  async function buildPdf(req: FastifyRequest, id: string): Promise<{ pdf: Buffer; title: string }> {
    const meeting = await meetingService.getMeeting(id);
    const [attendees, agenda, notes, projectSrc] = await Promise.all([
      attendeeService.listAttendees(id),
      agendaService.listAgenda(id),
      noteService.listNotes(id),
      meeting.projectId && deps.resolveProject ? deps.resolveProject(meeting.projectId) : Promise.resolve(null),
    ]);

    const ids = new Set<string>();
    ids.add(meeting.organizerId);
    ids.add(req.user!.id);
    if (projectSrc?.ownerId) ids.add(projectSrc.ownerId);
    for (const a of attendees) if (a.userId) ids.add(a.userId);
    for (const g of agenda) if (g.ownerId) ids.add(g.ownerId);
    for (const n of notes) ids.add(n.authorId);
    const names = await deps.resolveUserNames([...ids]);
    const nameOf = (uid: string | null): string | null => (uid ? names.get(uid) ?? null : null);

    const b = resolveBrand();

    const data: MinutesData = {
      brand: {
        productName: b.productName,
        companyName: b.companyName,
        tagline: b.tagline,
        websiteUrl: b.websiteUrl,
        supportEmail: b.supportEmail,
        companyAddress: b.companyAddress,
        colors: { brand: b.colors.brand, brand2: b.colors.brand2, ink: b.colors.ink, muted: b.colors.ink2, line: b.colors.line },
      },
      project: projectSrc
        ? {
            name: projectSrc.name,
            code: projectSrc.code,
            clientName: projectSrc.clientName,
            statusLabel: PROJECT_STATUS_LABELS[projectSrc.status] ?? projectSrc.status,
            ownerName: nameOf(projectSrc.ownerId),
            startDate: projectSrc.startDate,
            targetDate: projectSrc.targetDate,
          }
        : null,
      meeting: {
        title: meeting.title,
        statusLabel: STATUS_LABELS[meeting.status] ?? meeting.status,
        organizerName: nameOf(meeting.organizerId),
        location: meeting.location,
        onlineLink: meeting.onlineLink,
        startAt: meeting.startAt.toISOString(),
        endAt: meeting.endAt ? meeting.endAt.toISOString() : null,
        timeZone: meeting.timeZone,
        description: meeting.description,
      },
      attendees: attendees.map((a) => ({
        name: a.userId ? nameOf(a.userId) ?? 'Unknown member' : a.externalName ?? 'Guest',
        roleLabel: ROLE_LABELS[a.role] ?? a.role,
        attendanceLabel: ATTENDANCE_LABELS[a.attendance] ?? a.attendance,
        external: !a.userId,
        email: a.externalEmail,
      })),
      agenda: agenda.map((g) => ({
        title: g.title,
        presenterName: nameOf(g.ownerId),
        expectedMinutes: g.expectedMinutes,
        completed: g.completed,
      })),
      notes: notes.map((n) => ({
        type: n.type,
        typeLabel: NOTE_TYPE_LABELS[n.type] ?? n.type,
        body: n.body,
        authorName: nameOf(n.authorId) ?? 'Someone',
        createdAt: n.createdAt.toISOString(),
        highlighted: n.highlighted,
      })),
      generatedAt: new Date().toISOString(),
      generatedByName: nameOf(req.user!.id),
    };

    return { pdf: buildMinutesPdf(data), title: meeting.title };
  }

  app.get('/meetings/:id/minutes.pdf', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    const { pdf, title } = await buildPdf(req, id);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="minutes-${slugify(title)}.pdf"`)
      .send(pdf);
  });

  // Email the branded minutes PDF to the organizer + attendees.
  app.post('/meetings/:id/minutes/send', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } });
    if (!deps.notify) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    const { pdf } = await buildPdf(req, id);
    const result = await deps.notify.sendMinutes(id, pdf);
    return { data: result };
  });
}
