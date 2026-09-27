import type { PrismaClient, KanbanColumn } from '@prisma/client';
import { ConflictError } from '../../lib/http-errors';
import type { ColumnRepository } from './column-repository';

function toRecord(c: KanbanColumn) {
  return { id: c.id, projectId: c.projectId, name: c.name, category: c.category, position: c.position, color: c.color, enabled: c.enabled };
}

export function createPrismaColumnRepository(prisma: PrismaClient): ColumnRepository {
  return {
    async listForProject(projectId) {
      const cs = await prisma.kanbanColumn.findMany({ where: { projectId }, orderBy: { position: 'asc' } });
      return cs.map(toRecord);
    },
    async create(data) {
      return toRecord(
        await prisma.kanbanColumn.create({
          data: {
            projectId: data.projectId,
            name: data.name,
            position: data.position,
            category: data.category ?? undefined,
            color: data.color ?? undefined,
          },
        }),
      );
    },
    async update(id, patch) {
      return toRecord(await prisma.kanbanColumn.update({ where: { id }, data: patch }));
    },
    async countLiveTasks(id) {
      return prisma.task.count({ where: { columnId: id, deletedAt: null } });
    },
    async remove(id) {
      return prisma.$transaction(async (tx) => {
        const column = await tx.kanbanColumn.findUnique({ where: { id }, select: { projectId: true } });
        if (!column) return null;
        // Re-checked inside the transaction: a task may have landed here since the caller looked.
        if ((await tx.task.count({ where: { columnId: id, deletedAt: null } })) > 0) {
          throw new ConflictError('This column still has tasks. Move them to another column first.', 'COLUMN_NOT_EMPTY');
        }
        // Soft-deleted tasks keep a (restricting) reference to their column; park them on another
        // column of the project so this one can go.
        if ((await tx.task.count({ where: { columnId: id } })) > 0) {
          const fallback = await tx.kanbanColumn.findFirst({
            where: { projectId: column.projectId, id: { not: id } },
            orderBy: { position: 'asc' },
            select: { id: true },
          });
          if (!fallback) {
            throw new ConflictError('A project needs at least one column. Add another column before deleting this one.', 'LAST_COLUMN');
          }
          await tx.task.updateMany({ where: { columnId: id, deletedAt: { not: null } }, data: { columnId: fallback.id } });
        }
        await tx.kanbanColumn.delete({ where: { id } });
        return { projectId: column.projectId };
      });
    },
  };
}
