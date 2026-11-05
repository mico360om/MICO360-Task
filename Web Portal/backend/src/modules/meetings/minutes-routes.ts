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
import type { PdfBrand } from '../companies/company-branding';
import type { AuditService } from '../audit/audit-service';
import { MAX_MINUTES_ADDRESSES, type MinutesCopy, type MinutesSendOptions, type RecipientResult } from './meeting-notify-service';
import type { MinutesSendAddress, MinutesSendRepository } from './minutes-send-repository';
import type { InviteTarget, MeetingInvitees } from './meeting-invitees';
import type { FinalMinutesAi } from './final-minutes-ai';
import { isClientRoles } from '../clients/client-kind';
import type { MeetingRecord } from './meeting-repository';
import type { MinutesSeries as SeriesFacts } from './named-series-service';

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
  /**
   * 1.22 (§10): "Draft with AI" as background work — answered at once, saved as the draft (or offered
   * beside the minutes) when it's ready, the requester told. Without it, the request waits for the AI.
   */
  finalMinutesAi?: FinalMinutesAi;
  /**
   * The final minutes were saved, approved or reopened: the meeting's live event, so the people on it
   * (and the lists showing how far its minutes are) see the change without reloading.
   */
  onFinalMinutesChanged?: (meetingId: string) => void;
  /**
   * companies: how a person sees the meeting. An invitee from another company gets the final minutes
   * and the minutes PDF once approved (404 before), the PDF without the live notes or other people's
   * action items; everything else here is the team's.
   */
  viewOf?: (userId: string, roles: string[], meetingId: string) => Promise<'full' | 'invitee' | null>;
  /** companies: a person's current roles — the minutes email asks viewOf for each of the meeting's users. */
  rolesOf?: (userId: string) => Promise<string[]>;
  /** Companies: the meeting's company brand on its minutes PDF — its name (2+ companies) and logo; absent: the site's. */
  pdfBrand?: (meetingId: string) => Promise<PdfBrand>;
  /** Email distribution of the minutes PDF (enables POST /meetings/:id/minutes/send). */
  notify?: {
    sendMinutes: (meetingId: string, pdf: Buffer, opts?: MinutesSendOptions) => Promise<{ sent: number; failed?: number; recipients?: RecipientResult[] }>;
    /** The minutes email as it would be sent, and to whom (enables GET /meetings/:id/minutes/preview). */
    previewMinutes?: (meetingId: string, opts?: { final?: boolean; copyOf?: (userId: string) => Promise<MinutesCopy> }) => Promise<unknown>;
  };
  /** Where each send of the minutes is kept: the meeting's "Sent" log (GET …/minutes/sends) and the Cc suggestions. */
  minutesSends?: MinutesSendRepository;
  /** The audit log: each send of the minutes is recorded. */
  audit?: Pick<AuditService, 'record'>;
  /**
   * companies: how someone the minutes go to would see the meeting if they were on it (an added
   * colleague or a typed address that is someone's account too); absent: `viewOf`.
   */
  recipientViewOf?: (userId: string, roles: string[], meetingId: string) => Promise<'full' | 'invitee' | null>;
  /** A colleague picked by name must be one the invite picker offers (the meeting's own people always are). */
  invitees?: Pick<MeetingInvitees, 'assertInvitable'>;
  /**
   * 1.22 review: do they share a company (companies' isColleague; admins always)? A typed address that
   * is the account of someone the sender doesn't share one with is shown and kept as the address only.
   */
  isColleague?: (viewer: { id: string; roles: string[] }, otherId: string) => Promise<boolean>;
  inviteTargetOf?: (meetingId: string) => Promise<InviteTarget | null>;
  /**
   * 1.23 Client accounts: a client attendee (or typed address that is a client's) never gets the team's
   * minutes. `mayHave`: an active client with the Meetings module on the meeting's project, and its
   * approved minutes are shown to clients there; then `pdf` is their client copy, in an email of its
   * own. Otherwise they get nothing.
   */
  clientMinutes?: { mayHave(meetingId: string, userId: string): Promise<boolean>; pdf(meetingId: string, userId: string): Promise<Buffer | null> };
  /**
   * 1.23 Meeting series: the meeting's series and the open action items of its earlier meetings, as
   * `who` sees them (`ownOnly`: an invitee's own copy — only their own items). Absent: no series facts.
   */
  seriesFacts?: (meeting: MeetingRecord, who: { userId: string; ownOnly?: boolean; alsoVisibleTo?: string }) => Promise<SeriesFacts | null>;
}

/**
 * Whose view of the series' earlier meetings the minutes carry: the reader's (the default), the
 * organizer's (the AI's Final MOM draft — the organizer reviews its text), or someone's own items only.
 */
export type MinutesSeriesFor = 'organizer' | { userId: string; ownOnly?: boolean };

/** Someone the minutes go to: a colleague picked by name, or an email address (checked as one). */
const addressee = z.union([z.object({ userId: z.string().trim().min(1).max(64) }).strict(), z.object({ email: z.string().trim().email().max(254) }).strict()]);
/**
 * Who gets the minutes: the To and Cc lines (at most 50 addresses; the meeting's people by email);
 * older apps: some of the meeting's own people (`recipients`, by email); nothing = everyone on it.
 */
const sendBody = z
  .object({
    recipients: z.array(z.string().trim().email()).min(1).max(500).optional(),
    to: z.array(addressee).min(1).max(MAX_MINUTES_ADDRESSES).optional(),
    cc: z.array(addressee).max(MAX_MINUTES_ADDRESSES).optional(),
  })
  .refine((b) => !b.cc || b.to, { message: 'Add at least one person to To.', path: ['to'] });

/**
 * What a meeting's minutes are made of — the meeting, its people, agenda, notes and action items,
 * named — as the minutes PDF and the final minutes' AI draft read it. Callers check first that the
 * person may see the meeting. (MICO AI drafts final minutes from the same facts.)
 */
export function createMinutesData(
  deps: Pick<MinutesRouteDeps, 'meetingService' | 'attendeeService' | 'agendaService' | 'noteService' | 'actionItemService' | 'resolveUserNames' | 'resolveProject' | 'readProjectImage' | 'printableProjectImage' | 'resolveTaskKeys' | 'seriesFacts'>,
) {
  const { meetingService, attendeeService, agendaService, noteService } = deps;
  /** The minutes data of a meeting, for the person `viewerId` (`alsoName`: more people to name; `seriesFor`: whose carry-over). */
  return async function gather(
    viewerId: string,
    id: string,
    alsoName: string[] = [],
    opts: { seriesFor?: MinutesSeriesFor } = {},
  ): Promise<{ data: MinutesData; title: string; nameOf: (uid: string | null) => string | null }> {
    const meeting = await meetingService.getMeeting(id);
    // The organizer's view for the AI's draft — kept to what the person asking may see too, as they read it.
    const seriesWho = opts.seriesFor === 'organizer' ? { userId: meeting.organizerId, alsoVisibleTo: viewerId } : (opts.seriesFor ?? { userId: viewerId });
    const [attendees, agenda, notes, projectSrc, actionItems, series] = await Promise.all([
      attendeeService.listAttendees(id),
      agendaService.listAgenda(id),
      noteService.listNotes(id),
      meeting.projectId && deps.resolveProject ? deps.resolveProject(meeting.projectId) : Promise.resolve(null),
      deps.actionItemService ? deps.actionItemService.listByMeeting(id) : Promise.resolve([]),
      deps.seriesFacts ? deps.seriesFacts(meeting, seriesWho) : Promise.resolve(null),
    ]);

    const ids = new Set<string>();
    ids.add(meeting.organizerId);
    ids.add(viewerId);
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
      generatedByName: nameOf(viewerId),
      series: series
        ? {
            name: series.name,
            openFromEarlier: series.openFromEarlier.map((a) => ({
              description: a.description,
              ownerName: a.assigneeName,
              dueDate: dueDayKey(a.dueDate, resolveMinutesTimeZone(meeting.timeZone)),
              statusLabel: ACTION_STATUS_LABELS[a.status] ?? a.status,
              priorityLabel: PRIORITY_LABELS[a.priority] ?? a.priority,
              taskKey: a.taskKey,
              open: true,
              meetingStartAt: a.meeting.startAt.toISOString(),
            })),
          }
        : null,
    };

    return { data, title: meeting.title, nameOf };
  };
}

export async function registerMinutesRoutes(app: FastifyInstance, deps: MinutesRouteDeps): Promise<void> {
  const { meetingService, guard } = deps;
  const notFound = { error: { code: 'NOT_FOUND', message: 'Meeting not found.' } };
  const canView = (req: FastifyRequest, id: string): Promise<boolean> =>
    deps.canViewMeeting ? deps.canViewMeeting(req.user!.id, req.user!.roles ?? [], id) : Promise.resolve(true);

  /** Assemble the minutes data of a meeting the caller may view (`alsoName`: more people to name). */
  const gatherFor = createMinutesData(deps);
  const gather = (req: FastifyRequest, id: string, alsoName: string[] = [], opts: { seriesFor?: MinutesSeriesFor } = {}) => gatherFor(req.user!.id, id, alsoName, opts);
  /**
   * companies: an invitee's minutes — no live notes, only their own action items, no project tasks.
   * `forUserId`: whose copy (the person asking, or a recipient of the minutes email).
   */
  const gatherForInvitee = (req: FastifyRequest, id: string, alsoName: string[] = [], forUserId: string = req.user!.id) =>
    createMinutesData({
      ...deps,
      noteService: { ...deps.noteService, listNotes: async () => [] },
      actionItemService: deps.actionItemService && {
        listByMeeting: async (mid: string) => (await deps.actionItemService!.listByMeeting(mid)).filter((a) => a.assigneeId === forUserId).map((a) => ({ ...a, taskId: null })),
      },
      // 1.23: "Open from earlier meetings" in their copy: only their own items.
    })(req.user!.id, id, alsoName, { seriesFor: { userId: forUserId, ownOnly: true } });
  const viewOf = async (req: FastifyRequest, id: string) =>
    deps.viewOf ? deps.viewOf(req.user!.id, req.user!.roles ?? [], id) : (await canView(req, id)) ? ('full' as const) : null;

  /** The final minutes as stored, when this server keeps them. */
  const finalOf = async (id: string): Promise<FinalMinutesRecord | null> => (deps.finalMinutes ? deps.finalMinutes.get(id) : null);

  /**
   * The minutes PDF — one document. With approved final minutes (the Final MOM) it opens with them,
   * marked final; a Final MOM still being written goes only into an editor's own copy, marked as a
   * draft (`withDraft`), never to anyone else or into an email.
   */
  async function buildPdf(req: FastifyRequest, id: string, opts: { withDraft?: boolean; invitee?: boolean; inviteeId?: string } = {}): Promise<{ pdf: Buffer; title: string; final: boolean }> {
    const rec = await finalOf(id);
    const approved = rec?.status === 'APPROVED';
    const shown = approved || (rec && opts.withDraft) ? rec : null;
    const alsoName = shown?.approvedById ? [shown.approvedById] : [];
    const { data, title, nameOf } = await (opts.invitee ? gatherForInvitee(req, id, alsoName, opts.inviteeId ?? req.user!.id) : gather(req, id, alsoName));
    const final = shown
      ? {
          content: shown.content,
          status: approved ? ('FINAL' as const) : ('DRAFT' as const),
          approvedByName: approved ? nameOf(shown.approvedById) : null,
          approvedAt: approved && shown.approvedAt ? shown.approvedAt.toISOString() : null,
        }
      : null;
    // Companies: the meeting's company name in the footer (2+ companies) and its logo in the header.
    const company = deps.pdfBrand ? await deps.pdfBrand(id).catch(() => null) : null;
    const branded = company?.companyName ? { ...data, brand: { ...data.brand, companyName: company.companyName } } : data;
    return { pdf: buildMinutesPdf({ ...branded, final, ...(company?.logo ? { logo: company.logo } : {}) }), title, final: approved };
  }

  // ?version=final (older links) gets the same document: the final minutes are in it once approved.
  app.get('/meetings/:id/minutes.pdf', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const view = await viewOf(req, id);
    if (!view) return reply.status(404).send(notFound);
    // companies: an invitee from another company gets the minutes once they are final.
    if (view === 'invitee' && (await finalOf(id))?.status !== 'APPROVED') return reply.status(404).send(notFound);
    const editor = view === 'full' && (await meetingService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id));
    const { pdf, title, final } = await buildPdf(req, id, { withDraft: editor, invitee: view === 'invitee' });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="minutes-${final ? 'final-' : ''}${slugify(title)}.pdf"`)
      .send(pdf);
  });

  /**
   * The minutes email and its pages (the preview, the "Sent" log, the Cc suggestions) are for the
   * people who may send: emailing everyone is the organizer's call (or the project manager's, an
   * admin's), not any attendee's.
   */
  const mayOpen = async (req: FastifyRequest, reply: FastifyReply, id: string): Promise<boolean> => {
    if (!(await canView(req, id))) {
      await reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You do not have access to this meeting.' } });
      return false;
    }
    if (!(await meetingService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id))) {
      await reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can send the minutes.' } });
      return false;
    }
    return true;
  };

  // Email the branded minutes PDF: ONE email to its To and Cc lines (the organizer and attendees by default).
  app.post('/meetings/:id/minutes/send', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!(await mayOpen(req, reply, id))) return reply;
    if (!deps.notify) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    const body = sendBody.parse(req.body ?? {});
    // A colleague picked by name is one the invite picker offers (as for inviting); the meeting's own
    // people always may be. Addresses are the sender's to type.
    const picked = [...(body.to ?? []), ...(body.cc ?? [])].flatMap((a) => ('userId' in a ? [a.userId] : []));
    if (picked.length && deps.invitees && deps.inviteTargetOf) {
      const meeting = await meetingService.getMeeting(id);
      const own = new Set([meeting.organizerId, ...(await deps.attendeeService.listAttendees(id)).flatMap((a) => (a.userId ? [a.userId] : []))]);
      const others = [...new Set(picked.filter((u) => !own.has(u)))];
      const target = others.length ? await deps.inviteTargetOf(id) : null;
      if (target) await deps.invitees.assertInvitable({ id: req.user!.id, roles: req.user!.roles ?? [] }, target, others);
    }
    // Once the minutes are final they open the PDF; a Final MOM still being written never goes out.
    const { pdf, final } = await buildPdf(req, id);
    const copyOf = copyRule(id, final);
    // companies: someone from another company gets what the minutes route serves them — their own copy
    // (no live notes, no one else's action items, no task keys), and only once the minutes are final;
    // nothing before. The team (and guests by email) get the shared PDF, as before.
    const attachmentFor = copyOf
      ? async (userId: string): Promise<Buffer | null | undefined> => {
          const copy = await copyOf(userId);
          if (copy === 'shared') return undefined;
          if (copy !== 'own') return null;
          // 1.23: a client's own copy is the client copy of the shown minutes (never the team's PDF).
          if (deps.rolesOf && isClientRoles(await deps.rolesOf(userId))) return deps.clientMinutes ? deps.clientMinutes.pdf(id, userId) : null;
          return (await buildPdf(req, id, { invitee: true, inviteeId: userId })).pdf;
        }
      : undefined;
    const opts: MinutesSendOptions = {
      ...(body.to ? { to: body.to, cc: body.cc ?? [] } : body.recipients ? { only: body.recipients } : {}),
      ...(final ? { final: true } : {}),
      ...(attachmentFor ? { attachmentFor } : {}),
      ...(deps.isColleague ? { mayName: (userId: string) => deps.isColleague!({ id: req.user!.id, roles: req.user!.roles ?? [] }, userId) } : {}),
    };
    const result = Object.keys(opts).length ? await deps.notify.sendMinutes(id, pdf, opts) : await deps.notify.sendMinutes(id, pdf);
    await keepSend(req, id, final, result);
    return { data: result };
  });

  /**
   * Which copy of the minutes someone gets (companies): the shared email ('full' view), their own
   * once the minutes are final (another company), or nothing. Without companies: everyone the shared one.
   */
  function copyRule(meetingId: string, final: boolean): ((userId: string) => Promise<MinutesCopy>) | undefined {
    const viewOfMeeting = deps.recipientViewOf ?? deps.viewOf;
    if (!viewOfMeeting && !deps.rolesOf) return undefined;
    return async (userId) => {
      const roles = deps.rolesOf ? await deps.rolesOf(userId) : [];
      // 1.23 (security review): a client gets only the client copy of minutes shown to them, else nothing.
      if (isClientRoles(roles)) return deps.clientMinutes && (await deps.clientMinutes.mayHave(meetingId, userId)) ? 'own' : 'none';
      if (!viewOfMeeting) return 'shared';
      const view = await viewOfMeeting(userId, roles, meetingId);
      if (view === 'full') return 'shared';
      if (view === 'invitee') return final ? 'own' : 'later';
      return 'none';
    };
  }

  /**
   * The send in the meeting's "Sent" log and the audit log. The email has gone either way: a log that
   * can't be written is not worth an error (that would invite sending it again).
   */
  async function keepSend(req: FastifyRequest, meetingId: string, final: boolean, result: { sent: number; failed?: number; recipients?: RecipientResult[] }): Promise<void> {
    const people = result.recipients ?? [];
    if (people.length === 0) return;
    const address = (r: RecipientResult): MinutesSendAddress => ({
      email: r.email,
      name: r.name && r.name !== r.email ? r.name : null,
      ...(r.userId ? { userId: r.userId } : {}),
      copy: r.copy ?? 'shared',
    });
    const to = people.filter((r) => r.line !== 'cc').map(address);
    const cc = people.filter((r) => r.line === 'cc').map(address);
    try {
      await deps.minutesSends?.create({
        meetingId,
        sentById: req.user!.id,
        final,
        to,
        cc,
        results: people.map((r) => ({ email: r.email, ok: r.ok, ...(r.error ? { error: r.error } : {}) })),
      });
    } catch {
      // The email went out; only its line in the log is missing.
    }
    try {
      await deps.audit?.record({
        userId: req.user!.id,
        ip: req.ip ?? null,
        module: 'meetings',
        action: 'meeting.minutes.send',
        entityId: meetingId,
        newValue: { final, to: to.map((a) => a.email), cc: cc.map((a) => a.email), sent: result.sent, failed: result.failed ?? 0 },
      });
    } catch {
      // As above: the email went out.
    }
  }

  // The minutes email exactly as it would be sent, and to whom (sends nothing).
  app.get('/meetings/:id/minutes/preview', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!(await mayOpen(req, reply, id))) return reply;
    if (!deps.notify?.previewMinutes) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    const final = (await finalOf(id))?.status === 'APPROVED';
    const copyOf = copyRule(id, final);
    return { data: await deps.notify.previewMinutes(id, { ...(final ? { final: true } : {}), ...(copyOf ? { copyOf } : {}) }) };
  });

  // The meeting's "Sent" log: each send, newest first — who sent it and when, draft or final, its To
  // and Cc lines with each address's result.
  app.get('/meetings/:id/minutes/sends', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!(await mayOpen(req, reply, id))) return reply;
    const sends = deps.minutesSends ? await deps.minutesSends.listByMeeting(id) : [];
    const senders = [...new Set(sends.flatMap((s) => (s.sentById ? [s.sentById] : [])))];
    const names = senders.length ? await deps.resolveUserNames(senders) : new Map<string, string>();
    const named = await namedFor(req, id, sends.flatMap((s) => [...s.to, ...s.cc]));
    return {
      data: sends.map((s) => {
        const results = new Map(s.results.map((r) => [r.email.toLowerCase(), r]));
        const withResult = (a: MinutesSendAddress) => {
          const r = results.get(a.email.toLowerCase());
          return { ...named(a), ok: r?.ok ?? false, ...(r?.error ? { error: r.error } : {}) };
        };
        return {
          id: s.id,
          sentAt: s.sentAt.toISOString(),
          sentBy: s.sentById ? { id: s.sentById, name: names.get(s.sentById) ?? null } : null,
          final: s.final,
          to: s.to.map(withResult),
          cc: s.cc.map(withResult),
        };
      }),
    };
  });

  // The Cc picker's suggestions: addresses used in earlier sends of this project's meetings.
  app.get('/meetings/:id/minutes/suggestions', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!(await mayOpen(req, reply, id))) return reply;
    const found = deps.minutesSends ? await deps.minutesSends.recentAddresses(id) : [];
    const named = await namedFor(req, id, found);
    return { data: found.map((a) => ({ email: a.email, name: named(a).name })) };
  });

  /**
   * 1.22 QA: whose names (and account ids) the reader of the "Sent" log or the Cc suggestions may see.
   * A send keeps the names its sender may see (an administrator: everyone), so another reader is shown
   * only their own colleagues and the meeting's own people by name; anyone else is just the address —
   * as when the reader types it themselves.
   */
  async function namedFor<A extends { email: string; name: string | null; userId?: string | null }>(req: FastifyRequest, meetingId: string, addresses: readonly A[]): Promise<(a: A) => A> {
    const isColleague = deps.isColleague;
    const accounts = [...new Set(addresses.flatMap((a) => (a.userId ? [a.userId] : [])))];
    if (!isColleague || accounts.length === 0) return (a) => a;
    const viewer = { id: req.user!.id, roles: req.user!.roles ?? [] };
    const meeting = await meetingService.getMeeting(meetingId);
    const own = new Set([meeting.organizerId, ...(await deps.attendeeService.listAttendees(meetingId)).flatMap((a) => (a.userId ? [a.userId] : []))]);
    const allowed = new Set<string>();
    for (const userId of accounts) if (own.has(userId) || (await isColleague(viewer, userId).catch(() => false))) allowed.add(userId);
    return (a) => {
      if (!a.userId || allowed.has(a.userId)) return a;
      const { userId: _hidden, ...rest } = a;
      void _hidden;
      return { ...rest, name: null } as A;
    };
  }

  // ── Final minutes (Final MOM): drafted (by the AI or from the notes), edited, then marked final ──
  if (deps.finalMinutes) {
    const store = deps.finalMinutes;
    const canEdit = (req: FastifyRequest, id: string) => meetingService.canEditMeeting(req.user!.id, req.user!.roles ?? [], id);
    const forbidden = { error: { code: 'FORBIDDEN', message: 'Only the organizer, the project manager or an admin can write the final minutes.' } };
    const hasContent = (c: FinalMinutesContent) => Boolean(c.summary || c.discussion.length || c.decisions.length || c.risks.length || c.nextSteps.length);

    const ai = deps.finalMinutesAi;
    /**
     * What a person sees: editors see a draft too; everyone else sees the minutes only once they are
     * final. 1.22: an editor also sees the AI's work on them (`aiDraft`), when it runs in the background.
     */
    const view = async (rec: FinalMinutesRecord | null, editor: boolean, req?: FastifyRequest, meetingId?: string) => {
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
        ...(ai && editor && req && meetingId ? { aiDraft: await ai.view(meetingId, rec, req.user!.id) } : {}),
      };
    };

    app.get('/meetings/:id/final-minutes', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const seen = await viewOf(req, id);
      if (!seen) return reply.status(404).send(notFound);
      if (seen === 'invitee') {
        // companies: an invitee from another company sees the minutes once they are final (404 before).
        const rec = await store.get(id);
        if (rec?.status !== 'APPROVED') return reply.status(404).send(notFound);
        return { data: await view(rec, false) };
      }
      return { data: await view(await store.get(id), await canEdit(req, id), req, id) };
    });

    // A first draft for the organizer to edit: from the notes (at once; not kept until it is saved), or
    // written by the AI from the meeting's facts. 1.22: the AI's runs in the background — `background`
    // pages get 202 and follow it (aiDraft); older apps wait for the text, as before, and it is kept too.
    const draftBody = z.object({ source: z.enum(['ai', 'notes']), background: z.boolean().optional() });
    app.post('/meetings/:id/final-minutes/draft', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      if (!(await canView(req, id))) return reply.status(404).send(notFound);
      if (!(await canEdit(req, id))) return reply.status(403).send(forbidden);
      const { source, background } = draftBody.parse(req.body ?? {});
      if (source === 'ai' && ai) {
        const current = await store.get(id);
        const viewer = { userId: req.user!.id, roles: req.user!.roles ?? [] };
        // 1.23: the series' carry-over as the organizer sees it (they review and approve the text).
        const facts = async () => minutesFacts((await gather(req, id, [], { seriesFor: 'organizer' })).data);
        const { job, joined } = await ai.start(viewer, id, { title: (await meetingService.getMeeting(id)).title, facts, waiting: !background }, current);
        if (!joined) deps.onFinalMinutesChanged?.(id);
        if (background) return reply.status(202).send({ data: { source, joined, aiDraft: await ai.view(id, current, viewer.userId, { watch: false }) } });
        // An older app waits for the text; once it has gone, this request stops following the job.
        const gone = new AbortController();
        reply.raw.once('close', () => {
          if (!reply.raw.writableEnded) gone.abort();
        });
        return { data: { content: await ai.waitForContent(job.id, id, viewer.userId, gone.signal), source } };
      }
      const { data } = await gather(req, id, [], { seriesFor: 'organizer' });
      if (source === 'notes') return { data: { content: draftFromNotes(data), source } };
      if (!deps.draftMinutesWithAi) throw new ValidationError('AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.');
      const raw = await deps.draftMinutesWithAi(minutesFacts(data), { userId: req.user!.id, roles: req.user!.roles ?? [] });
      return { data: { content: normalizeFinalMinutes(raw), source } };
    });

    if (ai) {
      // 1.22: the AI's draft offered beside minutes someone saved meanwhile — Use it (it becomes the
      // draft; not over final minutes) or Discard it (a failure's notice too). Editors only.
      const offerParams = z.object({ id: z.string().min(1), jobId: z.string().min(1).max(64) });
      app.post('/meetings/:id/final-minutes/ai-draft/:jobId/use', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
        const { id, jobId } = offerParams.parse(req.params);
        if (!(await canView(req, id))) return reply.status(404).send(notFound);
        if (!(await canEdit(req, id))) return reply.status(403).send(forbidden);
        const saved = await ai.use(id, jobId);
        return { data: await view(saved, true, req, id) };
      });
      app.post('/meetings/:id/final-minutes/ai-draft/:jobId/discard', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
        const { id, jobId } = offerParams.parse(req.params);
        if (!(await canView(req, id))) return reply.status(404).send(notFound);
        if (!(await canEdit(req, id))) return reply.status(403).send(forbidden);
        await ai.discard(id, jobId);
        return { data: await view(await store.get(id), true, req, id) };
      });
    }

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
      deps.onFinalMinutesChanged?.(id);
      return { data: await view(saved, true, req, id) };
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
      deps.onFinalMinutesChanged?.(id);
      return { data: await view(saved, true, req, id) };
    });

    app.post('/meetings/:id/final-minutes/reopen', { preHandler: guard.authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      if (!(await canView(req, id))) return reply.status(404).send(notFound);
      if (!(await canEdit(req, id))) return reply.status(403).send(forbidden);
      const current = await store.get(id);
      if (!current) throw new NotFoundError('There are no final minutes to reopen.');
      const saved = await store.save(id, { content: current.content, status: 'DRAFT', approvedById: null, approvedAt: null });
      deps.onFinalMinutesChanged?.(id);
      return { data: await view(saved, true, req, id) };
    });
  }
}
