import { Prisma, type PrismaClient } from '@prisma/client';
import type { RecurrenceTaskPort } from './recurrence-service';

/**
 * Prisma-backed recurrence port. Spawning the next instance also clears the
 * source task's rule, so completing the same task twice never double-spawns —
 * the rule always travels forward to the newest instance in the series.
 */
export function createPrismaRecurrencePort(prisma: PrismaClient): RecurrenceTaskPort {
  return {
    async spawnNext(sourceTaskId, nextDueDate) {
      const source = await prisma.task.findUniqueOrThrow({ where: { id: sourceTaskId } });
      const project = await prisma.project.findUniqueOrThrow({ where: { id: source.projectId }, select: { code: true } });
      const count = await prisma.task.count({ where: { projectId: source.projectId } });
      // Start the new instance in the project's first enabled column (a fresh, not-done state).
      const firstColumn = await prisma.kanbanColumn.findFirst({
        where: { projectId: source.projectId, enabled: true },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      const parentId = source.recurrenceParentId ?? source.id;

      const created = await prisma.task.create({
        data: {
          key: `${project.code}-${count + 1}`,
          title: source.title,
          description: source.description ?? undefined,
          projectId: source.projectId,
          columnId: firstColumn?.id ?? source.columnId,
          priority: source.priority,
          estimatedHours: source.estimatedHours ?? undefined,
          dueDate: nextDueDate,
          createdById: source.createdById,
          recurrenceRule: (source.recurrenceRule ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          recurrenceParentId: parentId,
        },
        select: { id: true },
      });

      // The rule now lives on the new instance only.
      await prisma.task.update({ where: { id: sourceTaskId }, data: { recurrenceRule: Prisma.DbNull } });

      return { id: created.id };
    },

    async countInstances(parentId) {
      return prisma.task.count({ where: { OR: [{ id: parentId }, { recurrenceParentId: parentId }] } });
    },
  };
}
