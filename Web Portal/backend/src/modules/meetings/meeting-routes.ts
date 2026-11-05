import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MeetingService } from './meeting-service';
import type { MeetingNotifyService } from './meeting-notify-service';
import type { MeetingRecord } from './meeting-repository';
import type { MeetingSeriesService } from './meeting-series-service';
import type { AttendeeService } from './attendee-service';
import type { AgendaService } from './agenda-service';
import { ruleProblem, seriesStarts } from './meeting-series';
import { findClashes, suggestTimes, type BusyBlock } from './free-times';
import { BUSY_ROWS_LIMIT, meetingListScope, type BusyMeetingsStore } from './meeting-repository';
import type { WorkingHours } from '../settings/settings-service';
import { zonedDayKey, zonedStartOfDay } from '../../lib/due-date';
import { buildProjectMeetingsOverview, type MinutesState, type ProjectMeetingsData } from './project-meetings';

/** Where the project dashboard's meetings come from, and the company zone for "overdue". */
export interface ProjectMeetingsDeps {
  load(projectId: string, from: Date, to: Date): Promise<ProjectMeetingsData>;
  timeZone: string;
}
import type { AuthGuard } from '../auth/auth-guard';
import type { Logger } from '../../lib/logger';
import { onlineLinkField, timeZoneField } from './meeting-validation';
import { CompanyNotAvailableError, NO_PICK, type PickOf } from '../companies/company-pick';
import type { MeetingViewOf } from './invitee-view';
import type { MeetingCompanyRule } from './meeting-company';
import { inviteTargetOf, type MeetingInvitees } from './meeting-invitees';
import type { Viewer } from '../companies/company-access';
import type { NamedSeriesService } from './named-series-service';

/** companies: a standalone meeting's company (the project's company otherwise). */
const companyField = z.string().min(1).max(64).nullable().optional();
/** companies: who may be invited to a project's meeting, or to a company's meeting without a project. */
const inviteCandidatesQuery = z
  .object({ projectId: z.string().min(1).max(64).optional(), companyId: z.string().min(1).max(64).optional() })
  .refine((q) => !!q.projectId !== !!q.companyId, { message: 'Give a project or a company.' });

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
  companyId: companyField,
  organizerId: z.string().min(1).optional(),
  location: z.string().nullable().optional(),
  onlineLink: onlineLinkField,
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullable().optional(),
  timeZone: timeZoneField,
  recurrenceRule: recurrenceSchema.nullable().optional(),
  templateId: z.string().nullable().optional(),
  // 1.23: "Create a Teams link" — the organizer's own Microsoft account makes the online link.
  teamsLink: z.boolean().optional(),
  // The new-meeting form's People and Agenda, saved with the meeting (all or nothing).
  attendees: z
    .array(
      z
        .object({
          userId: z.string().min(1).optional(),
          externalName: z.string().trim().max(200).nullable().optional(),
          externalEmail: z.string().trim().email().max(320).nullable().optional(),
          role: z.enum(['REQUIRED', 'OPTIONAL']).optional(),
        })
        .refine((a) => !!a.userId || !!a.externalEmail, { message: 'A guest needs a valid email address.' }),
    )
    .max(100)
    .optional(),
  agendaItems: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        ownerId: z.string().min(1).nullable().optional(),
        expectedMinutes: z.number().int().min(1).max(600).nullable().optional(),
      }),
    )
    .max(50)
    .optional(),
  // 1.23: "New meeting in this series" — the named series it joins (checked: same project, theirs to add).
  seriesId: z.string().min(1).max(64).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: statusEnum.optional(),
  projectId: z.string().min(1).nullable().optional(),
  companyId: companyField,
  organizerId: z.string().min(1).optional(),
  location: z.string().nullable().optional(),
  onlineLink: onlineLinkField,
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().nullable().optional(),
  timeZone: timeZoneField,
  recurrenceRule: recurrenceSchema.nullable().optional(),
  // 1.23: the "Create a Teams link" tick (left out by apps that don't show it: the link stays as it is).
  teamsLink: z.boolean().optional(),
});

/**
 * 1.23 Teams links (modules/integrations/microsoft/teams-meetings.ts): after a save, make the link when
 * it was ticked, take it away when unticked, or make it plain when another link was pasted over it.
 */
export interface MeetingTeamsLinks {
  /** Teams links are set up on this server. */
  available: boolean;
  afterSave(input: {
    meetingId: string;
    actor: { id: string };
    wanted?: boolean;
    before?: Pick<MeetingRecord, 'onlineLink' | 'onlineMeetingProvider'> | null;
  }): Promise<{ changed: boolean; notice: { code: string; message: string } | null }>;
}

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
  /** Project ids the user may see (null = admin) — scopes the list + gates project meetings on create/move; with a pick, that company's. */
  accessibleProjectIds?: (userId: string, roles: string[], pick?: string | null) => Promise<string[] | null>;
  /** companies: the request's picked company (X-Company-Id): the meetings list follows it, and it is a new standalone meeting's default company. Absent: no pick. */
  pickOf?: PickOf;
  /** 1.22: does this administrator list like a team member ("Show my projects only")? Absent: never. */
  myProjectsOnly?: (viewer: { id: string; roles: string[] }) => Promise<boolean>;
  /** Calendar invitations / cancellations (enables POST /meetings/:id/invites + automatic updates). */
  notify?: Pick<MeetingNotifyService, 'sendInvites' | 'sendCancellation'> & Partial<Pick<MeetingNotifyService, 'previewInvites'>>;
  /** Structured logger for best-effort background sends. */
  logger?: Pick<Logger, 'error'> & Partial<Pick<Logger, 'warn'>>;
  /** Attendee and open action-item counts per meeting id (one lookup for the whole list), and `viewerId`'s own row on each. */
  listCounts?: (meetingIds: string[], viewerId?: string) => Promise<Record<string, MeetingListCounts>>;
  /** Repeating meetings (creates a series' meetings; ?scope=series changes all upcoming ones). */
  series?: MeetingSeriesService;
  /** Enables GET /projects/:id/meetings-overview (the project dashboard's meetings). */
  projectMeetings?: ProjectMeetingsDeps;
  /** Enables POST /meetings/free-times (suggested times, clashes, the day's busy strip). */
  freeTimes?: FreeTimesDeps;
  /** Save the people and agenda sent with a new meeting. */
  attendeeService?: Pick<AttendeeService, 'addAttendee' | 'listAttendees'>;
  agendaService?: Pick<AgendaService, 'addItem' | 'listAgenda'>;
  /** Is this an existing, active user? Checks the people sent with a new meeting. */
  isActiveUser?: (userId: string) => Promise<boolean>;
  /**
   * companies: how a person sees a meeting — 'full', 'invitee' (invited from outside its project's
   * companies) or not at all. GET /meetings/:id serves the invitee view; `canViewMeeting` is the full one.
   */
  viewOf?: MeetingViewOf;
  /** companies: the company of a meeting without a project. */
  meetingCompany?: MeetingCompanyRule;
  /** companies: who may be invited (GET /meetings/invite-candidates; checked for the people sent with a new meeting). */
  invitees?: MeetingInvitees;
  /** companies: of these people, the ones the asker knows (free times show only them). */
  knownIds?: (viewer: Viewer, userIds: string[]) => Promise<string[]>;
  /** 1.23 Meeting series: a new meeting joining one ("New meeting in this series"), and the list's series names. */
  namedSeries?: Pick<NamedSeriesService, 'checkJoin' | 'names'>;
  /** 1.23: automatic Teams links (absent: the tick is accepted and does nothing). */
  teams?: MeetingTeamsLinks;
}

/** Companies: what a meeting's working hours are asked for — its project, company or the meeting itself, and who asks. */
export interface FreeTimesHoursTarget {
  projectId: string | null;
  companyId: string | null;
  meetingId: string | null;
  viewer: { id: string; roles: string[] };
}

export interface FreeTimesDeps {
  busy: BusyMeetingsStore;
  /** The meeting hours: its project's main company's, else its company's, else the asker's (companies); the site's without a target. */
  workingHours: (target?: FreeTimesHoursTarget) => Promise<WorkingHours>;
  /** Display names for user ids (missing ones fall back to a neutral label). */
  userNames: (ids: string[]) => Promise<Map<string, string>>;
  /** Company time zone: working hours and days are in it. */
  timeZone: string;
}

const freeTimesBody = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(50),
  startAt: z.coerce.date(),
  minutes: z.number().int().min(5).max(720),
  recurrenceRule: recurrenceSchema.nullable().optional(),
  excludeMeetingId: z.string().min(1).optional(),
  // companies: the meeting's project or company (a new meeting), so its company's hours are used.
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});

const DAY_MS = 86_400_000;

export interface MeetingListCounts {
  attendeeCount: number;
  /** Action items still to do (not completed or cancelled). */
  openActionItemCount: number;
  /** The first few attendees' names (for the cards' faces). */
  attendees?: string[];
  /** How far the minutes are. */
  minutes?: MinutesState;
  /** Notes recorded as decisions. */
  decisionCount?: number;
  /** The caller's own row on the meeting (its id and answer), or null when they aren't on it. */
  mine?: { attendeeId: string; response: string } | null;
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
  const cannotEditSeries = { error: { code: 'FORBIDDEN', message: 'Only the organizer of the series, the project manager or an admin can change all its meetings.' } };
  /**
   * May this user change every meeting of the series? Whoever can change its first meeting, or every
   * meeting still to come — once a series has started, changes reach only those, so a series handed
   * to someone else (or moved to another project) is theirs. Running one meeting of it isn't enough.
   */
  async function canEditSeries(req: FastifyRequest, m: MeetingRecord): Promise<boolean> {
    if (!deps.series) return false;
    const { id: userId, roles } = actor(req);
    const { root, upcoming } = await deps.series.seriesEditFacts(m);
    if (await meetingService.canEditMeetingRecord(root, userId, roles)) return true;
    if (upcoming.length === 0) return false;
    // One answer per organizer / creator / project: a series' meetings mostly share them.
    const answers = new Map<string, Promise<boolean>>();
    for (const r of upcoming) {
      const key = `${r.organizerId}|${r.createdById}|${r.projectId ?? ''}`;
      if (!answers.has(key)) answers.set(key, meetingService.canEditMeetingRecord(r, userId, roles));
    }
    return (await Promise.all(answers.values())).every(Boolean);
  }
  const seriesIdOf = (m: MeetingRecord) => deps.series?.seriesIdOf(m) ?? null;
  /** A meeting with its series (first meeting's id, rule, zone) for the apps' repeat controls. */
  async function withSeries<T extends MeetingRecord>(m: T): Promise<T & { series: Awaited<ReturnType<MeetingSeriesService['describe']>> }> {
    return { ...m, series: deps.series ? await deps.series.describe(m) : null };
  }
  const badRule = (message: string) => ({ error: { code: 'VALIDATION', message } });
  /** companies: the picked company, or none when it can't be used (a write never fails on a stale pick). */
  async function pickFor(req: FastifyRequest): Promise<string | null> {
    if (!deps.pickOf) return null;
    try {
      return await deps.pickOf(req);
    } catch (err) {
      if (err instanceof CompanyNotAvailableError) return null;
      throw err;
    }
  }

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

  /** 1.23: each listed meeting's series name (the cards' Series chip; anyone who sees the meeting may see it). */
  async function withSeriesNames<T extends MeetingRecord>(list: T[]): Promise<Array<T & { seriesName?: string | null }>> {
    if (!deps.namedSeries) return list;
    const ids = [...new Set(list.flatMap((m) => (m.seriesId ? [m.seriesId] : [])))];
    const names = ids.length ? await deps.namedSeries.names(ids) : new Map<string, string>();
    return list.map((m) => ({ ...m, seriesName: m.seriesId ? (names.get(m.seriesId) ?? null) : null }));
  }

  /** Fire a best-effort email job without failing (or slowing) the request. */
  function background(job: Promise<unknown>, what: string, meetingId: string): void {
    job.catch((err) => deps.logger?.error(what, { err, meetingId }));
  }

  app.get('/meetings', { preHandler: guard.authenticate }, async (req) => {
    const q = listQuery.parse(req.query);
    // companies: the plain list follows the picked company; one named project (its meetings tab,
    // opened from the project) is checked by its own rule, as opening it is.
    const pick = q.projectId ? null : await (deps.pickOf ?? NO_PICK)(req);
    const { id: userId, roles } = actor(req);
    // A project's tab is an object check (no pick: admin-wide); the plain list is a list (the pick named,
    // even null) — 1.22: an administrator's follows "Show my projects only", like a team member's.
    const access = deps.accessibleProjectIds;
    const projectIds = access ? await (q.projectId ? access(userId, roles) : access(userId, roles, pick)) : null;
    const admin = roles.includes('ADMIN');
    const mineOnly = admin && !q.projectId && !!deps.myProjectsOnly && (await deps.myProjectsOnly({ id: userId, roles }));
    const data = await meetingService.listMeetings({
      projectId: q.projectId,
      status: q.status,
      from: q.from,
      to: q.to,
      ...(q.mine ? { organizerId: userId } : {}),
      // 1.23: the plain list's scope is the one search uses too (meetingListScope).
      scope: !pick && q.mine ? { userId, projectIds: [] } : meetingListScope({ userId, projectIds, pick, admin, mineOnly }),
    });
    const flagged = await withSeriesNames(await withEditFlags(req, data));
    if (!deps.listCounts || flagged.length === 0) return { data: flagged };
    const counts = await deps.listCounts(flagged.map((m) => m.id), req.user!.id);
    return {
      data: flagged.map((m) => {
        const c = counts[m.id];
        return {
          ...m, attendeeCount: c?.attendeeCount ?? 0, openActionItemCount: c?.openActionItemCount ?? 0, attendees: c?.attendees ?? [], minutes: c?.minutes ?? 'NONE', decisionCount: c?.decisionCount ?? 0,
          // Your own row and answer: a list shows them without reading each meeting's people.
          myAttendeeId: c?.mine?.attendeeId ?? null, myResponse: c?.mine?.response ?? null,
        };
      }),
    };
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
    const { attendees: sentPeople = [], agendaItems = [], teamsLink, ...body } = createSchema.parse(req.body);
    // Invitations go out in the organizer's name: only an admin may schedule on someone else's behalf.
    if (body.organizerId && body.organizerId !== req.user!.id && !actor(req).roles.includes('ADMIN')) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'You can only schedule meetings that you organize.' } });
    }
    // Creating a *project* meeting requires access to that project (standalone meetings are always allowed).
    if (body.projectId && !(await canUseProject(req, body.projectId))) return reply.status(403).send(noProject);
    const problem = ruleProblem(body.recurrenceRule, body.startAt, body.timeZone || 'UTC');
    if (problem) return reply.status(400).send(badRule(problem));
    const organizerId = body.organizerId ?? req.user!.id;
    // companies: a meeting without a project belongs to a company (chosen, picked, or the organizer's primary).
    const { companyId: chosenCompany, seriesId: askedSeries, ...fields } = body;
    // 1.23: with "Create a Teams link" the Teams join link fills the online link (a pasted one is ignored) —
    // when the Teams link can be made here: the site has them and the person saving organizes it.
    if (teamsLink && deps.teams?.available && organizerId === req.user!.id) fields.onlineLink = null;
    const companyId = deps.meetingCompany ? await deps.meetingCompany.forNew(actor(req), { projectId: body.projectId, companyId: chosenCompany, organizerId }, await pickFor(req)) : undefined;
    // 1.23: joining a series — its project (company), and the person may add the meeting to it.
    const seriesId = askedSeries && deps.namedSeries
      ? await deps.namedSeries.checkJoin(actor(req), askedSeries, { projectId: body.projectId ?? null, companyId: body.projectId ? null : (companyId ?? chosenCompany ?? null), organizerId })
      : undefined;

    // People and agenda are checked before anything is saved, so a bad one creates nothing.
    const { attendeeService, agendaService } = deps;
    if ((sentPeople.length && !attendeeService) || (agendaItems.length && !agendaService)) {
      return reply.status(400).send(badRule('People and agenda can’t be saved with a new meeting here.'));
    }
    const seen = new Set<string>();
    const people = sentPeople.filter((p) => {
      const key = p.userId ? `u:${p.userId}` : `e:${p.externalEmail!.toLowerCase()}`;
      return !seen.has(key) && !!seen.add(key);
    });
    const userIds = people.flatMap((p) => (p.userId ? [p.userId] : []));
    if (deps.isActiveUser) {
      const active = await Promise.all(userIds.map((id) => deps.isActiveUser!(id)));
      if (active.includes(false)) return reply.status(400).send(badRule('Everyone invited must be an active user.'));
    }
    // companies: colleagues in the meeting's project or company only (guests by email as before).
    if (deps.invitees && userIds.length) await deps.invitees.assertInvitable(actor(req), inviteTargetOf({ projectId: body.projectId ?? null, companyId }), userIds);
    const leads = new Set([organizerId, ...userIds]);
    if (agendaItems.some((g) => g.ownerId && !leads.has(g.ownerId))) {
      return reply.status(400).send(badRule('An agenda lead must be one of the meeting’s people or the organizer.'));
    }

    let meeting = await meetingService.createMeeting({ ...fields, ...(companyId !== undefined ? { companyId } : {}), ...(seriesId ? { seriesId } : {}), organizerId, createdById: req.user!.id });
    try {
      for (const p of people) {
        // A guest given only as an email is named from the part before the @.
        const externalName = p.userId ? null : p.externalName || p.externalEmail!.split('@')[0]!;
        await attendeeService!.addAttendee(meeting.id, { userId: p.userId ?? null, externalName, externalEmail: p.userId ? null : p.externalEmail, role: p.role });
      }
      for (const g of agendaItems) await agendaService!.addItem(meeting.id, { title: g.title, ownerId: g.ownerId ?? null, expectedMinutes: g.expectedMinutes ?? null });
    } catch (err) {
      // All or nothing: take the half-saved meeting back out.
      await meetingService.deleteMeeting(meeting.id).catch((e) => deps.logger?.error('could not remove a half-created meeting', { err: e, meetingId: meeting.id }));
      throw err;
    }
    // A repeating meeting is the first of its series: the next meetings are created now (with its people).
    if (deps.series && meeting.recurrenceRule && !meeting.recurrenceRule.paused) {
      await deps.series.start(meeting);
      meeting = await meetingService.getMeeting(meeting.id);
    }
    // 1.23: the Teams link (one for a repeating meeting's family), made as the organizer — the meeting is saved either way.
    const teams = teamsLink && deps.teams ? await deps.teams.afterSave({ meetingId: meeting.id, actor: actor(req), wanted: true }) : null;
    if (teams?.changed) meeting = await meetingService.getMeeting(meeting.id);
    const lists = attendeeService && agendaService ? { attendees: await attendeeService.listAttendees(meeting.id), agendaItems: await agendaService.listAgenda(meeting.id) } : {};
    return reply.status(201).send({ data: { ...(await withSeries({ ...meeting, canEdit: true })), ...lists, ...(teams?.notice ? { teamsNotice: teams.notice } : {}) } });
  });

  // Free times for a meeting being scheduled: three suggestions (working hours, everyone invited
  // free, the repeat's days), who clashes with the chosen time, and the chosen day's busy blocks. A
  // busy meeting's title is shown only to someone who may see that meeting; otherwise "Busy".
  if (deps.freeTimes) {
    const ft = deps.freeTimes;
    app.post('/meetings/free-times', { preHandler: guard.authenticate }, async (req) => {
      const body = freeTimesBody.parse(req.body);
      // companies: only the people the asker knows (colleagues, teammates, chat partners).
      const asked = [...new Set(body.userIds)];
      const userIds = deps.knownIds ? await deps.knownIds(actor(req), asked) : asked;
      const tz = ft.timeZone;
      const day = zonedDayKey(body.startAt, tz);
      const dayStart = zonedStartOfDay(day, tz);
      const rule = body.recurrenceRule ?? null;
      const length = body.minutes * 60_000;
      // Suggestions start at the chosen day, or now if that has passed, and look two weeks ahead.
      const from = new Date(Math.max(dayStart.getTime(), Date.now()));
      const searchStart = zonedStartOfDay(zonedDayKey(from, tz), tz);
      const searchEnd = new Date(searchStart.getTime() + 15 * DAY_MS);
      // Read only what is needed: the chosen day (the busy strip), the search, and each of a
      // repeat's first 4 meetings (the clashes) — never the whole stretch to a yearly repeat's 4th.
      const starts = rule ? seriesStarts(body.startAt, rule, tz, new Date(body.startAt.getTime() + 5 * 366 * DAY_MS)).slice(0, 4) : [body.startAt];
      const inSearch = (a: Date, b: Date) => a.getTime() >= searchStart.getTime() && b.getTime() <= searchEnd.getTime();
      const windows = [
        { from: searchStart, to: searchEnd },
        { from: dayStart, to: new Date(dayStart.getTime() + DAY_MS) },
        ...starts.map((s) => ({ from: s, to: new Date(s.getTime() + length) })),
      ].filter((w, i) => i === 0 || !inSearch(w.from, w.to));
      const [reads, hours, names] = await Promise.all([
        Promise.all(windows.map((w) => ft.busy.busyBetween(userIds, w.from, w.to, body.excludeMeetingId))),
        // companies: the hours of what the meeting belongs to (the server checks the asker may use it).
        ft.workingHours({ projectId: body.projectId ?? null, companyId: body.companyId ?? null, meetingId: body.excludeMeetingId ?? null, viewer: actor(req) }),
        ft.userNames(userIds),
      ]);
      if (reads.some((r) => r.length >= BUSY_ROWS_LIMIT)) deps.logger?.warn?.('meeting free times: busy list cut short', { limit: BUSY_ROWS_LIMIT, userCount: userIds.length });
      const rows = [...new Map(reads.flat().map((m) => [m.meetingId, m])).values()];
      // Which titles may be shown: in one look-up where the store can, else each meeting's own check.
      const ids = rows.map((m) => m.meetingId);
      const { id: me, roles } = actor(req);
      const visible =
        ft.busy.visibleTo && deps.accessibleProjectIds
          ? await ft.busy.visibleTo(ids, me, await deps.accessibleProjectIds(me, roles)).catch(() => new Set<string>())
          : new Set((await Promise.all(ids.map(async (id) => ((await canView(req, id).catch(() => false)) ? id : null)))).filter((id): id is string => id !== null));
      const busy: BusyBlock[] = rows.flatMap((m) => m.userIds.map((userId) => ({ userId, start: m.start, end: m.end, meetingId: m.meetingId, title: visible.has(m.meetingId) ? m.title : null })));
      const nameOf = (id: string) => names.get(id) ?? 'Someone';
      const suggestions = suggestTimes({ from, minutes: body.minutes, busy, hours, timeZone: tz, rule });
      const clashes = findClashes({ start: body.startAt, minutes: body.minutes, busy, timeZone: tz, rule }).map((c) => ({ ...c, name: nameOf(c.userId) }));
      const dayEnd = dayStart.getTime() + DAY_MS;
      const dayBlocks = userIds.map((userId) => ({
        userId,
        name: nameOf(userId),
        blocks: busy
          .filter((b) => b.userId === userId && b.start.getTime() < dayEnd && b.end.getTime() > dayStart.getTime())
          .map((b) => ({ start: b.start, end: b.end, title: b.title })),
      }));
      return { data: { suggestions, clashes, day: dayBlocks, workingHours: hours } };
    });
  }

  // companies: who may be invited — a project's meeting (its companies, as far as the asker can see)
  // or a company's meeting without a project.
  if (deps.invitees) {
    const invitees = deps.invitees;
    app.get('/meetings/invite-candidates', { preHandler: guard.authenticate }, async (req) => {
      const q = inviteCandidatesQuery.parse(req.query);
      return { data: await invitees.candidates(actor(req), q.projectId ? { projectId: q.projectId } : { companyId: q.companyId! }) };
    });
  }

  app.get('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // companies: `view` says which: 'full', or 'invitee' (invited from outside the project's companies).
    const view = deps.viewOf ? await deps.viewOf(req.user!.id, req.user!.roles ?? [], id) : (await canView(req, id)) ? 'full' : null;
    if (!view) return reply.status(404).send(notFound);
    const [meeting] = await withEditFlags(req, [await meetingService.getMeeting(id)]);
    // An invitee sees the meeting itself: not its transcript, and nothing they could change.
    const shown = view === 'invitee' ? { ...meeting!, transcript: null, canEdit: false } : meeting!;
    return { data: { ...(await withSeries(shown)), view } };
  });

  app.put('/meetings/:id', { preHandler: guard.authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canView(req, id))) return reply.status(403).send(forbidden);
    if (!(await canEdit(req, id))) return reply.status(403).send(cannotEdit);
    const { scope } = scopeQuery.parse(req.query);
    const { teamsLink, ...patch } = updateSchema.parse(req.body);
    const before = await meetingService.getMeeting(id);
    // 1.23: with "Create a Teams link" ticked the Teams link fills the online link (a pasted one is ignored)
    // — when it can be made here: the site has Teams links and the person saving organizes the meeting.
    if (teamsLink && deps.teams?.available && (patch.organizerId ?? before.organizerId) === req.user!.id) delete patch.onlineLink;
    const seriesId = seriesIdOf(before);
    // 1.23: after the save — make, take away or make plain the Teams link (the meeting is saved either way).
    const teamsAfter = (meetingId: string) => (deps.teams ? deps.teams.afterSave({ meetingId, actor: actor(req), wanted: teamsLink, before }) : Promise.resolve(null));
    if (scope === 'series' && !seriesId) return reply.status(400).send(notSeries);
    if (scope === 'series' && !(await canEditSeries(req, before))) return reply.status(403).send(cannotEditSeries);
    if (patch.recurrenceRule) {
      const problem = ruleProblem(patch.recurrenceRule, patch.startAt ?? before.startAt, patch.timeZone || before.timeZone || 'UTC');
      if (problem) return reply.status(400).send(badRule(problem));
    }
    // Moving the meeting into a project requires access to that project.
    if (patch.projectId && patch.projectId !== before.projectId && !(await canUseProject(req, patch.projectId))) {
      return reply.status(403).send(noProject);
    }
    // companies: a meeting without a project keeps (or gets) a company; one in a project has none.
    if (deps.meetingCompany) {
      const companyId = await deps.meetingCompany.forChange(actor(req), before, patch, await pickFor(req));
      if (companyId === undefined) delete patch.companyId;
      else patch.companyId = companyId;
    } else delete patch.companyId;
    // The organizer can be handed over only to someone already in the meeting (attendee or project member).
    if (
      patch.organizerId &&
      patch.organizerId !== before.organizerId &&
      !actor(req).roles.includes('ADMIN') &&
      (deps.viewOf ? (await deps.viewOf(patch.organizerId, [], id)) === null : deps.canViewMeeting && !(await deps.canViewMeeting(patch.organizerId, [], id)))
    ) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'The new organizer must be an attendee or a member of the meeting’s project.' } });
    }
    if (scope === 'series' && deps.series) {
      const change = await deps.series.updateSeries(id, patch);
      // The edited meeting — or the series' next one when the new schedule had no place for it.
      let meeting = change.meeting ?? before;
      const teams = await teamsAfter(meeting.id);
      if (teams?.changed) meeting = await meetingService.getMeeting(meeting.id);
      if (before.invitesSentAt && deps.notify) {
        const notify = deps.notify;
        // A series that had started was split: its calendar series ends, and the new one is sent.
        // Everyone with the old series hears — people added to its later meetings included.
        if (change.endedMeeting) {
          const ended = change.endedMeeting;
          background(notify.sendCancellation(ended.id, { meeting: ended, scope: 'series', note: 'moved', alsoTo: change.changed }), 'meeting series update notice failed', ended.id);
        }
        if (patch.status === 'CANCELLED') background(notify.sendCancellation(meeting.id, { scope: 'series' }), 'meeting cancellation notice failed', meeting.id);
        // Only what calendars show is worth an email: dates, times, repeat, title, place, notes —
        // sent from a meeting still going ahead (a cancelled one carries no invitation).
        else if (change.scheduleChanged || calendarChanged(before, meeting)) {
          const from = meeting.status !== 'CANCELLED' ? meeting : change.changed.find((r) => r.status !== 'CANCELLED' && !r.deletedAt);
          if (from) background(notify.sendInvites(from.id, { scope: 'series' }), 'meeting series update notice failed', from.id);
        }
      }
      const [data] = await withEditFlags(req, [meeting]);
      return { data: { ...(await withSeries(data!)), ...(teams?.notice ? { teamsNotice: teams.notice } : {}) } };
    }
    // One meeting of a series keeps the series' repeat (it changes with scope=series).
    if (seriesId) delete patch.recurrenceRule;
    let meeting = await meetingService.updateMeeting(id, patch);
    // A one-off meeting given a repeat becomes the first meeting of a series.
    if (!seriesId && deps.series && meeting.recurrenceRule && !meeting.recurrenceRule.paused) {
      await deps.series.start(meeting);
      meeting = await meetingService.getMeeting(id);
    }
    const teams = await teamsAfter(id);
    if (teams?.changed) meeting = await meetingService.getMeeting(id);
    // Keep invitees' calendars in step once invitations have gone out.
    if (before.invitesSentAt && deps.notify) {
      if (meeting.status === 'CANCELLED' && before.status !== 'CANCELLED') {
        background(deps.notify.sendCancellation(id), 'meeting cancellation notice failed', id);
      } else if (meeting.status !== 'CANCELLED' && calendarChanged(before, meeting)) {
        // 1.23: a Teams link made or taken away reaches the whole repeating family (one link for all).
        const scope = teams?.changed ? 'series' : 'one';
        background(seriesId ? deps.notify.sendInvites(id, { scope }) : deps.notify.sendInvites(id), 'meeting update notice failed', id);
      }
    }
    const [data] = await withEditFlags(req, [meeting]);
    return { data: { ...(await withSeries(data!)), ...(teams?.notice ? { teamsNotice: teams.notice } : {}) } };
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
      if (!(await canEditSeries(req, before))) return reply.status(403).send(cannotEditSeries);
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
      if (!(await canEditSeries(req, before))) return reply.status(403).send(cannotEditSeries);
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
