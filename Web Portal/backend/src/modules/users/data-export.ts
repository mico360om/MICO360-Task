import type { PrismaClient } from '@prisma/client';

/**
 * "Download my data" (docs/DATA-POLICY.md, subject requests): everything the system holds that is
 * about or by one person, as one JSON document. Shared work other people created is left out except
 * where it gives context (a task's key and title). Deleted items are left out. Large histories are
 * capped at the most recent MAX_ROWS entries per section.
 */

export const MAX_ROWS = 5000;

export interface UserDataExport {
  exportedAt: string;
  profile: Record<string, unknown>;
  projects: unknown[];
  tasksAssignedToMe: unknown[];
  tasksICreated: unknown[];
  comments: unknown[];
  attachments: unknown[];
  chatMessages: unknown[];
  meetingNotes: unknown[];
  actionItems: unknown[];
  activity: unknown[];
  accountEvents: unknown[];
}

export type DataExporter = (userId: string) => Promise<UserDataExport | null>;

export function createPrismaDataExporter(prisma: PrismaClient): DataExporter {
  const taskSelect = {
    key: true,
    title: true,
    description: true,
    priority: true,
    startDate: true,
    dueDate: true,
    progress: true,
    completedAt: true,
    createdAt: true,
    project: { select: { code: true, name: true } },
    column: { select: { name: true, category: true } },
  } as const;

  return async (userId) => {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        status: true,
        timezone: true,
        locale: true,
        dateFormat: true,
        theme: true,
        notificationPrefs: true,
        lastActiveAt: true,
        createdAt: true,
        updatedAt: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) return null;

    const [projects, assigned, created, comments, attachments, chatMessages, meetingNotes, actionItems, activity, accountEvents] = await Promise.all([
      prisma.projectMember.findMany({
        where: { userId, project: { deletedAt: null } },
        select: { role: true, addedAt: true, project: { select: { code: true, name: true, status: true } } },
      }),
      prisma.taskAssignee.findMany({
        where: { userId, task: { deletedAt: null } },
        select: { assignedAt: true, task: { select: taskSelect } },
        take: MAX_ROWS,
        orderBy: { assignedAt: 'desc' },
      }),
      prisma.task.findMany({ where: { createdById: userId, deletedAt: null }, select: taskSelect, take: MAX_ROWS, orderBy: { createdAt: 'desc' } }),
      prisma.comment.findMany({
        where: { userId, deletedAt: null },
        select: { body: true, createdAt: true, editedAt: true, task: { select: { key: true, title: true } } },
        take: MAX_ROWS,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.attachment.findMany({
        where: { uploadedById: userId },
        select: { filename: true, mimeType: true, sizeBytes: true, url: true, createdAt: true, task: { select: { key: true, title: true } } },
        take: MAX_ROWS,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.chatMessage.findMany({
        where: { userId, deletedAt: null },
        select: { body: true, createdAt: true, editedAt: true, conversationId: true, conversation: { select: { kind: true } } },
        take: MAX_ROWS,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.meetingNote.findMany({
        where: { authorId: userId, deletedAt: null },
        select: { type: true, body: true, createdAt: true, editedAt: true, meeting: { select: { title: true, startAt: true } } },
        take: MAX_ROWS,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.actionItem.findMany({
        where: { OR: [{ assigneeId: userId }, { createdById: userId }] },
        select: { description: true, status: true, priority: true, dueDate: true, completedAt: true, createdAt: true, assigneeId: true, meeting: { select: { title: true } } },
        take: MAX_ROWS,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.activity.findMany({
        where: { userId },
        select: { action: true, meta: true, createdAt: true, task: { select: { key: true } }, project: { select: { code: true } } },
        take: MAX_ROWS,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.findMany({
        where: { OR: [{ userId }, { entityId: userId }] },
        select: { action: true, module: true, createdAt: true, ip: true },
        take: MAX_ROWS,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const { roles, ...profile } = user;
    return {
      exportedAt: new Date().toISOString(),
      profile: { ...profile, roles: roles.map((r) => r.role.name) },
      projects,
      tasksAssignedToMe: assigned.map(({ assignedAt, task }) => ({ ...task, assignedAt })),
      tasksICreated: created,
      comments,
      attachments,
      chatMessages: chatMessages.map(({ conversation, ...m }) => ({ ...m, conversationKind: conversation.kind })),
      meetingNotes,
      actionItems: actionItems.map(({ assigneeId, ...a }) => ({ ...a, assignedToMe: assigneeId === userId })),
      activity,
      accountEvents,
    };
  };
}
