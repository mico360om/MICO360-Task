import type { Prisma, PrismaClient } from '@prisma/client';
import { createCompletionCounts } from '../project-health/completion-counts';
import { ConflictError, ForbiddenError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import { readMinutesContent, peopleNames } from '../client-view/client-view-source';
import type { TaskRecord } from '../tasks/task-repository';
import type { CreateAuditData } from '../audit/audit-repository';
import { CLIENT_ROLE } from './client-kind';
import { GRANT_COLUMNS, GRANT_WORDS, grantRows, type ClientGrant, type GrantRow } from './client-grants';
import { canSignOff, currentAcceptance } from './sign-off';
import type { NoticeSettings } from './client-notices';
import {
  actionsOf,
  clientMaySeeFile,
  modulesOf,
  portalCard,
  portalMeetingItem,
  portalMeetingView,
  portalProject,
  portalTask,
  portalTaskView,
  type PortalActionItemSource,
  type PortalFileSource,
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
export type PortalAction = 'comment' | 'signOff' | 'respond' | 'download' | 'upload';

/** The id a preview of a client not yet saved reads as: no row has it (no comments, invitations or items). */
export const PREVIEW_NOBODY = '~client-preview~';

/**
 * 1.23.7 Preview as client: who the portal is read for — a client account as saved, or (for an
 * administrator's preview) a client with the permission matrix still on screen. A preview only reads.
 */
export interface PreviewSpec {
  /** The client account (absent: a client not saved yet — they have no comments, invitations or items). */
  clientId?: string | null;
  firstName?: string;
  lastName?: string;
  organisation?: string | null;
  email?: string;
  /** The matrix as on screen (absent: the client's saved access). */
  projects?: ClientGrant[];
}

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
  /**
   * Owner, 10 Nov 2026: of these team members, those who can open the task (the one a client's reply answers hears it
   * even when not following the task). Absent: only the people `teamOf` names.
   */
  visibleTeam?: (taskId: string, userIds: string[], actorId: string) => Promise<string[]>;
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
  /** 1.23.7: a client's upload, through the staff uploads' own rules (size, type, contents, the task's quota). */
  uploadFile?: (taskId: string, clientId: string, file: { filename: string; mimeType: string; content: Buffer }) => Promise<{ id: string; filename: string }>;
  /** 1.23.7: a stored file's bytes (a download through the portal). */
  readFile?: (storageKey: string) => Promise<Buffer>;
  /** 1.23.7: the client's notification switches. */
  noticeSettings?: { settingsOf(userId: string): Promise<NoticeSettings>; setSettings(userId: string, patch: Partial<NoticeSettings>): Promise<NoticeSettings> };
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
}

/** A file on a task, as the portal reads it. */
const fileSelect = { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedById: true, fromClient: true, clientVisible: true } as const satisfies Prisma.AttachmentSelect;

/** One notice on a client's bell, as the portal shows it. */
export interface PortalNoticeItem {
  id: string;
  kind: 'reply' | 'signOff' | 'document' | 'minutes' | 'invitation';
  title: string;
  /** A file's name for a document; nothing else. */
  body: string | null;
  project: { id: string; name: string };
  taskId: string | null;
  meetingId: string | null;
  read: boolean;
  createdAt: string;
}
const NOTICE_KIND: Record<string, PortalNoticeItem['kind']> = { REPLY: 'reply', SIGN_OFF: 'signOff', DOCUMENT: 'document', MINUTES: 'minutes', INVITATION: 'invitation' };
/** The bell shows at most this many; the unread count is of what it could show. */
const BELL_SIZE = 50;

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

const grantSelect = GRANT_COLUMNS;

/** Who a read is for: a signed-in client, or a preview (read only). */
export interface PortalViewer {
  client: PortalClient;
  preview: boolean;
  /** Their grant for this live project (404 when there is none, or the project is gone or archived). */
  grantFor(projectId: unknown): Promise<{ grant: GrantRow; project: ProjectRow }>;
  /** Every grant with a live project. */
  grants(): Promise<{ grant: GrantRow; project: ProjectRow }[]>;
}

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

  /** A signed-in client: their saved grants, read on every request. */
  async function viewerOf(userId: string): Promise<PortalViewer> {
    const client = await clientOf(userId);
    return {
      client,
      preview: false,
      grantFor: (projectId) => projectFor(client.id, projectId),
      grants: async () => {
        const rows = await prisma.clientProjectGrant.findMany({ where: { userId: client.id }, select: { ...grantSelect, project: { select: projectSelect } } });
        return rows.filter((r) => isLive(r.project)).map(({ project, ...grant }) => ({ grant, project }));
      },
    };
  }

  /**
   * 1.23.7 Preview as client (administrators): the portal as this client would see it with these grants —
   * their saved ones, or the matrix still on screen. Nothing is written; a client not saved yet reads as
   * nobody (no comments, invitations or action items of their own).
   */
  async function previewViewer(spec: PreviewSpec): Promise<PortalViewer> {
    const account = spec.clientId
      ? await prisma.user.findFirst({
          where: { id: spec.clientId, deletedAt: null, roles: { some: { role: { name: CLIENT_ROLE } } } },
          select: { id: true, firstName: true, lastName: true, email: true, organisation: true, clientGrants: { select: grantSelect } },
        })
      : null;
    if (spec.clientId && !account) throw new NotFoundError('Client not found.');
    if (!spec.projects && !account) throw new ValidationError('Say which projects to preview.', { field: 'projects' });
    const rows: GrantRow[] = spec.projects ? grantRows(spec.projects) : (account?.clientGrants ?? []);
    const projects = rows.length ? await prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: projectSelect }) : [];
    const byId = new Map(projects.map((p) => [p.id, p]));
    if (spec.projects && rows.some((r) => !byId.get(r.projectId) || byId.get(r.projectId)!.deletedAt !== null)) throw new ValidationError(GRANT_WORDS.unknownProject, { field: 'projects' });
    const live = rows.flatMap((grant) => {
      const project = byId.get(grant.projectId);
      return project && isLive(project) ? [{ grant, project }] : [];
    });
    const client: PortalClient = {
      id: account?.id ?? PREVIEW_NOBODY,
      firstName: spec.firstName ?? account?.firstName ?? '',
      lastName: spec.lastName ?? account?.lastName ?? '',
      email: spec.email ?? account?.email ?? '',
      organisation: spec.organisation !== undefined ? spec.organisation : (account?.organisation ?? null),
    };
    return {
      client,
      preview: true,
      grants: async () => live,
      grantFor: async (projectId) => {
        const hit = typeof projectId === 'string' ? live.find((l) => l.grant.projectId === projectId) : undefined;
        if (!hit) throw notFound();
        return hit;
      },
    };
  }

  /** A gate for one project and module (steps 1–3), for a signed-in client (their id) or a preview. */
  async function open(who: string | PortalViewer, projectId: unknown, module?: PortalModule) {
    const viewer = typeof who === 'string' ? await viewerOf(who) : who;
    const { grant, project } = await viewer.grantFor(projectId);
    if (module) needModule(grant, module);
    return { client: viewer.client, grant, project, viewer };
  }
  /** A write: only ever a signed-in client's own (a preview has no writes). */
  const writer = (userId: string) => {
    if (typeof userId !== 'string' || !userId) throw new HttpError('The Client portal is for client accounts.', 'CLIENTS_ONLY', 403);
    return userId;
  };

  /** The files of a shared task a client may see (shown to clients, or their own uploads). */
  const filesOf = (taskId: string, clientId: string): Promise<PortalFileSource[]> =>
    prisma.attachment.findMany({ where: { taskId, OR: [{ clientVisible: true }, { fromClient: true, uploadedById: clientId }] }, select: fileSelect, orderBy: { createdAt: 'asc' } });

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
  async function tellTeam(taskId: string, projectId: string, clientId: string, notice: { type: string; title: string; body: string | null }, event?: string, except: string[] = []): Promise<void> {
    try {
      const userIds = (await deps.teamOf(taskId, clientId)).filter((id) => !except.includes(id));
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

  /** Of these meetings of the project, the ones the client may see (the same rule as meetingsFor, ids only). */
  async function visibleMeetingIds(clientId: string, projectId: string, ids: string[]): Promise<Set<string>> {
    const rows = await prisma.meeting.findMany({
      where: {
        id: { in: ids },
        projectId,
        deletedAt: null,
        OR: [{ status: { not: 'DRAFT' }, attendees: { some: { userId: clientId, invitedAt: { not: null } } } }, { minutes: { is: shownMinutesWhere(projectId) } }],
      },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
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

  /** The bell: their notices (newest first) that still point at something they may open. */
  async function noticesOf(viewer: PortalViewer): Promise<{ items: PortalNoticeItem[]; unread: number }> {
    const rows = await prisma.clientNotice.findMany({ where: { userId: viewer.client.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
    const grants = new Map((await viewer.grants()).map((g) => [g.grant.projectId, g]));
    const projectIds = [...new Set(rows.map((r) => r.projectId))].filter((p) => grants.has(p));
    const taskIds = [...new Set(rows.flatMap((r) => (r.taskId ? [r.taskId] : [])))];
    const shownTasks = taskIds.length
      ? new Set((await prisma.task.findMany({ where: { id: { in: taskIds }, projectId: { in: projectIds }, deletedAt: null, clientVisible: true }, select: { id: true, projectId: true } })).map((t) => `${t.projectId}|${t.id}`))
      : new Set<string>();
    const fileIds = [...new Set(rows.flatMap((r) => (r.attachmentId ? [r.attachmentId] : [])))];
    const files = fileIds.length ? await prisma.attachment.findMany({ where: { id: { in: fileIds } }, select: { id: true, taskId: true, clientVisible: true, fromClient: true, uploadedById: true } }) : [];
    const seeFile = new Map(files.map((f) => [f.id, clientMaySeeFile(f, viewer.client.id) ? f.taskId : null]));
    // The meetings they may see among the notices' (ids only: the bell is read every minute — review minor 4).
    const meetingsOf = new Map<string, Set<string>>();
    for (const p of projectIds) {
      const asked = [...new Set(rows.filter((r) => r.projectId === p && r.meetingId).map((r) => r.meetingId!))];
      if (!grants.get(p)!.grant.meetings || asked.length === 0) continue;
      meetingsOf.set(p, await visibleMeetingIds(viewer.client.id, p, asked));
    }
    const visible = rows.filter((r) => {
      const g = grants.get(r.projectId)?.grant;
      if (!g) return false;
      // What the kind needs on the grant now (a reply goes with Comment, a sign-off with Sign off — minor 7).
      if (r.kind === 'REPLY' && !actionsOf(g).comment) return false;
      if (r.kind === 'SIGN_OFF' && !actionsOf(g).signOff) return false;
      if (r.taskId) {
        if (!g.progress || !shownTasks.has(`${r.projectId}|${r.taskId}`)) return false;
        if (r.attachmentId && seeFile.get(r.attachmentId) !== r.taskId) return false;
        return true;
      }
      if (r.meetingId) return g.meetings && (meetingsOf.get(r.projectId)?.has(r.meetingId) ?? false);
      return false;
    });
    return {
      unread: visible.filter((r) => r.readAt === null).length,
      items: visible.slice(0, BELL_SIZE).map((r) => ({
        id: r.id,
        kind: NOTICE_KIND[r.kind] ?? 'reply',
        title: r.title,
        body: r.kind === 'DOCUMENT' ? r.body : null,
        project: { id: r.projectId, name: grants.get(r.projectId)!.project.name },
        taskId: r.taskId,
        meetingId: r.meetingId,
        read: r.readAt !== null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** The projects whose notices reach them, and their own switches (the portal's settings page). */
  async function settingsFor(viewer: PortalViewer) {
    const settings = deps.noticeSettings ? await deps.noticeSettings.settingsOf(viewer.client.id) : { reply: true, signOff: true, minutes: true, document: true };
    const projects = (await viewer.grants())
      .map(({ grant, project }) => ({ id: project.id, name: project.name, notify: actionsOf(grant).notify }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { settings, projects };
  }

  return {
    clientOf,
    /** 1.23.7 Preview as client: the reads below for a preview (administrators; nothing is written). */
    previewViewer,

    /** Home: the client and their live projects, as cards. */
    async home(who: string | PortalViewer) {
      const viewer = typeof who === 'string' ? await viewerOf(who) : who;
      const client = viewer.client;
      const live = (await viewer.grants()).sort((a, b) => a.project.name.localeCompare(b.project.name));
      const cards = await Promise.all(
        live.map(async ({ project, grant }) => portalCard(toProjectSource(project), grant, grant.progress ? await counts(project.id) : null)),
      );
      return {
        me: { name: `${client.firstName} ${client.lastName}`.trim(), email: client.email, organisation: client.organisation ?? null },
        projects: cards,
        timeZone: deps.timeZone,
      };
    },

    /** A project page: its look and, with the Progress module, the progress, milestones and shared tasks. */
    async project(who: string | PortalViewer, projectId: unknown) {
      const { grant, project } = await open(who, projectId);
      const [c, tasks] = grant.progress
        ? await Promise.all([counts(project.id), prisma.task.findMany({ where: { projectId: project.id, deletedAt: null, clientVisible: true }, select: taskSelect })])
        : [null, [] as TaskRow[]];
      return portalProject({ project: toProjectSource(project), grant, counts: c, tasks: tasks.map(toTaskSource), timeZone: deps.timeZone, now: now() });
    },

    /** One shared task, with the client's comment thread (when they may comment) and its files they may see. */
    async task(who: string | PortalViewer, projectId: unknown, taskId: unknown) {
      const { client, grant, project } = await open(who, projectId, 'progress');
      const t = await sharedTask(project.id, taskId);
      const comments = actionsOf(grant).comment ? await threadOf(t.id, client.id) : null;
      return portalTaskView(toTaskSource(t), grant, comments, client.id, deps.timeZone, now(), await filesOf(t.id, client.id));
    },

    /**
     * 1.23.7 Upload a document to a shared task (the Upload permission). The file goes on the task for the
     * team, marked "From client"; other clients see it only once the team ticks "Show to client". The
     * file is read only after the gate (`read`), and is checked like a staff upload (size, type, contents).
     */
    async upload(userId: string, projectId: unknown, taskId: unknown, read: () => Promise<{ filename: string; mimeType: string; content: Buffer } | null>, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(writer(userId), projectId, 'progress');
      needAction(grant, 'upload');
      const t = await sharedTask(project.id, taskId);
      if (!deps.uploadFile) throw new HttpError('Uploads aren’t available here.', 'UNAVAILABLE', 503);
      const file = await read();
      if (!file) throw new ValidationError('No file uploaded.');
      const rec = await deps.uploadFile(t.id, client.id, file);
      await activity({ taskId: t.id, userId: client.id, action: 'ATTACHED', meta: { filename: rec.filename, client: true } });
      await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.file.upload', entityId: t.id, newValue: { projectId: project.id, attachmentId: rec.id, filename: rec.filename } });
      await tellTeam(t.id, project.id, client.id, { type: 'TASK_COMMENT', title: 'A client uploaded a document', body: `${t.key} ${t.title}: ${rec.filename}`.slice(0, 500) });
      return portalTaskView(toTaskSource(t), grant, actionsOf(grant).comment ? await threadOf(t.id, client.id) : null, client.id, deps.timeZone, now(), await filesOf(t.id, client.id));
    },

    /** 1.23.7 A file of a shared task the client may see (View tasks): its bytes, never where it is stored. */
    async file(userId: string, projectId: unknown, taskId: unknown, fileId: unknown, meta: { ip?: string | null } = {}) {
      const { client, project } = await open(writer(userId), projectId, 'progress');
      const t = await sharedTask(project.id, taskId);
      if (typeof fileId !== 'string' || !fileId) throw notFound();
      const f = await prisma.attachment.findFirst({ where: { id: fileId, taskId: t.id }, select: { ...fileSelect, storageKey: true } });
      if (!f || !clientMaySeeFile(f, client.id) || !deps.readFile) throw notFound();
      const content = await deps.readFile(f.storageKey).catch(() => null);
      if (!content) throw notFound();
      await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.file.download', entityId: f.id, newValue: { projectId: project.id, taskId: t.id } });
      return { content, filename: f.filename, mimeType: f.mimeType };
    },

    /** 1.23.7 The bell: notices that still point at something they may open, and how many are unread. */
    async notices(who: string | PortalViewer) {
      return noticesOf(typeof who === 'string' ? await viewerOf(who) : who);
    },

    /** Mark one notice read (their own; anyone else's is 404). */
    async readNotice(userId: string, noticeId: unknown) {
      const viewer = await viewerOf(writer(userId));
      if (typeof noticeId !== 'string' || !noticeId) throw notFound();
      const { count } = await prisma.clientNotice.updateMany({ where: { id: noticeId, userId: viewer.client.id, readAt: null }, data: { readAt: now() } });
      if (count === 0 && !(await prisma.clientNotice.count({ where: { id: noticeId, userId: viewer.client.id } }))) throw notFound();
      return { unread: (await noticesOf(viewer)).unread };
    },

    /** Mark every notice read. */
    async readAllNotices(userId: string) {
      const viewer = await viewerOf(writer(userId));
      await prisma.clientNotice.updateMany({ where: { userId: viewer.client.id, readAt: null }, data: { readAt: now() } });
      return { unread: 0 };
    },

    /** Their notification switches and which of their projects send notices. */
    async settings(who: string | PortalViewer) {
      return settingsFor(typeof who === 'string' ? await viewerOf(who) : who);
    },

    /** Switch kinds of notice on or off (their own). */
    async setSettings(userId: string, patch: Partial<NoticeSettings>, meta: { ip?: string | null } = {}) {
      const viewer = await viewerOf(writer(userId));
      if (!deps.noticeSettings) throw new HttpError('Settings aren’t available here.', 'UNAVAILABLE', 503);
      await deps.noticeSettings.setSettings(viewer.client.id, patch);
      await record({ userId: viewer.client.id, ip: meta.ip ?? null, action: 'portal.settings.notifications', entityId: viewer.client.id, newValue: patch });
      return settingsFor(viewer);
    },

    /**
     * Comment on a shared task (the Comment action). The team sees it marked "Client". Owner, 10 Nov 2026: `replyTo` —
     * a reply to a comment they can see (their own, or the team's reply shown to them), filed in that thread (one level
     * deep: their own comment's); anything they can't see is "not found". The team member answered hears it.
     */
    async comment(userId: string, projectId: unknown, taskId: unknown, body: string, meta: { ip?: string | null } = {}, replyTo?: unknown) {
      const { client, grant, project } = await open(writer(userId), projectId, 'progress');
      needAction(grant, 'comment');
      const t = await sharedTask(project.id, taskId);
      let answered: { id: string; userId: string; parentId: string | null; fromClient: boolean } | null = null;
      if (replyTo !== undefined && replyTo !== null) {
        answered = typeof replyTo === 'string' ? ((await threadOf(t.id, client.id)).find((c) => c.id === replyTo) ?? null) : null;
        if (!answered) throw notFound();
      }
      const parentId = answered ? (answered.parentId ?? answered.id) : null;
      const c = await prisma.comment.create({ data: { taskId: t.id, userId: client.id, body, fromClient: true, parentId } });
      await activity({ taskId: t.id, userId: client.id, action: 'COMMENTED', meta: { commentId: c.id, client: true } });
      await record({ userId: client.id, ip: meta.ip ?? null, action: 'portal.comment', entityId: t.id, newValue: { projectId: project.id, commentId: c.id, ...(parentId ? { replyTo: answered!.id } : {}) } });
      try {
        deps.broadcast?.(project.id, 'comment:created', { taskId: t.id, comment: { id: c.id, taskId: t.id, userId: client.id, body: c.body, parentId, editedAt: null, createdAt: c.createdAt, fromClient: true, clientVisible: false } });
      } catch {
        /* open boards are best effort */
      }
      // The team member whose reply they answered: "<name> replied to your comment" (once — not the team notice too).
      const told: string[] = [];
      if (answered && !answered.fromClient) {
        const who = answered.userId;
        told.push(who);
        try {
          const may = deps.visibleTeam ? await deps.visibleTeam(t.id, [who], client.id) : await deps.teamOf(t.id, client.id);
          const name = `${client.firstName} ${client.lastName}`.trim() || 'A client';
          if (may.includes(who)) await deps.notify({ userIds: [who], taskId: t.id, type: 'TASK_COMMENT', title: `${name} replied to your comment`, body: `${t.key} ${t.title}` });
        } catch (err) {
          deps.logger?.warn('client portal: the one answered could not be told', { err, taskId: t.id });
        }
      }
      await tellTeam(t.id, project.id, client.id, { type: 'TASK_COMMENT', title: parentId ? 'A client replied on a task' : 'A client commented on a task', body: `${t.key} ${t.title}` }, undefined, told);
      return portalTaskView(toTaskSource(t), grant, await threadOf(t.id, client.id), client.id, deps.timeZone, now(), await filesOf(t.id, client.id));
    },

    /** Accept a finished shared task (the Sign off action): "Client accepted · date" for the team. */
    async accept(userId: string, projectId: unknown, taskId: unknown, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(writer(userId), projectId, 'progress');
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
      return portalTaskView(toTaskSource(fresh), grant, actionsOf(grant).comment ? await threadOf(t.id, client.id) : null, client.id, deps.timeZone, now(), await filesOf(t.id, client.id));
    },

    /** Send a finished shared task back (the Sign off action): back to In progress, the reason as their comment. */
    async sendBack(userId: string, projectId: unknown, taskId: unknown, reason: string, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(writer(userId), projectId, 'progress');
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
      return portalTaskView(toTaskSource(fresh), grant, actionsOf(grant).comment ? await threadOf(t.id, client.id) : null, client.id, deps.timeZone, now(), await filesOf(t.id, client.id));
    },

    /** The project's client task list as a PDF (the Download action, with the Progress module). */
    async taskListPdf(userId: string, projectId: unknown, meta: { ip?: string | null } = {}) {
      const { client, grant, project } = await open(writer(userId), projectId, 'progress');
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
    async meetings(who: string | PortalViewer, projectId: unknown) {
      const { client, project } = await open(who, projectId, 'meetings');
      return (await meetingsFor(client.id, project.id)).map((m) => portalMeetingItem(m, deps.timeZone));
    },

    /** One meeting: per the invitee rules, its shown minutes, their own action items. */
    async meeting(who: string | PortalViewer, projectId: unknown, meetingId: unknown) {
      const { client, grant, project } = await open(who, projectId, 'meetings');
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
      const { client, grant, project } = await open(writer(userId), projectId, 'meetings');
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
      const { client, grant, project } = await open(writer(userId), projectId, 'meetings');
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
      const { client, grant, project } = await open(writer(userId), projectId, 'meetings');
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
