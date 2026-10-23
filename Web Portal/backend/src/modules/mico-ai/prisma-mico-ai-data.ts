import type { PrismaClient } from '@prisma/client';
import { noteText } from '../../lib/rich-text';
import type { FinalMinutesRepository } from '../meetings/final-minutes-repository';
import type {
  AiActivityRec,
  AiMeetingRec,
  AiMembershipRec,
  AiTaskLink,
  AiTaskRec,
  MicoAiDataPort,
  Viewer,
} from './mico-ai-data';

/**
 * MICO AI's reads from the database. Scope comes from the app's own rules: the project-access
 * rule for projects and tasks, the meeting-access rule for a meeting, and the chat module's list of
 * conversations a person can open. Read-only: nothing here writes.
 */
export interface PrismaMicoAiDataDeps {
  prisma: PrismaClient;
  projectAccess: { accessibleProjectIds(userId: string, roles: string[]): Promise<string[] | null> };
  meetingAccess: {
    canViewMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean>;
    /** Who may change a meeting (organizer, creator, its project's managers, admins): a draft Final MOM is theirs only. */
    canEditMeeting(userId: string, roles: string[], meetingId: string): Promise<boolean>;
  };
  /** The conversations the chat module lets this person open (chat service's accessibleConversationIds). */
  conversationIdsFor: (userId: string) => Promise<string[]>;
  finalMinutes?: FinalMinutesRepository;
}

/** A bound on any one read, so a huge workspace can't make one question load everything. */
const MAX_TASKS = 20_000;
const OPEN_ACTIONS = { notIn: ['COMPLETED', 'CANCELLED'] as Array<'COMPLETED' | 'CANCELLED'> };
const CLOSED_ACTIONS = { in: ['COMPLETED', 'CANCELLED'] as Array<'COMPLETED' | 'CANCELLED'> };

const isAdmin = (v: Viewer) => v.roles.includes('ADMIN');

export function createPrismaMicoAiData({ prisma, projectAccess, meetingAccess, conversationIdsFor, finalMinutes }: PrismaMicoAiDataDeps): MicoAiDataPort {
  const inScope = (ids: string[] | null) => (ids === null ? {} : { projectId: { in: ids } });

  const taskInclude = { project: { select: { name: true } }, column: { select: { name: true, category: true } }, assignees: { select: { userId: true } } } as const;
  type TaskRow = Awaited<ReturnType<typeof prisma.task.findMany<{ include: typeof taskInclude }>>>[number];
  const toTask = (t: TaskRow): AiTaskRec => ({
    id: t.id,
    key: t.key,
    title: t.title,
    projectId: t.projectId,
    projectName: t.project.name,
    columnName: t.column.name,
    category: t.column.category,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    // As the Reports page reads it: a task in a Done column without a completion time finished at its last update.
    completedAt: t.completedAt ?? (t.column.category === 'DONE' ? t.updatedAt : null),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    progress: t.progress,
    isMilestone: t.isMilestone,
    assigneeIds: t.assignees.map((a) => a.userId),
  });
  const link = (t: { id: string; key: string; title: string; projectId: string; column: { category: string; name: string } }): AiTaskLink => ({
    id: t.id,
    key: t.key,
    title: t.title,
    projectId: t.projectId,
    category: t.column.category,
    columnName: t.column.name,
  });

  /** The meeting rule as a query: organizer, creator or attendee, or someone who can see its project (admins: all). */
  const visibleMeetings = (viewer: Viewer, projectIds: string[] | null) =>
    isAdmin(viewer)
      ? {}
      : {
          OR: [
            { organizerId: viewer.userId },
            { createdById: viewer.userId },
            { attendees: { some: { userId: viewer.userId } } },
            ...(projectIds && projectIds.length ? [{ projectId: { in: projectIds } }] : []),
          ],
        };
  const meetingInclude = { attendees: { select: { userId: true } } } as const;
  type MeetingRow = Awaited<ReturnType<typeof prisma.meeting.findMany<{ include: typeof meetingInclude }>>>[number];
  async function toMeetings(rows: MeetingRow[]): Promise<AiMeetingRec[]> {
    const counts = await meetingCounts(rows.map((m) => m.id));
    return rows.map((m) => ({
      id: m.id,
      title: m.title,
      projectId: m.projectId,
      organizerId: m.organizerId,
      createdById: m.createdById,
      attendeeUserIds: m.attendees.map((a) => a.userId).filter((x): x is string => !!x),
      startAt: m.startAt,
      endAt: m.endAt,
      status: m.status,
      location: m.location,
      decisions: counts.decisions.get(m.id) ?? 0,
      openActionItems: counts.open.get(m.id) ?? 0,
    }));
  }

  async function meetingCounts(ids: string[]) {
    if (!ids.length) return { decisions: new Map<string, number>(), open: new Map<string, number>() };
    const [decisions, open] = await Promise.all([
      prisma.meetingNote.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, deletedAt: null, type: 'DECISION' }, _count: { _all: true } }),
      prisma.actionItem.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, status: OPEN_ACTIONS }, _count: { _all: true } }),
    ]);
    return {
      decisions: new Map(decisions.map((d) => [d.meetingId, d._count._all])),
      open: new Map(open.filter((o) => o.meetingId).map((o) => [o.meetingId!, o._count._all])),
    };
  }

  return {
    accessibleProjectIds: (v) => projectAccess.accessibleProjectIds(v.userId, v.roles),

    async projects(ids) {
      const rows = await prisma.project.findMany({
        where: { deletedAt: null, ...(ids === null ? {} : { id: { in: ids } }) },
        select: { id: true, code: true, number: true, name: true, status: true, clientName: true, description: true, startDate: true, targetDate: true, managerId: true, ownerId: true },
      });
      return rows;
    },

    async tasks({ projectIds, projectId, assigneeId }) {
      if (projectIds !== null && projectIds.length === 0) return [];
      const rows = await prisma.task.findMany({
        where: {
          deletedAt: null,
          project: { is: { deletedAt: null } },
          ...inScope(projectIds),
          ...(projectId ? { projectId } : {}),
          ...(assigneeId ? { assignees: { some: { userId: assigneeId } } } : {}),
        },
        include: taskInclude,
        orderBy: { updatedAt: 'desc' },
        take: MAX_TASKS,
      });
      // Both filters again (a narrower projectId never widens the scope).
      return rows.filter((t) => projectIds === null || projectIds.includes(t.projectId)).map(toTask);
    },

    async findTask(projectIds, keyOrId) {
      if (projectIds !== null && projectIds.length === 0) return null;
      const t = await prisma.task.findFirst({
        where: { deletedAt: null, project: { is: { deletedAt: null } }, ...inScope(projectIds), OR: [{ id: keyOrId }, { key: keyOrId.toUpperCase() }] },
        include: taskInclude,
      });
      return t && (projectIds === null || projectIds.includes(t.projectId)) ? toTask(t) : null;
    },

    async taskProjectIds(ids) {
      if (!ids.length) return new Map();
      const rows = await prisma.task.findMany({ where: { id: { in: ids }, deletedAt: null, project: { is: { deletedAt: null } } }, select: { id: true, projectId: true } });
      return new Map(rows.map((t) => [t.id, t.projectId]));
    },

    async taskExtras(taskId) {
      const linkSelect = { id: true, key: true, title: true, projectId: true, deletedAt: true, column: { select: { category: true, name: true } } } as const;
      const [task, checklist, comments, activity, blockedBy, blocks] = await Promise.all([
        prisma.task.findUnique({ where: { id: taskId }, select: { description: true, meetingId: true } }),
        prisma.checklistItem.findMany({ where: { taskId }, orderBy: { position: 'asc' }, select: { text: true, done: true } }),
        prisma.comment.findMany({ where: { taskId, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { userId: true, body: true, createdAt: true }, take: 200 }),
        prisma.activity.findMany({ where: { taskId }, orderBy: { createdAt: 'desc' }, take: 60, include: { task: { select: { id: true, key: true, title: true } } } }),
        prisma.taskDependency.findMany({ where: { taskId }, select: { dependsOn: { select: linkSelect } } }),
        prisma.taskDependency.findMany({ where: { dependsOnTaskId: taskId }, select: { task: { select: linkSelect } } }),
      ]);
      const meeting = task?.meetingId ? await prisma.meeting.findFirst({ where: { id: task.meetingId, deletedAt: null }, select: { id: true, title: true, startAt: true } }) : null;
      return {
        description: task?.description ?? null,
        checklist,
        comments,
        activity: activity.map((a): AiActivityRec => ({ id: a.id, taskId: a.taskId, projectId: a.projectId, userId: a.userId, action: a.action, meta: a.meta, createdAt: a.createdAt, task: a.task })),
        blockedBy: blockedBy.map((d) => d.dependsOn).filter((t) => !t.deletedAt).map(link),
        blocks: blocks.map((d) => d.task).filter((t) => !t.deletedAt).map(link),
        meeting,
      };
    },

    async activity({ projectIds, projectId, from, to, limit }) {
      if (projectIds !== null && projectIds.length === 0) return { rows: [], total: 0 };
      const where = { createdAt: { gte: from, lte: to }, ...inScope(projectIds), ...(projectId ? { projectId } : {}), OR: [{ taskId: null }, { task: { is: { deletedAt: null } } }] };
      const [rows, total] = await Promise.all([
        prisma.activity.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, include: { task: { select: { id: true, key: true, title: true } } } }),
        prisma.activity.count({ where }),
      ]);
      return { rows: rows.map((a) => ({ id: a.id, taskId: a.taskId, projectId: a.projectId, userId: a.userId, action: a.action, meta: a.meta, createdAt: a.createdAt, task: a.task })), total };
    },

    async meetings(viewer, { projectIds, projectId, from, to, limit, text, around }) {
      const where = { deletedAt: null, startAt: { gte: from, lte: to }, ...(projectId ? { projectId } : {}), ...(text ? { title: { contains: text } } : {}), ...visibleMeetings(viewer, projectIds) };
      // Nearest first: the coming ones soonest first, then the past ones latest first.
      const [upcoming, past, total] = await Promise.all([
        prisma.meeting.findMany({ where: { AND: [where, { startAt: { gte: around } }] }, orderBy: { startAt: 'asc' }, take: limit, include: meetingInclude }),
        prisma.meeting.findMany({ where: { AND: [where, { startAt: { lt: around } }] }, orderBy: { startAt: 'desc' }, take: limit, include: meetingInclude }),
        prisma.meeting.count({ where }),
      ]);
      return { rows: await toMeetings([...upcoming, ...past].slice(0, limit)), total };
    },

    async meetingsByIds(ids) {
      if (!ids.length) return [];
      return toMeetings(await prisma.meeting.findMany({ where: { id: { in: ids }, deletedAt: null }, include: meetingInclude }));
    },

    canViewMeeting: (v, meetingId) => meetingAccess.canViewMeeting(v.userId, v.roles, meetingId),
    canEditMeeting: (v, meetingId) => meetingAccess.canEditMeeting(v.userId, v.roles, meetingId),

    async meetingDetail(meetingId) {
      const m = await prisma.meeting.findFirst({
        where: { id: meetingId, deletedAt: null },
        include: {
          attendees: { orderBy: { createdAt: 'asc' } },
          agendaItems: { orderBy: { position: 'asc' } },
          notes: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' }, include: { agendaItem: { select: { title: true } } } },
          actionItems: { orderBy: { createdAt: 'asc' } },
          decisions: { orderBy: { decidedOn: 'asc' } },
        },
      });
      if (!m) return null;
      const taskIds = m.actionItems.map((a) => a.taskId).filter((x): x is string => !!x);
      const keys = new Map(
        (taskIds.length ? await prisma.task.findMany({ where: { id: { in: taskIds }, deletedAt: null }, select: { id: true, key: true } }) : []).map((t) => [t.id, t.key]),
      );
      const fm = finalMinutes ? await finalMinutes.get(m.id) : null;
      const counts = await meetingCounts([m.id]);
      return {
        id: m.id,
        title: m.title,
        projectId: m.projectId,
        organizerId: m.organizerId,
        createdById: m.createdById,
        attendeeUserIds: m.attendees.map((a) => a.userId).filter((x): x is string => !!x),
        startAt: m.startAt,
        endAt: m.endAt,
        status: m.status,
        location: m.location,
        decisions: counts.decisions.get(m.id) ?? 0,
        openActionItems: counts.open.get(m.id) ?? 0,
        description: m.description,
        timeZone: m.timeZone,
        attendees: m.attendees.map((a) => ({ userId: a.userId, name: a.externalName, response: a.response, attendance: a.attendance })),
        agenda: m.agendaItems.map((a) => ({ title: a.title, ownerId: a.ownerId, minutes: a.expectedMinutes, completed: a.completed })),
        notes: m.notes.map((n) => ({ type: n.type, text: noteText({ body: n.body, bodyFormat: n.bodyFormat }), authorId: n.authorId, agendaTitle: n.agendaItem?.title ?? null, createdAt: n.createdAt })),
        actionItems: m.actionItems.map((a) => ({ description: a.description, assigneeId: a.assigneeId, dueDate: a.dueDate, status: a.status, taskId: a.taskId && keys.has(a.taskId) ? a.taskId : null, taskKey: a.taskId ? (keys.get(a.taskId) ?? null) : null })),
        decisionsList: m.decisions.map((d) => ({ title: d.title, description: d.description, status: d.status })),
        finalMinutes: fm ? { status: fm.status, ...fm.content } : null,
      };
    },

    async actionItems(viewer, { projectIds, projectId, from, to, assigneeId, status, limit }) {
      const where = {
        meeting: { is: { deletedAt: null, startAt: { gte: from, lte: to }, ...(projectId ? { projectId } : {}), ...visibleMeetings(viewer, projectIds) } },
        ...(assigneeId ? { assigneeId } : {}),
        ...(status === 'open' ? { status: OPEN_ACTIONS } : status === 'done' ? { status: CLOSED_ACTIONS } : {}),
      };
      // The latest meetings first: when there are more than fit, the recent ones are kept.
      const [rows, total] = await Promise.all([
        prisma.actionItem.findMany({ where, orderBy: [{ meeting: { startAt: 'desc' } }, { createdAt: 'asc' }], take: limit, include: { meeting: { include: meetingInclude } } }),
        prisma.actionItem.count({ where }),
      ]);
      const meetings = new Map((await toMeetings(rows.map((a) => a.meeting!).filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i))).map((m) => [m.id, m]));
      const taskIds = rows.map((a) => a.taskId).filter((x): x is string => !!x);
      const keys = new Map((taskIds.length ? await prisma.task.findMany({ where: { id: { in: taskIds }, deletedAt: null }, select: { id: true, key: true } }) : []).map((t) => [t.id, t.key]));
      return {
        rows: rows.map((a) => ({
          id: a.id,
          description: a.description,
          assigneeId: a.assigneeId,
          dueDate: a.dueDate,
          status: a.status,
          meetingId: a.meetingId!,
          taskId: a.taskId,
          taskKey: a.taskId ? (keys.get(a.taskId) ?? null) : null,
          meeting: meetings.get(a.meetingId!)!,
        })),
        total,
      };
    },

    async conversations(viewer) {
      const ids = await conversationIdsFor(viewer.userId);
      if (!ids.length) return [];
      const rows = await prisma.conversation.findMany({ where: { id: { in: ids } }, include: { participants: { select: { userId: true } } } });
      return rows.map((c) => ({ id: c.id, kind: c.kind, projectId: c.projectId, participantIds: c.participants.map((p) => p.userId) }));
    },

    async chatMessages({ conversationIds, text, senderIds, from, to, limit }) {
      if (!conversationIds.length) return { rows: [], total: 0 };
      const where = {
        conversationId: { in: conversationIds },
        deletedAt: null,
        ...(text ? { body: { contains: text } } : {}),
        ...(senderIds ? { userId: { in: senderIds } } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.chatMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, conversationId: true, userId: true, body: true, createdAt: true } }),
        prisma.chatMessage.count({ where }),
      ]);
      return { rows, total };
    },

    async people() {
      const rows = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, firstName: true, lastName: true, username: true, status: true }, take: 5000 });
      return rows.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, username: u.username, active: u.status === 'ACTIVE' }));
    },

    async memberships(ids) {
      if (ids !== null && ids.length === 0) return [];
      const projects = await prisma.project.findMany({
        where: { deletedAt: null, ...(ids === null ? {} : { id: { in: ids } }) },
        select: { id: true, ownerId: true, managerId: true, members: { select: { userId: true, role: true } } },
      });
      const out: AiMembershipRec[] = [];
      for (const p of projects) {
        const add = (userId: string | null, role: AiMembershipRec['role']) => {
          if (userId && !out.some((o) => o.projectId === p.id && o.userId === userId)) out.push({ projectId: p.id, userId, role });
        };
        add(p.ownerId, 'OWNER');
        add(p.managerId, 'MANAGER');
        for (const m of p.members) add(m.userId, m.role);
      }
      return out;
    },
  };
}
