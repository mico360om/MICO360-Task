import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MeetingService } from './meeting-service';
import type { MeetingNotifyService } from './meeting-notify-service';
import type { MeetingRecord } from './meeting-repository';
import type { MeetingSeriesService } from './meeting-series-service';
import { ruleProblem } from './meeting-series';
import { buildProjectMeetingsOverview, type ProjectMeetingsData } from './project-meetings';

/** Where the project dashboard's meetings come from, and the company zone for "overdue". */
export interface ProjectMeetingsDeps {
  load(projectId: string, from: Date, to: Date): Promise<ProjectMeetingsData>;
  timeZone: string;
}

const DAY_MS = 86_400_000;
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
  nthWeekday: z.object({ week: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]), day: z.number().int().min(0).max(6) }).optional(),
  anchorDay: z.number().int().min(1).max(31).optional(),
  paused: z.boolean().optional(),
});

/** One meeting of a series (the default), or all its upcoming meetings. */
const scopeQuery = z.object({ scope: z.enum(['one', 'series']).optional() });

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

const inviteBody = z.object({
  /** Only people who haven't had an invitation yet. */
  onlyNew: z.boolean().optional(),
  /** Send everyone a fresh invitation although invitations already went out. */
  resend: z.boolean().optional(),
});

const listQuery = z.object({
  projectId: z.string().optional(),
  status: statusEnum.optional(),
  // "Organized by me". Parsed explicitly: z.coerce.boolean() would read "false" as true.
  mine: z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1').optional(),
  // A calendar range: meetings starting in [from, to).
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
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
  notify?: Pick<MeetingNotifyService, 'sendInvites' | 'sendCancellation'> & Partial<Pick<MeetingNotifyService, 'previewInvites'>>;
  /** Structured logger for best-effort background sends. */
  logger?: Pick<Logger, 'error'>;
  /** Attendee and open action-item counts per meeting id (one lookup for the whole list). */
  listCounts?: (meetingIds: string[]) => Promise<Record<string, MeetingListCounts>>;
  /** Repeating meetings (creates a series' meetings; ?scope=series changes all upcoming ones). */
  series?: MeetingSeriesService;
  /** Enables GET /projects/:id/meetings-overview (the project dashboard's meetings). */
  projectMeetings?: ProjectMeetingsDeps;
}

export interface MeetingListCounts {
  attendeeCount: number;
  /** Action items still to do (not completed or cancelled). */
  openActionItemCount: number;
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
  const notSeries = { error: { code: 'VALIDATION', message: 'This meeting is not part of a series.' } };
  const seriesIdOf = (m: MeetingRecord) => deps.series?.seriesIdOf(m) ?? null;
  /** A meeting with its series (first meeting's id, rule, zone) for the apps' repeat controls. */
  async function withSeries<T extends MeetingRecord>(m: T): Promise<T & { series: Awaited<ReturnType<MeetingSeriesService['describe']>> }> {
    return { ...m, series: deps.series ? await deps.series.describe(m) : null };
  }
  const badRule = (message: string) => ({ error: { code: 'VALIDATION', message } });

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
      from: q.from,
      to: q.to,
      ...(q.mine ? { organizerId: req.user!.id } : {}),
      scope: q.mine ? { userId: req.user!.id, projectIds: [] } : { userId: req.user!.id, projectIds },
    });
    const flagged = await withEditFlags(req, data);
    if (!deps.listCounts || flagged.length === 0) return { data: flagged };
    const counts = await deps.listCounts(flagged.map((m) => m.id));
    return { data: flagged.map((m) => ({ ...m, attendeeCount: counts[m.id]?.attendeeCount ?? 0, openActionItemCount: counts[m.id]?.openActionItemCount ?? 0 })) };
  });

  // The project dashboard: its meetings (six months back, four ahead) with people, minutes,
  // decisions and action items. Anyone who can see the project can see this.
  if (deps.projectMeetings) {
    const source = deps.projectMeetings;
    app.get('/projects/:id/meetings-overview', { preHandler: guard.authenticate }, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!(await canUseProject(req, id))) return reply.status(403).send(noProject);
      const now = new Date();
      const data = await source.load(id, new Date(now.getTime() - 183 * DAY_MS), new Date(now.getTime() + 122 * DAY_MS));
      return { data: buildProjectMeetingsOverview(data, now, source.timeZone) };
    });
  }

  app.post('/meetings', { preHandler: guard.authenticate }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    // Invitations go out in the organizer's name: only an admin may schedule on someone else's behalf.
    if (body.organizerId && body.organizerId !== req.user!.id && !actor(req).roles.includes('ADMIN')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You can only schedule meetings that you organize.' } });
    }
    // Creating a *project* meeting requires access to that project (standalone meetings are always allowed).
    if (body.projectId && !(await canUseProject(req, body.projectId))) return reply.status(403).send(noProject);
    const problem = ruleProblem(body.recurrenceRule, body.startAt, body.timeZone || 'UTC');
    if (problem) return reply.status(400).send(badRule(problem));
    let meeting = await meetingService.createMeeting({
      ...body,
      organizerId: body.organizerId ?? req.user!.id,
      createdById: req.user!.id,
    });
    // A repeating meeting is the first of its series: the next meetings are created now.
    if (deps.series && meeting.recurrenceRule && !meeting.recurrenceRule.paused) {
      await deps.series.start(meeting);
      meeting = await meetingService.getMeeting(meeting.id);
    }
    return reply.status(201).send({ data: await withSeries({ ...meeting, canEdit: true }) });
  });

  app.get('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(404).send(notFound);
    const [meeting] = await withEditFlags(req, [await meetingService.getMeeting(id)]);
    return { data: await withSeries(meeting!) };
  });

  app.put('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const { scope } = scopeQuery.parse(req.query);
    const patch = updateSchema.parse(req.body);
    const before = await meetingService.getMeeting(id);
    const seriesId = seriesIdOf(before);
    if (scope === 'series' && !seriesId) return reply.status(400).send(notSeries);
    if (patch.recurrenceRule) {
      const problem = ruleProblem(patch.recurrenceRule, patch.startAt ?? before.startAt, patch.timeZone || before.timeZone || 'UTC');
      if (problem) return reply.status(400).send(badRule(problem));
    }
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
    if (scope === 'series' && deps.series) {
      const change = await deps.series.updateSeries(id, patch);
      const meeting = change.meeting ?? (await meetingService.getMeeting(id));
      if (before.invitesSentAt && deps.notify) {
        const notify = deps.notify;
        // A series that had started was split: its calendar series ends, and the new one is sent.
        if (change.endedMeeting) {
          const ended = change.endedMeeting;
          background(notify.sendCancellation(ended.id, { meeting: ended, scope: 'series', note: 'moved' }), 'meeting series update notice failed', ended.id);
        }
        if (meeting.status === 'CANCELLED') background(notify.sendCancellation(id, { scope: 'series' }), 'meeting cancellation notice failed', id);
        else background(notify.sendInvites(id, { scope: 'series' }), 'meeting series update notice failed', id);
      }
      const [data] = await withEditFlags(req, [meeting]);
      return { data: await withSeries(data!) };
    }
    // One meeting of a series keeps the series' repeat (it changes with scope=series).
    if (seriesId) delete patch.recurrenceRule;
    let meeting = await meetingService.updateMeeting(id, patch);
    // A one-off meeting given a repeat becomes the first meeting of a series.
    if (!seriesId && deps.series && meeting.recurrenceRule && !meeting.recurrenceRule.paused) {
      await deps.series.start(meeting);
      meeting = await meetingService.getMeeting(id);
    }
    // Keep invitees' calendars in step once invitations have gone out.
    if (before.invitesSentAt && deps.notify) {
      if (meeting.status === 'CANCELLED' && before.status !== 'CANCELLED') {
        background(deps.notify.sendCancellation(id), 'meeting cancellation notice failed', id);
      } else if (meeting.status !== 'CANCELLED' && calendarChanged(before, meeting)) {
        background(seriesId ? deps.notify.sendInvites(id, { scope: 'one' }) : deps.notify.sendInvites(id), 'meeting update notice failed', id);
      }
    }
    const [data] = await withEditFlags(req, [meeting]);
    return { data: await withSeries(data!) };
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
    const { scope } = scopeQuery.parse(req.query);
    const before = await meetingService.getMeeting(id);
    if (scope === 'series') {
      if (!deps.series || !seriesIdOf(before)) return reply.status(400).send(notSeries);
      const change = await deps.series.cancelSeries(id);
      if (before.invitesSentAt && deps.notify) background(deps.notify.sendCancellation(id, { scope: 'series' }), 'meeting cancellation notice failed', id);
      return { data: await withSeries({ ...(change.meeting ?? before), canEdit: true }) };
    }
    const meeting = await meetingService.cancelMeeting(id);
    // If invitations went out, notify attendees with a cancelling calendar update (best-effort).
    if (meeting.invitesSentAt && before.status !== 'CANCELLED' && deps.notify) {
      background(deps.notify.sendCancellation(id), 'meeting cancellation notice failed', id);
    }
    return { data: { ...meeting, canEdit: true } };
  });

  // Who an invitation would go to and anything to fix first (sends nothing).
  app.get('/meetings/:id/invites/preview', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    if (!deps.notify?.previewInvites) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    return { data: await deps.notify.previewInvites(id) };
  });

  // Send calendar invitations with an .ics to the organizer + attendees — or only to people who
  // haven't had one yet. Sending everyone a second set needs { resend: true }, so a double click
  // or a stale page can't mail the whole list twice.
  app.post('/meetings/:id/invites', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    if (!deps.notify) return reply.status(503).send({ error: { code: 'UNAVAILABLE', message: 'Email is not configured.' } });
    const body = inviteBody.parse(req.body ?? {});
    if (body.onlyNew) return { data: await deps.notify.sendInvites(id, { onlyNew: true }) };
    const meeting = await meetingService.getMeeting(id);
    if (meeting.invitesSentAt && !body.resend) {
      return reply.status(409).send({
        error: { code: 'INVITES_ALREADY_SENT', message: 'Invitations were already sent. Confirm to send everyone an updated invitation.', invitesSentAt: meeting.invitesSentAt },
      });
    }
    return { data: await deps.notify.sendInvites(id) };
  });

  app.delete('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const { scope } = scopeQuery.parse(req.query);
    if (scope === 'series') {
      const before = await meetingService.getMeeting(id);
      if (!deps.series || !seriesIdOf(before)) return reply.status(400).send(notSeries);
      await deps.series.deleteSeries(id);
      if (before.invitesSentAt && deps.notify) {
        background(deps.notify.sendCancellation(id, { meeting: before, scope: 'series' }), 'meeting cancellation notice failed', id);
      }
      return reply.status(204).send();
    }
    const deleted = await meetingService.deleteMeeting(id);
    // Deleting an invited meeting removes it from everyone's calendar.
    if (deleted.invitesSentAt && deleted.status !== 'CANCELLED' && deps.notify) {
      background(deps.notify.sendCancellation(id, { meeting: deleted }), 'meeting cancellation notice failed', id);
    }
    return reply.status(204).send();
  });
}
