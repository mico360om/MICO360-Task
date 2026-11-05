import type { PrismaClient, Comment } from '@prisma/client';
import type { CommentRepository } from './comment-repository';
import { projectAudienceIds } from './prisma-assignee-repository';

type Author = { firstName: string; lastName: string; username: string; organisation: string | null } | null | undefined;
function toRecord(c: Comment & { user?: Author }) {
  return {
    id: c.id,
    taskId: c.taskId,
    userId: c.userId,
    body: c.body,
    parentId: c.parentId,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
    fromClient: c.fromClient,
    clientVisible: c.clientVisible,
    // 1.23: a client's comment carries its writer's name (client accounts aren't in the people directory).
    ...(c.fromClient && c.user ? { clientAuthor: { name: `${c.user.firstName} ${c.user.lastName}`.trim() || c.user.username, organisation: c.user.organisation ?? null } } : {}),
  };
}
const withAuthor = { user: { select: { firstName: true, lastName: true, username: true, organisation: true } } } as const;

export function createPrismaCommentRepository(prisma: PrismaClient): CommentRepository {
  return {
    async create(taskId, userId, body, parentId, extra) {
      return toRecord(await prisma.comment.create({ data: { taskId, userId, body, parentId: parentId ?? null, ...(extra?.clientVisible ? { clientVisible: true } : {}), ...(extra?.fromClient ? { fromClient: true } : {}) }, include: withAuthor }));
    },
    async findById(id) {
      const c = await prisma.comment.findFirst({ where: { id, deletedAt: null }, include: withAuthor });
      return c ? toRecord(c) : null;
    },
    async list(taskId) {
      const cs = await prisma.comment.findMany({ where: { taskId, deletedAt: null }, orderBy: { createdAt: 'asc' }, include: withAuthor });
      return cs.map(toRecord);
    },
    async update(id, body) {
      return toRecord(await prisma.comment.update({ where: { id }, data: { body, editedAt: new Date() }, include: withAuthor }));
    },
    async delete(id) {
      await prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
    },
    async listMentionable(taskId) {
      const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { projectId: true } });
      if (!task) return [];
      const ids = await projectAudienceIds(prisma, task.projectId);
      if (ids.length === 0) return [];
      return prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true },
        orderBy: [{ firstName: 'asc' }, { username: 'asc' }],
      });
    },
    async listMentionableUsernames(taskId) {
      const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { projectId: true } });
      if (!task) return [];
      const ids = await projectAudienceIds(prisma, task.projectId);
      if (ids.length === 0) return [];
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { username: true } });
      return users.map((u) => u.username);
    },
  };
}
