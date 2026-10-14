import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MeetingService } from './meeting-service';
import type { AttendeeService } from './attendee-service';
import type { AgendaService } from './agenda-service';
import type { ActionItemService } from './action-item-service';
import type { NoteService } from './note-service';
import type { AuthGuard } from '../auth/auth-guard';
import { buildMinutesPdf, resolveMinutesTimeZone, type MinutesData } from './minutes';
import { resolveBrand } from '../email/brand';
import { dueDayKey } from '../../lib/due-date';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
// INVITED is the attendance before anyone records it — not the invitation (that is the response).
const ATTENDANCE_LABELS: Record<string, string> = {
  INVITED: 'Not recorded', PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', EXCUSED: 'Excused',
};
const RESPONSE_LABELS: Record<string, string> = { PENDING: 'No response', ACCEPTED: 'Accepted', TENTATIVE: 'Maybe', DECLINED: 'Declined' };
const ROLE_LABELS: Record<string, string> = { REQUIRED: 'Required', OPTIONAL: 'Optional' };
const NOTE_TYPE_LABELS: Record<string, string> = {
  DISCUSSION: 'Discussion', DECISION: 'Decision', ACTION: 'Action Item', ISSUE: 'Issue', QUESTION: 'Question', INFORMATION: 'Information',
};
const ACTION_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open', IN_PROGRESS: 'In progress', PENDING: 'Pending', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
const PRIORITY_LABELS: Record<string, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
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
  /** The meeting's tracked action items, listed in the minutes (omitted when the module is not wired). */
  actionItemService?: Pick<ActionItemService, 'listByMeeting'>;
  guard: AuthGuard;
  /** Object-level view authorization on the meeting. */
  canViewMeeting?: (userId: string, roles: string[], meetingId: string) => Promise<boolean>;
  /** Resolve a set of user ids to display names (best-effort; missing ids omitted). */
  resolveUserNames: (ids: string[]) => Promise<Map<string, string>>;
  /** Resolve a project id to its details for the header (null when unknown/standalone). */
  resolveProject?: (projectId: string) => Promise<MinutesProjectSource | null>;
  /** Board keys of linked tasks (id → key), printed beside their action items. */
  resolveTaskKeys?: (taskIds: string[]) => Promise<Record<string, string>>;
  /** Email distribution of the minutes PDF (enables POST /meetings/:id/minutes/send). */
  notify?: {
    sendMinutes: (meetingId: string, pdf: Buffer, opts?: { only?: string[] }) => Promise<{ sent: number; failed?: number }>;
    /** The minutes email as it would be sent, and to whom (enables GET /meetings/:id/minutes/preview). */
    previewMinutes?: (meetingId: string) => Promise<unknown>;
  };
}

/** Who gets the minutes: some of the meeting's own people (by email); omitted = everyone. */
const sendBody = z.object({ recipients: z.array(z.string().trim().email()).min(1).max(500).optional() });

export async function registerMinutesRoutes(app: FastifyInstance, deps: MinutesRouteDeps): Promise<void> {
  const { meetingService, attendeeService, agendaService, noteService, guard } = deps;
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);

  /** Assemble the minutes data and render the branded PDF for a meeting the caller may view. */
  async function buildPdf(req: FastifyRequest, id: string): Promise<{ pdf: Buffer; title: string }> {
    const meeting = await meetingService.getMeeting(id);
    const [attendees, agenda, notes, projectSrc, actionItems] = await Promise.all([
      attendeeService.listAttendees(id),
      agendaService.listAgenda(id),
      noteService.listNotes(id),
      meeting.projectId && deps.resolveProject ? deps.resolveProject(meeting.projectId) : Promise.resolve(null),
      deps.actionItemService ? deps.actionItemService.listByMeeting(id) : Promise.resolve([]),
    ]);

    const ids = new Set<string>();
    ids.add(meeting.organizerId);
    ids.add(req.user!.id);
    if (projectSrc?.ownerId) ids.add(projectSrc.ownerId);
    for (const a of attendees) if (a.userId) ids.add(a.userId);
    for (const g of agenda) if (g.ownerId) ids.add(g.ownerId);
    for (const n of notes) ids.add(n.authorId);
    for (const a of actionItems) if (a.assigneeId) ids.add(a.assigneeId);
    const taskIds = [...new Set(actionItems.map((a) => a.taskId).filter((t): t is string => Boolean(t)))];
    const [names, taskKeys] = await Promise.all([
      deps.resolveUserNames([...ids]),
      taskIds.length && deps.resolveTaskKeys ? deps.resolveTaskKeys(taskIds) : Promise.resolve({} as Record<string, string>),
    ]);
    const trackedNotes = new Set(actionItems.map((a) => a.sourceNoteId).filter(Boolean));
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
        responseLabel: RESPONSE_LABELS[a.response] ?? 'No response',
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
        trackedAsActionItem: n.type === 'ACTION' && (trackedNotes.has(n.id) || Boolean(n.actionItemId)),
      })),
      actionItems: actionItems.map((a) => ({
        description: a.description,
        ownerName: nameOf(a.assigneeId),
        // The same day rule as everywhere else: a pure date stays as it is, an instant is read in the meeting's zone.
        dueDate: dueDayKey(a.dueDate, resolveMinutesTimeZone(meeting.timeZone)),
        statusLabel: ACTION_STATUS_LABELS[a.status] ?? a.status,
        priorityLabel: PRIORITY_LABELS[a.priority] ?? a.priority,
        taskKey: (a.taskId && taskKeys[a.taskId]) || null,
        open: a.status !== 'COMPLETED' && a.status !== 'CANCELLED',
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
    // Emailing everyone is the organizer's call, not any attendee's.
    if (!(await meetingService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can send the minutes.' } });
    }
    if (!deps.notify) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    const body = sendBody.parse(req.body ?? {});
    const { pdf } = await buildPdf(req, id);
    const result = body.recipients ? await deps.notify.sendMinutes(id, pdf, { only: body.recipients }) : await deps.notify.sendMinutes(id, pdf);
    return { data: result };
  });

  // The minutes email exactly as it would be sent, and to whom (sends nothing).
  app.get('/meetings/:id/minutes/preview', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } });
    if (!(await meetingService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can send the minutes.' } });
    }
    if (!deps.notify?.previewMinutes) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    return { data: await deps.notify.previewMinutes(id) };
  });
}
