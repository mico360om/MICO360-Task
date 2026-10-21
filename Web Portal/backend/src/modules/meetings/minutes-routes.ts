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
import { readProjectPicture } from '../../lib/pdf-image';
import { shownMeetingStatus } from './meeting-end';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { draftFromNotes, minutesFacts, normalizeFinalMinutes, type FinalMinutesContent } from './final-minutes';
import type { FinalMinutesRecord, FinalMinutesRepository } from './final-minutes-repository';

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
  /** The project's own number (e.g. the client's job number). */
  number?: string | null;
  /** Its colour (hex), for the icon or initials tile when there is no printable picture. */
  color?: string | null;
  /** Its icon (one of PROJECT_ICONS), drawn when it has no picture. */
  icon?: string | null;
  /** Where its picture is stored ('/uploads/…'), read with readProjectImage. */
  imageUrl?: string | null;
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
  /** The bytes of a project's stored picture, for the minutes header (null or a failure: the icon or initials are printed). */
  readProjectImage?: (imageUrl: string) => Promise<Buffer | null>;
  /** Converts a stored picture the PDF can't take as it is (WebP, GIF, some PNGs) into one it can. */
  printableProjectImage?: (raw: Buffer) => Promise<Buffer | null>;
  /** Board keys of linked tasks (id → key), printed beside their action items. */
  resolveTaskKeys?: (taskIds: string[]) => Promise<Record<string, string>>;
  /** Where the final minutes (Final MOM) are kept; enables the /meetings/:id/final-minutes routes. */
  finalMinutes?: FinalMinutesRepository;
  /** Asks the AI for a draft of the final minutes from the meeting's facts (the person's AI limits apply). */
  draftMinutesWithAi?: (facts: string, requester: { userId: string; roles?: string[] }) => Promise<unknown>;
  /** Email distribution of the minutes PDF (enables POST /meetings/:id/minutes/send). */
  notify?: {
    sendMinutes: (meetingId: string, pdf: Buffer, opts?: { only?: string[]; final?: boolean }) => Promise<{ sent: number; failed?: number }>;
    /** The minutes email as it would be sent, and to whom (enables GET /meetings/:id/minutes/preview). */
    previewMinutes?: (meetingId: string, opts?: { final?: boolean }) => Promise<unknown>;
  };
}

/** Who gets the minutes: some of the meeting's own people (by email); omitted = everyone. */
const sendBody = z.object({ recipients: z.array(z.string().trim().email()).min(1).max(500).optional() });

export async function registerMinutesRoutes(app: FastifyInstance, deps: MinutesRouteDeps): Promise<void> {
  const { meetingService, attendeeService, agendaService, noteService, guard } = deps;
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);

  /** Assemble the minutes data of a meeting the caller may view (`alsoName`: more people to name). */
  async function gather(
    req: FastifyRequest,
    id: string,
    alsoName: string[] = [],
  ): Promise<{ data: MinutesData; title: string; nameOf: (uid: string | null) => string | null }> {
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
    for (const u of alsoName) ids.add(u);
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
    // A picture in a format the PDF can't embed as stored is converted, so the logo still prints.
    const projectImage = await readProjectPicture(projectSrc?.imageUrl, deps.readProjectImage, deps.printableProjectImage);
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
            number: projectSrc.number ?? null,
            color: projectSrc.color ?? null,
            image: projectImage,
            icon: projectSrc.icon ?? null,
            clientName: projectSrc.clientName,
            statusLabel: PROJECT_STATUS_LABELS[projectSrc.status] ?? projectSrc.status,
            ownerName: nameOf(projectSrc.ownerId),
            startDate: projectSrc.startDate,
            targetDate: projectSrc.targetDate,
          }
        : null,
      meeting: {
        title: meeting.title,
        statusLabel: STATUS_LABELS[shownMeetingStatus(meeting, new Date())] ?? meeting.status,
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
        format: n.bodyFormat ?? 'PLAIN',
        authorName: nameOf(n.authorId) ?? 'Someone',
        createdAt: n.createdAt.toISOString(),
        highlighted: n.highlighted,
        trackedAsActionItem: n.type === 'ACTION' && (trackedNotes.has(n.id) || Boolean(n.actionItemId)),
        agendaTitle: n.agendaItemId ? (agenda.find((g) => g.id === n.agendaItemId)?.title ?? null) : null,
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

    return { data, title: meeting.title, nameOf };
  }

  /** The final minutes as stored, when this server keeps them. */
  const finalOf = async (id: string): Promise<FinalMinutesRecord | null> => (deps.finalMinutes ? deps.finalMinutes.get(id) : null);

  /**
   * The minutes PDF — one document. With approved final minutes (the Final MOM) it opens with them,
   * marked final; a Final MOM still being written goes only into an editor's own copy, marked as a
   * draft (`withDraft`), never to anyone else or into an email.
   */
  async function buildPdf(req: FastifyRequest, id: string, opts: { withDraft?: boolean } = {}): Promise<{ pdf: Buffer; title: string; final: boolean }> {
    const rec = await finalOf(id);
    const approved = rec?.status === 'APPROVED';
    const shown = approved || (rec && opts.withDraft) ? rec : null;
    const { data, title, nameOf } = await gather(req, id, shown?.approvedById ? [shown.approvedById] : []);
    const final = shown
      ? {
          content: shown.content,
          status: approved ? ('FINAL' as const) : ('DRAFT' as const),
          approvedByName: approved ? nameOf(shown.approvedById) : null,
          approvedAt: approved && shown.approvedAt ? shown.approvedAt.toISOString() : null,
        }
      : null;
    return { pdf: buildMinutesPdf({ ...data, final }), title, final: approved };
  }

  // ?version=final (older links) gets the same document: the final minutes are in it once approved.
  app.get('/meetings/:id/minutes.pdf', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    const editor = await meetingService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id);
    const { pdf, title, final } = await buildPdf(req, id, { withDraft: editor });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="minutes-${final ? 'final-' : ''}${slugify(title)}.pdf"`)
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
    // Once the minutes are final they open the PDF; a Final MOM still being written never goes out.
    const { pdf, final } = await buildPdf(req, id);
    const opts = { ...(body.recipients ? { only: body.recipients } : {}), ...(final ? { final: true } : {}) };
    const result = Object.keys(opts).length ? await deps.notify.sendMinutes(id, pdf, opts) : await deps.notify.sendMinutes(id, pdf);
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
    const final = (await finalOf(id))?.status === 'APPROVED';
    return { data: await deps.notify.previewMinutes(id, final ? { final: true } : undefined) };
  });

  // ── Final minutes (Final MOM): drafted (by the AI or from the notes), edited, then marked final ──
  if (deps.finalMinutes) {
    const store = deps.finalMinutes;
    const canEdit = (req: FastifyRequest, id: string) => meetingService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id);
    const forbidden = { error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can write the final minutes.' } };
    const hasContent = (c: FinalMinutesContent) => Boolean(c.summary || c.discussion.length || c.decisions.length || c.risks.length || c.nextSteps.length);

    /** What a person sees: editors see a draft too; everyone else sees the minutes only once they are final. */
    const view = async (rec: FinalMinutesRecord | null, editor: boolean) => {
      const shown = rec && (editor || rec.status === 'APPROVED') ? rec : null;
      const approver = shown?.approvedById ?? null;
      const approverName = approver ? ((await deps.resolveUserNames([approver])).get(approver) ?? null) : null;
      return {
        status: !shown ? 'NONE' : shown.status === 'APPROVED' ? 'FINAL' : 'DRAFT',
        content: shown?.content ?? null,
        savedAt: shown ? shown.savedAt.toISOString() : null,
        approvedBy: approver ? { id: approver, name: approverName } : null,
        approvedAt: shown?.approvedAt ? shown.approvedAt.toISOString() : null,
        canEdit: editor,
      };
    };

    app.get('/meetings/:id/final-minutes', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      if (!(await canView(req, id))) return reply.status(404).send(notFound);
      return { data: await view(await store.get(id), await canEdit(req, id)) };
    });

    // A first draft for the organizer to edit: written by the AI from the meeting's facts, or from the notes.
    // It isn't kept until it is saved.
    const draftBody = z.object({ source: z.enum(['ai', 'notes']) });
    app.post('/meetings/:id/final-minutes/draft', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      if (!(await canView(req, id))) return reply.status(404).send(notFound);
      if (!(await canEdit(req, id))) return reply.status(403).send(forbidden);
      const { source } = draftBody.parse(req.body ?? {});
      const { data } = await gather(req, id);
      if (source === 'notes') return { data: { content: draftFromNotes(data), source } };
      if (!deps.draftMinutesWithAi) throw new ValidationError('AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.');
      const raw = await deps.draftMinutesWithAi(minutesFacts(data), { userId: req.user!.id, roles: req.user!.roles ?? [] });
      return { data: { content: normalizeFinalMinutes(raw), source } };
    });

    const contentBody = z.object({ content: z.unknown() });
    app.put('/meetings/:id/final-minutes', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      if (!(await canView(req, id))) return reply.status(404).send(notFound);
      if (!(await canEdit(req, id))) return reply.status(403).send(forbidden);
      const content = normalizeFinalMinutes(contentBody.parse(req.body ?? {}).content);
      if ((await store.get(id))?.status === 'APPROVED') {
        throw new ConflictError('These minutes are final. Reopen them to make changes.', 'FINAL_MINUTES_LOCKED');
      }
      const saved = await store.save(id, { content, status: 'DRAFT', approvedById: null, approvedAt: null });
      return { data: await view(saved, true) };
    });

    // Mark the minutes final: the content sent along (what is on screen), else what was saved.
    const approveBody = z.object({ content: z.unknown().optional() });
    app.post('/meetings/:id/final-minutes/approve', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      if (!(await canView(req, id))) return reply.status(404).send(notFound);
      if (!(await canEdit(req, id))) return reply.status(403).send(forbidden);
      const body = approveBody.parse(req.body ?? {});
      const content = body.content !== undefined ? normalizeFinalMinutes(body.content) : (await store.get(id))?.content;
      if (!content || !hasContent(content)) throw new ValidationError('Write the final minutes before marking them final.');
      const saved = await store.save(id, { content, status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() });
      return { data: await view(saved, true) };
    });

    app.post('/meetings/:id/final-minutes/reopen', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      if (!(await canView(req, id))) return reply.status(404).send(notFound);
      if (!(await canEdit(req, id))) return reply.status(403).send(forbidden);
      const current = await store.get(id);
      if (!current) throw new NotFoundError('There are no final minutes to reopen.');
      const saved = await store.save(id, { content: current.content, status: 'DRAFT', approvedById: null, approvedAt: null });
      return { data: await view(saved, true) };
    });
  }
}
