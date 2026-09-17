import type { PrismaClient, KanbanColumn } from '@prisma/client';
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
    async remove(id) {
      const c = await prisma.kanbanColumn.delete({ where: { id } });
      return { projectId: c.projectId };
    },
  };
}
