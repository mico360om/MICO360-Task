import type { PrismaClient } from '@prisma/client';
import type { ReportDataSource } from './report-service';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';

export function createPrismaReportDataSource(prisma: PrismaClient): ReportDataSource {
  return {
    async getTasks() {
      const tasks = await prisma.task.findMany({
        // Exclude tasks of soft-deleted projects too, otherwise a deleted project's tasks keep
        // inflating the dashboard totals/overdue and add an orphan bar to project completion.
        where: { deletedAt: null, project: { is: { deletedAt: null } } },
        include: {
          project: { select: { name: true } },
          column: { select: { category: true, name: true } },
          assignees: { select: { userId: true } },
        },
      });
      // 1.23.1: the main task's row says which tasks were merged into it.
      const merged = await prisma.task.findMany({ where: { mergedIntoId: { in: tasks.map((t) => t.id) } }, select: { key: true, mergedIntoId: true }, orderBy: { key: 'asc' } });
      const mergedFrom = new Map<string, string[]>();
      for (const m of merged) mergedFrom.set(m.mergedIntoId!, [...(mergedFrom.get(m.mergedIntoId!) ?? []), m.key]);
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
        key: t.key,
        title: t.title,
        priority: t.priority,
        columnName: t.column.name,
        approvalRequestedAt: t.approvalRequestedAt,
        ...(mergedFrom.has(t.id) ? { mergedFrom: mergedFrom.get(t.id) } : {}),
      }));
    },
    async getUsers() {
      // 1.23: client accounts are never a row of the staff reports.
      const users = await prisma.user.findMany({ where: { deletedAt: null, ...STAFF_ONLY_WHERE }, select: { id: true, username: true, firstName: true, lastName: true } });
      return users.map((u) => ({ id: u.id, username: u.username, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username }));
    },
  };
}
