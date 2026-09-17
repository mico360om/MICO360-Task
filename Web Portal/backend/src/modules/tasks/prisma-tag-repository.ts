import type { PrismaClient } from '@prisma/client';
import type { TagRepository } from './tag-repository';
import { paletteColorFor } from './tag-repository';

export function createPrismaTagRepository(prisma: PrismaClient): TagRepository {
  return {
    async listCatalog() {
      const rows = await prisma.tag.findMany({ orderBy: { name: 'asc' } });
      return rows.map((t) => ({ id: t.id, name: t.name, color: t.color }));
    },
    async findOrCreateByName(name, color) {
      // Tag.name is unique; upsert is atomic find-or-create.
      const tag = await prisma.tag.upsert({
        where: { name },
        update: {},
        create: { name, color: color ?? paletteColorFor(name) },
      });
      return { id: tag.id, name: tag.name, color: tag.color };
    },
    async listForTask(taskId) {
      const rows = await prisma.taskTag.findMany({
        where: { taskId },
        include: { tag: true },
        orderBy: { tag: { name: 'asc' } },
      });
      return rows.map((r) => ({ id: r.tag.id, name: r.tag.name, color: r.tag.color }));
    },
    async setForTask(taskId, tagIds) {
      // Replace the whole set atomically.
      await prisma.$transaction([
        prisma.taskTag.deleteMany({ where: { taskId } }),
        ...(tagIds.length > 0
          ? [prisma.taskTag.createMany({ data: tagIds.map((tagId) => ({ taskId, tagId })), skipDuplicates: true })]
          : []),
      ]);
    },
    async removeFromTask(taskId, tagId) {
      await prisma.taskTag.deleteMany({ where: { taskId, tagId } });
    },
  };
}
