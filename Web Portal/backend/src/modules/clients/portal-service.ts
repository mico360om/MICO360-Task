import type { Prisma, PrismaClient } from '@prisma/client';
import { createCompletionCounts } from '../project-health/completion-counts';
import { ConflictError, ForbiddenError, HttpError, NotFoundError } from '../../lib/http-errors';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import { readMinutesContent, peopleNames } from '../client-view/client-view-source';
import type { TaskRecord } from '../tasks/task-repository';
import type { CreateAuditData } from '../audit/audit-repository';
import { CLIENT_ROLE } from './client-kind';
import type { GrantRow } from './client-grants';
import { canSignOff, currentAcceptance } from './sign-off';
import {
  actionsOf,
  modulesOf,
  portalCard,
  portalMeetingItem,
  portalMeetingView,
  portalProject,
  portalTask,
  portalTaskView,
  type PortalActionItemSource,
  type PortalMeetingSource,
  type PortalProjectSource,
  type PortalTaskSource,
} from './portal-payload';

/**
 * 1.23 The Client portal: every read and action a client account makes, each through ONE gate, in order:
 *   1. the account is an active, not deleted client (403 CLIENTS_ONLY otherwise);
 *   2. it has a grant for this project, and the project is live (404);
 *   3. the module is granted (404 — the tab isn't there);
 *   4. the action is granted (403);
 *   5. the item is shared with the client: a task marked "Show to client" in this project; a project
 *      meeting they were invited to, or whose approved minutes are shown; their own action item (404).
 * Answers are built by the allow-list builders in portal-payload.ts. Nothing here is cached: a grant
 * taken away, an item un-shared or the account switched off takes effect on the next request.
 */

export const PORTAL_WORDS = {
  notFound: 'This isn’t shared with you.',
  notAllowed: 'You can’t do that on this project. Ask the project team if you need to.',
  notDone: 'Only a finished task can be signed off.',
  noColumn: 'This task can’t be sent back: its project has no column to send it to.',
  reason: 'Say why you are sending it back.',
  cancelled: 'This meeting was cancelled.',
} as const;

const notFound = () => new NotFoundError(PORTAL_WORDS.notFound);
const notAllowed = () => new ForbiddenError(PORTAL_WORDS.notAllowed);

export type PortalModule = 'progress' | 'meetings';
export type PortalAction = 'comment' | 'signOff' | 'respond' | 'download';

export interface PortalClient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  organisation: string | null;
}

export interface PortalNotice {
  userIds: string[];
  type: string;
  title: string;
  body: string | null;
  taskId: string;
}

export interface PortalDeps {
  prisma: PrismaClient;
  /** The company time zone (today, due days). */
  timeZone: string;
  now?: () => Date;
  /** The task service's move (status history, approvals, action items, the next copy of a repeat). */
  moveTask: (taskId: string, columnId: string, actorId: string) => Promise<TaskRecord>;
  /** The task as staff see it (for open boards). */
  getTask: (taskId: string) => Promise<TaskRecord>;
  /** Who hears of a client's comment or sign-off: the task's assignees, watchers and managers who can open it. */
  teamOf: (taskId: string, actorId: string) => Promise<string[]>;
  notify: (n: PortalNotice) => Promise<void>;
  recordActivity?: (e: { taskId: string; userId: string; action: string; meta?: Record<string, unknown> }) => Promise<void>;
  broadcast?: (projectId: string, event: string, payload: unknown) => void;
  /** After a task's words changed (the task search index). */
  onTaskChanged?: (taskId: string) => void | Promise<void>;
  audit?: { record(entry: CreateAuditData): Promise<unknown> };
  /** RSVP through the attendee service (open meeting pages update). */
  setResponse: (meetingId: string, attendeeId: string, response: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED') => Promise<unknown>;
  /** "Mark done" through the action item service. */
  completeActionItem: (itemId: string) => Promise<unknown>;
  /** The client copy of shown approved minutes (null: not shown for this project). */
  minutesPdf: (projectId: string, meetingId: string) => Promise<{ pdf: Buffer; fileName: string } | null>;
  /** The project's client task list as a PDF. */
  taskListPdf: (input: { projectId: string; tasks: ReturnType<typeof portalTask>[]; milestones: ReturnType<typeof portalTask>[]; percentDone: number }) => Promise<{ pdf: Buffer; fileName: string }>;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
}

const taskSelect = {
  id: true,
  key: true,
  title: true,
  description: true,
  isMilestone: true,
  clientVisible: true,
  clientShowDescription: true,
  completedAt: true,
  dueDate: true,
  approvalRequestedAt: true,
  clientAcceptedAt: true,
  column: { select: { category: true } },
} as const satisfies Prisma.TaskSelect;
type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;
const toTaskSource = (t: TaskRow): PortalTaskSource => ({
  id: t.id,
  key: t.key,
  title: t.title,
  description: t.description,
  isMilestone: t.isMilestone,
  clientVisible: t.clientVisible,
  clientShowDescription: t.clientShowDescription,
  columnCategory: t.column?.category ?? null,
  completedAt: t.completedAt,
  dueDate: t.dueDate,
  approvalRequestedAt: t.approvalRequestedAt,
  clientAcceptedAt: t.clientAcceptedAt,
});

const projectSelect = {
  id: true,
  code: true,
  number: true,
  name: true,
  clientName: true,
  status: true,
  color: true,
  icon: true,
  imageUrl: true,
  startDate: true,
  targetDate: true,
  deletedAt: true,
  mainCompany: { select: { name: true, logoUrl: true } },
  companies: ARCHIVE_SELECT.companies,
} as const satisfies Prisma.ProjectSelect;
type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;
const toProjectSource = (p: ProjectRow): PortalProjectSource => ({
  id: p.id,
  code: p.code,
  number: p.number,
  name: p.name,
  clientName: p.clientName,
  status: p.status,
  color: p.color,
  icon: p.icon,
  imageUrl: p.imageUrl,
  startDate: p.startDate,
  targetDate: p.targetDate,
  company: p.mainCompany ? { name: p.mainCompany.name, logoUrl: p.mainCompany.logoUrl } : null,
});
/** A project a client may open: not deleted, not archived (its own status or all its companies). */
const isLive = (p: ProjectRow) => p.deletedAt === null && !archivedOf({ status: p.status, companies: p.companies });

const grantSelect = { projectId: true, progress: true, meetings: true, canComment: true, canSignOff: true, canRespond: true, canDownload: true } as const;

export function createPortalService(deps: PortalDeps) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());

  // ── The gate ────────────────────────────────────────────────────────────────

  /** 1. An active, not deleted client account (the auth guard checked the role; this checks it again). */
  async function clientOf(userId: string): Promise<PortalClient> {
    const u = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null, status: 'ACTIVE', roles: { some: { role: { name: CLIENT_ROLE } } } },
      select: { id: true, firstName: true, lastName: true, email: true, organisation: true },
    });
    if (!u) throw new HttpError('The Client portal is for client accounts.', 'CLIENTS_ONLY', 403);
    return u;
  }

  /** 2. Their grant for this live project (404 when there is none, or the project is gone or archived). */
  async function projectFor(clientId: string, projectId: unknown): Promise<{ grant: GrantRow; project: ProjectRow }> {
    if (typeof projectId !== 'string' || !projectId) throw notFound();
    const row = await prisma.clientProjectGrant.findUnique({
      where: { userId_projectId: { userId: clientId, projectId } },
      select: { ...grantSelect, project: { select: projectSelect } },
    });
    if (!row || !isLive(row.project)) throw notFound();
    const { project, ...grant } = row;
    return { grant, project };
  }

  /** 3. The module (404). */
  const needModule = (grant: GrantRow, m: PortalModule) => {
    if (!modulesOf(grant)[m]) throw notFound();
  };
  /** 4. The action (403). */
  const needAction = (grant: GrantRow, a: PortalAction) => {
    if (!actionsOf(grant)[a]) throw notAllowed();
  };

  /** 5. A task of this project marked "Show to client" (404). */
  async function sharedTask(projectId: string, taskId: unknown): Promise<TaskRow> {
    if (typeof taskId !== 'string' || !taskId) throw notFound();
    const t = await prisma.task.findFirst({ where: { id: taskId, projectId, deletedAt: null, clientVisible: true }, select: taskSelect });
    if (!t) throw notFound();
    return t;
  }

  /** A gate for one project and module (steps 1–3). */
  async function open(userId: string, projectId: unknown, module?: PortalModule) {
    const client = await clientOf(userId);
    const { grant, project } = await projectFor(client.id, projectId);
    if (module) needModule(grant, module);
    return { client, grant, project };
  }

  // 1.23.5: the project's completion in its own mode (by weight when it counts by weight).
  const counts = createCompletionCounts(prisma);

  const record = async (entry: Omit<CreateAuditData, 'module'>) => {
    try {
      await deps.audit?.record({ module: 'client-portal', ...entry });
    } catch (err) {
      deps.logger?.warn('client portal: the audit line could not be written', { err, action: entry.action });
    }
  };
  const activity = async (e: { taskId: string; userId: string; action: string; meta?: Record<string, unknown> }) => {
    try {
      await deps.recordActivity?.(e);
    } catch {
      /* the change itself happened */
    }
  };
  /** Best effort after a change: the team's notices, open boards, the search index. */
  async function tellTeam(taskId: string, projectId: string, clientId: string, notice: { type: string; title: string; body: string | null }, event?: string): Promise<void> {
    try {
      const userIds = await deps.teamOf(taskId, clientId);
      if (userIds.length) await deps.notify({ userIds, taskId, ...notice });
    } catch (err) {
      deps.logger?.warn('client portal: the team could not be told', { err, taskId });
    }
    try {
      await deps.onTaskChanged?.(taskId);
      if (event) deps.broadcast?.(projectId, event, await deps.getTask(taskId));
    } catch (err) {
      deps.logger?.warn('client portal: open boards could not be updated', { err, taskId });
    }
  }

  // ── Meetings: what of a project's meetings a client may see ─────────────────

  /** The shown approved minutes of this project's meetings (by meeting). */
  const shownMinutesWhere = (projectId: string): Prisma.MeetingMinutesWhereInput => ({ status: 'APPROVED', clientVisible: true, clientVisibleProjectId: projectId });

  /**
   * The project's live meetings the client may see: invited to (an attendee row with their user id),
   * or whose approved minutes are shown for this project. `meetingId` narrows to one.
   */
  async function meetingsFor(clientId: string, projectId: string, meetingId?: string): Promise<PortalMeetingSource[]> {
    const rows = await prisma.meeting.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(meetingId ? { id: meetingId } : {}),
        // Invited: their own invitation went out (invitedAt), to a meeting that isn't a draft (security review).
        OR: [{ status: { not: 'DRAFT' }, attendees: { some: { userId: clientId, invitedAt: { not: null } } } }, { minutes: { is: shownMinutesWhere(projectId) } }],
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        startAt: true,
        endAt: true,
        timeZone: true,
        location: true,
        onlineLink: true,
        attendees: { where: { userId: clientId, invitedAt: { not: null } }, select: { id: true, response: true }, take: 1 },
        agendaItems: { select: { title: true, expectedMinutes: true }, orderBy: { position: 'asc' } },
        minutes: { select: { status: true, clientVisible: true, clientVisibleProjectId: true, clientShowRisks: true, approvedAt: true, content: true } },
      },
      orderBy: { startAt: 'desc' },
      take: meetingId ? 1 : 500,
    });
    const shown = rows.filter((r) => r.minutes?.status === 'APPROVED' && r.minutes.clientVisible && r.minutes.clientVisibleProjectId === projectId);
    const names = shown.length ? await peopleNames(prisma, projectId, shown.map((r) => r.id)) : new Map<string, string[]>();
    return rows.map((r) => {
      const showsMinutes = r.minutes?.status === 'APPROVED' && r.minutes.clientVisible === true && r.minutes.clientVisibleProjectId === projectId;
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        status: r.status,
        startAt: r.startAt,
        endAt: r.endAt,
        timeZone: r.timeZone,
        location: r.location,
        onlineLink: r.onlineLink,
        invitation: r.status !== 'DRAFT' && r.attendees[0] ? { response: r.attendees[0].response } : null,
        agenda: r.agendaItems.map((a) => ({ title: a.title, expectedMinutes: a.expectedMinutes })),
        minutes: showsMinutes && r.minutes ? { approvedAt: r.minutes.approvedAt, content: readMinutesContent(r.minutes.content), showRisks: r.minutes.clientShowRisks, people: names.get(r.id) ?? [] } : null,
      };
    });
  }

  /** One meeting the client may see in this project (404). */
  async function meetingFor(clientId: string, projectId: string, meetingId: unknown): Promise<PortalMeetingSource> {
    if (typeof meetingId !== 'string' || !meetingId) throw notFound();
    const [m] = await meetingsFor(clientId, projectId, meetingId);
    if (!m) throw notFound();
    return m;
  }

  /** Their own action items from these meetings of the project. */
  async function ownItems(clientId: string, meetingIds: string[]): Promise<Map<string, PortalActionItemSource[]>> {
    if (meetingIds.length === 0) return new Map();
    const rows = await prisma.actionItem.findMany({
      where: { assigneeId: clientId, meetingId: { in: meetingIds } },
      select: { id: true, meetingId: true, description: true, status: true, dueDate: true },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const out = new Map<string, PortalActionItemSource[]>();
    for (const r of rows) out.set(r.meetingId!, [...(out.get(r.meetingId!) ?? []), { id: r.id, description: r.description, status: r.status, dueDate: r.dueDate }]);
    return out;
  }

  return {
    clientOf,

    /** Home: the client and their live projects, as cards. */
    async home(userId: string) {
      const client = await clientOf(userId);
      const rows = await prisma.clientProjectGrant.findMany({
        where: { userId: client.id },
        select: { ...grantSelect, project: { select: projectSelect } },
      });
      const live = rows.filter((r) => isLive(r.project)).sort((a, b) => a.project.name.localeCompare(b.project.name));
      const cards = await Promise.all(
        live.map(async ({ project, ...grant }) => portalCard(toProjectSource(project), grant, grant.progress ? await counts(project.id) : null)),
      );
      return {
        me: { name: `${client.firstName} ${client.lastName}`.trim(), email: client.email, organisation: client.organisation ?? null },
        projects: cards,
        timeZone: deps.timeZone,
      };
    },

    /** A project page: its look and, with the Progress module, the progress, milestones and shared tasks. */
    async project(userId: string, projectId: unknown) {
      const { grant, project } = await open(userId, projectId);
      const [c, tasks] = grant.progress
        ? await Promise.all([counts(project.id), prisma.task.findMany({ where: { projectId: project.id, deletedAt: null, clientVisible: true }, select: taskSelect })])
        : [null, [] as TaskRow[]];
      return portalProject({ project: toProjectSource(project), grant, counts: c, tasks: tasks.map(toTaskSource), timeZone: deps.timeZone, now: now() });
    },

    /** One shared task, with the client's comment thread (when they may comment). */
    async task(userId: string, projectId: unknown, taskId: unknown) {
      const { client, grant, project } = await open(userId, projectId, 'progress');
      const t = await sharedTask(project.id, taskId);
      const comments = actionsOf(grant).comment ? await threadOf(t.id, client.id) : null;
      return portalTaskView(toTaskSource(t), grant, comments, client.id, deps.timeZone, now());
    },

    /** Comment on a shared task (the Comment action). The team sees it marked "Client". */
    async comment(userId: string, projectId: unknown, taskId: unknown, body: string, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(userId, projectId, 'progress');
      needAction(grant, 'comment');
      const t = await sharedTask(project.id, taskId);
      const c = await prisma.comment.create({ data: { taskId: t.id, userId: client.id, body, fromClient: true } });
      await activity({ taskId: t.id, userId: client.id, action: 'COMMENTED', meta: { commentId: c.id, client: true } });
      await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.comment', entityId: t.id, newValue: { projectId: project.id, commentId: c.id } });
      try {
        deps.broadcast?.(project.id, 'comment:created', { taskId: t.id, comment: { id: c.id, taskId: t.id, userId: client.id, body: c.body, parentId: null, editedAt: null, createdAt: c.createdAt, fromClient: true, clientVisible: false } });
      } catch {
        /* open boards are best effort */
      }
      await tellTeam(t.id, project.id, client.id, { type: 'TASK_COMMENT', title: 'A client commented on a task', body: `${t.key} ${t.title}` });
      return portalTaskView(toTaskSource(t), grant, await threadOf(t.id, client.id), client.id, deps.timeZone, now());
    },

    /** Accept a finished shared task (the Sign off action): "Client accepted · date" for the team. */
    async accept(userId: string, projectId: unknown, taskId: unknown, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(userId, projectId, 'progress');
      needAction(grant, 'signOff');
      const t = await sharedTask(project.id, taskId);
      const src = toTaskSource(t);
      if (!canSignOff(src)) throw new ConflictError(PORTAL_WORDS.notDone, 'NOT_DONE');
      if (!currentAcceptance(src)) {
        const at = now();
        await prisma.task.update({ where: { id: t.id }, data: { clientAcceptedAt: at, clientAcceptedById: client.id } });
        await activity({ taskId: t.id, userId: client.id, action: 'CLIENT_ACCEPTED', meta: { client: true } });
        await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.task.accepted', entityId: t.id, newValue: { projectId: project.id } });
        await tellTeam(t.id, project.id, client.id, { type: 'TASK_CLIENT_SIGN_OFF', title: 'A client accepted a task', body: `${t.key} ${t.title}` }, 'task:updated');
      }
      const fresh = await sharedTask(project.id, t.id);
      return portalTaskView(toTaskSource(fresh), grant, actionsOf(grant).comment ? await threadOf(t.id, client.id) : null, client.id, deps.timeZone, now());
    },

    /** Send a finished shared task back (the Sign off action): back to In progress, the reason as their comment. */
    async sendBack(userId: string, projectId: unknown, taskId: unknown, reason: string, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(userId, projectId, 'progress');
      needAction(grant, 'signOff');
      const t = await sharedTask(project.id, taskId);
      if (!canSignOff(toTaskSource(t))) throw new ConflictError(PORTAL_WORDS.notDone, 'NOT_DONE');
      const why = reason.trim();
      if (!why) throw new HttpError(PORTAL_WORDS.reason, 'VALIDATION', 400);
      const columns = await prisma.kanbanColumn.findMany({ where: { projectId: project.id, enabled: true }, select: { id: true, category: true, position: true }, orderBy: { position: 'asc' } });
      const target = columns.find((c) => c.category === 'IN_PROGRESS') ?? columns.find((c) => c.category !== 'DONE');
      if (!target) throw new ConflictError(PORTAL_WORDS.noColumn, 'NO_COLUMN');
      // The move first (security review): if it is refused nothing else is written, and a retry adds no second reason.
      await deps.moveTask(t.id, target.id, client.id);
      await prisma.task.update({ where: { id: t.id }, data: { clientAcceptedAt: null, clientAcceptedById: null } });
      const c = await prisma.comment.create({ data: { taskId: t.id, userId: client.id, body: `Sent back: ${why}`, fromClient: true } });
      await activity({ taskId: t.id, userId: client.id, action: 'CLIENT_SENT_BACK', meta: { client: true, reason: why, commentId: c.id } });
      await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.task.sent_back', entityId: t.id, newValue: { projectId: project.id, commentId: c.id } });
      await tellTeam(t.id, project.id, client.id, { type: 'TASK_CLIENT_SIGN_OFF', title: 'A client sent a task back', body: `${t.key} ${t.title}: ${why}`.slice(0, 500) }, 'task:updated');
      const fresh = await prisma.task.findFirst({ where: { id: t.id, projectId: project.id, deletedAt: null, clientVisible: true }, select: taskSelect });
      if (!fresh) throw notFound();
      return portalTaskView(toTaskSource(fresh), grant, actionsOf(grant).comment ? await threadOf(t.id, client.id) : null, client.id, deps.timeZone, now());
    },

    /** The project's client task list as a PDF (the Download action, with the Progress module). */
    async taskListPdf(userId: string, projectId: unknown, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(userId, projectId, 'progress');
      needAction(grant, 'download');
      const view = portalProject({
        project: toProjectSource(project),
        grant,
        counts: await counts(project.id),
        tasks: (await prisma.task.findMany({ where: { projectId: project.id, deletedAt: null, clientVisible: true }, select: taskSelect })).map(toTaskSource),
        timeZone: deps.timeZone,
        now: now(),
      });
      const out = await deps.taskListPdf({ projectId: project.id, tasks: view.progress!.tasks, milestones: view.progress!.milestones, percentDone: view.progress!.percentDone });
      await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.pdf.tasks', entityId: project.id });
      return out;
    },

    /** The Meetings tab: invited meetings and meetings with shown minutes. */
    async meetings(userId: string, projectId: unknown) {
      const { client, project } = await open(userId, projectId, 'meetings');
      return (await meetingsFor(client.id, project.id)).map((m) => portalMeetingItem(m, deps.timeZone));
    },

    /** One meeting: per the invitee rules, its shown minutes, their own action items. */
    async meeting(userId: string, projectId: unknown, meetingId: unknown) {
      const { client, grant, project } = await open(userId, projectId, 'meetings');
      const m = await meetingFor(client.id, project.id, meetingId);
      const items = (await ownItems(client.id, [m.id])).get(m.id) ?? [];
      return portalMeetingView(m, items, grant, deps.timeZone);
    },

    /** Where a meeting is (an invitation email's link): its project, when the client may see it there. */
    async whereIs(userId: string, meetingId: unknown) {
      const client = await clientOf(userId);
      if (typeof meetingId !== 'string' || !meetingId) throw notFound();
      const m = await prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, select: { projectId: true } });
      if (!m?.projectId) throw notFound();
      const { grant } = await projectFor(client.id, m.projectId);
      needModule(grant, 'meetings');
      await meetingFor(client.id, m.projectId, meetingId);
      return { projectId: m.projectId, meetingId };
    },

    /** Accept / Maybe / Decline an invitation (the Reply action; invited only). */
    async respond(userId: string, projectId: unknown, meetingId: unknown, response: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED', meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(userId, projectId, 'meetings');
      needAction(grant, 'respond');
      const m = await meetingFor(client.id, project.id, meetingId);
      if (!m.invitation) throw notFound();
      if (m.status === 'CANCELLED') throw new ConflictError(PORTAL_WORDS.cancelled, 'MEETING_CANCELLED');
      const rows = await prisma.meetingAttendee.findMany({ where: { meetingId: m.id, userId: client.id }, select: { id: true } });
      for (const r of rows) await deps.setResponse(m.id, r.id, response);
      await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.meeting.response', entityId: m.id, newValue: { projectId: project.id, response } });
      const items = (await ownItems(client.id, [m.id])).get(m.id) ?? [];
      return portalMeetingView(await meetingFor(client.id, project.id, m.id), items, grant, deps.timeZone);
    },

    /** "Mark done" on their own action item from one of this project's meetings they may see (the Reply action). */
    async completeItem(userId: string, projectId: unknown, itemId: unknown, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(userId, projectId, 'meetings');
      needAction(grant, 'respond');
      if (typeof itemId !== 'string' || !itemId) throw notFound();
      const item = await prisma.actionItem.findFirst({ where: { id: itemId, assigneeId: client.id }, select: { id: true, meetingId: true, status: true } });
      if (!item?.meetingId) throw notFound();
      // The meeting must be one of this project's they may see (invited, or minutes shown).
      const m = await meetingFor(client.id, project.id, item.meetingId);
      if (item.status !== 'COMPLETED' && item.status !== 'CANCELLED') {
        await deps.completeActionItem(item.id);
        await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.action_item.done', entityId: item.id, newValue: { projectId: project.id, meetingId: m.id } });
      }
      const items = (await ownItems(client.id, [m.id])).get(m.id) ?? [];
      return portalMeetingView(await meetingFor(client.id, project.id, m.id), items, grant, deps.timeZone);
    },

    /** The client copy of a meeting's shown approved minutes (the Download action). */
    async minutesPdf(userId: string, projectId: unknown, meetingId: unknown, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(userId, projectId, 'meetings');
      needAction(grant, 'download');
      const m = await meetingFor(client.id, project.id, meetingId);
      if (!m.minutes) throw notFound();
      const out = await deps.minutesPdf(project.id, m.id);
      if (!out) throw notFound();
      await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.pdf.minutes', entityId: m.id, newValue: { projectId: project.id } });
      return out;
    },
  };

  /** The rows of a task's comments a client may see (own, and the ticked replies to them). */
  async function threadOf(taskId: string, clientId: string) {
    return prisma.comment.findMany({
      where: {
        taskId,
        deletedAt: null,
        OR: [
          { userId: clientId, fromClient: true },
          { fromClient: false, clientVisible: true, parent: { is: { userId: clientId, fromClient: true, deletedAt: null } } },
        ],
      },
      select: { id: true, userId: true, parentId: true, body: true, fromClient: true, clientVisible: true, createdAt: true, editedAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}

export type PortalService = ReturnType<typeof createPortalService>;
