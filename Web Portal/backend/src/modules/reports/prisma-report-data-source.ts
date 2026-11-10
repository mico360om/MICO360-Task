import type { PrismaClient } from '@prisma/client';
import type { ReportDataSource } from './report-service';
import { STAFF_ONLY_WHERE } from '../clients/client-kind';
import { effectiveWeight, weightDefaultsOf } from '../project-health/completion';
import { guestLabel } from '../tasks/guest-contacts';

export function createPrismaReportDataSource(prisma: PrismaClient): ReportDataSource {
  return {
    async getTasks() {
      const tasks = await prisma.task.findMany({
        // Exclude tasks of soft-deleted projects too, otherwise a deleted project's tasks keep
        // inflating the dashboard totals/overdue and add an orphan bar to project completion.
        where: { deletedAt: null, project: { is: { deletedAt: null } } },
        include: {
          // 1.23.5: how the project counts completion, and its default weights.
          project: { select: { name: true, completionMode: true, weightUrgent: true, weightHigh: true, weightNormal: true, weightLow: true } },
          column: { select: { category: true, name: true } },
          assignees: { select: { userId: true } },
          // 1.24: its guests and categories (the task list exports).
          externalContacts: { select: { name: true, company: true }, orderBy: { position: 'asc' } },
          categories: { select: { category: { select: { name: true, position: true } } } },
        },
      });
      // 1.23.1: the main task's row says which tasks were merged into it.
      // The merged tasks themselves (merges are few) — never every task's id in one IN (…) list.
      const merged = await prisma.task.findMany({ where: { mergedIntoId: { not: null } }, select: { key: true, mergedIntoId: true }, orderBy: [{ mergedAt: 'asc' }, { key: 'asc' }] });
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
        weight: effectiveWeight(t, weightDefaultsOf(t.project)),
        byWeight: t.project.completionMode === 'WEIGHT',
        ...(mergedFrom.has(t.id) ? { mergedFrom: mergedFrom.get(t.id) } : {}),
        guests: t.externalContacts.map(guestLabel),
        categories: t.categories.map((c) => c.category).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'en')).map((c) => c.name),
      }));
    },
    async getUsers() {
      // 1.23: client accounts are never a row of the staff reports.
      const users = await prisma.user.findMany({ where: { deletedAt: null, ...STAFF_ONLY_WHERE }, select: { id: true, username: true, firstName: true, lastName: true } });
      return users.map((u) => ({ id: u.id, username: u.username, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username }));
    },
  };
}
