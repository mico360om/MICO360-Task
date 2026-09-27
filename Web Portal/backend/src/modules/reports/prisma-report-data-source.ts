import type { PrismaClient } from '@prisma/client';
import type { ReportDataSource } from './report-service';

export function createPrismaReportDataSource(prisma: PrismaClient): ReportDataSource {
  return {
    async getTasks() {
      const tasks = await prisma.task.findMany({
        // Exclude tasks of soft-deleted projects too, otherwise a deleted project's tasks keep
        // inflating the dashboard totals/overdue and add an orphan bar to project completion.
        where: { deletedAt: null, project: { is: { deletedAt: null } } },
        include: {
          project: { select: { name: true } },
          column: { select: { category: true } },
          assignees: { select: { userId: true } },
        },
      });
      return tasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        projectName: t.project.name,
        columnCategory: t.column.category,
        createdAt: t.createdAt,
        dueDate: t.dueDate,
        // Older rows can sit in a DONE column without a completion time (created straight into
        // Done, or moved there via an edit); their last update is the best stand-in, so the trend
        // and the snapshot reports agree they are done.
        completedAt: t.completedAt ?? (t.column.category === 'DONE' ? t.updatedAt : null),
        assigneeIds: t.assignees.map((a) => a.userId),
      }));
    },
    async getUsers() {
      return prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, username: true } });
    },
  };
}
