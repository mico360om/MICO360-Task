import type { PrismaClient, Comment } from '@prisma/client';
import type { CommentRepository } from './comment-repository';

function toRecord(c: Comment) {
  return { id: c.id, taskId: c.taskId, userId: c.userId, body: c.body, parentId: c.parentId, editedAt: c.editedAt, createdAt: c.createdAt };
}

export function createPrismaCommentRepository(prisma: PrismaClient): CommentRepository {
  return {
    async create(taskId, userId, body, parentId) {
      return toRecord(await prisma.comment.create({ data: { taskId, userId, body, parentId: parentId ?? null } }));
    },
    async findById(id) {
      const c = await prisma.comment.findFirst({ where: { id, deletedAt: null } });
      return c ? toRecord(c) : null;
    },
    async list(taskId) {
      const cs = await prisma.comment.findMany({ where: { taskId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
      return cs.map(toRecord);
    },
    async update(id, body) {
      return toRecord(await prisma.comment.update({ where: { id }, data: { body, editedAt: new Date() } }));
    },
    async delete(id) {
      await prisma.comment.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  };
}
