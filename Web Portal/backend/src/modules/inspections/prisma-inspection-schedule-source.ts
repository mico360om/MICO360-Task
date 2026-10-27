import { Prisma, type PrismaClient } from '@prisma/client';
import type { RecurrenceRule } from '../tasks/recurrence';
import type { CheckRow, InspectionScheduleSource } from './inspection-schedules';

const displayName = (u: { username: string; firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

const checkSelect = {
  id: true,
  key: true,
  title: true,
  projectId: true,
  dueDate: true,
  startDate: true,
  completedAt: true,
  recurrenceRule: true,
  recurrenceParentId: true,
  inspectionPlace: true,
  column: { select: { category: true } },
  inspectionForm: { select: { id: true, title: true, deletedAt: true } },
  assignees: { select: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } },
} satisfies Prisma.TaskSelect;

type Row = Prisma.TaskGetPayload<{ select: typeof checkSelect }>;

const toCheck = (t: Row): CheckRow => ({
  id: t.id,
  key: t.key,
  title: t.title,
  projectId: t.projectId,
  dueDate: t.dueDate,
  startDate: t.startDate,
  completedAt: t.completedAt,
  columnCategory: t.column?.category ?? null,
  recurrenceRule: (t.recurrenceRule as unknown as RecurrenceRule | null) ?? null,
  recurrenceParentId: t.recurrenceParentId,
  inspectionPlace: t.inspectionPlace,
  form: { id: t.inspectionForm!.id, title: t.inspectionForm!.title, deleted: t.inspectionForm!.deletedAt !== null },
  assignees: t.assignees.map((a) => ({ id: a.user.id, name: displayName(a.user) })),
});

/** Open: not completed and not in a Done column (inspection-checks' "done", in the query). */
const openWhere = { completedAt: null, column: { category: { not: 'DONE' } } } satisfies Prisma.TaskWhereInput;

/** Scheduled inspections read from the tasks table: a check is a live task with `inspectionFormId` set. */
export function createPrismaInspectionScheduleSource(prisma: PrismaClient, opts: { workingDays: () => Promise<number[]> }): InspectionScheduleSource {
  return {
    async checks(projectId, o) {
      const rows = await prisma.task.findMany({
        where: {
          projectId,
          deletedAt: null,
          project: { is: { deletedAt: null } },
          inspectionFormId: { not: null },
          ...(o.openOnly ? openWhere : {}),
          ...(o.schedulesOnly ? { NOT: [{ recurrenceRule: { equals: Prisma.DbNull } }] } : {}),
          ...(o.seriesIds ? { OR: [{ id: { in: o.seriesIds } }, { recurrenceParentId: { in: o.seriesIds } }] } : {}),
        },
        select: checkSelect,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.filter((t) => t.inspectionForm).map(toCheck);
    },
    async seriesSizes(seriesIds) {
      // Every copy made, deleted ones too — as the repeat itself counts them (countInstances).
      const rows = await prisma.task.findMany({ where: { OR: [{ id: { in: seriesIds } }, { recurrenceParentId: { in: seriesIds } }] }, select: { id: true, recurrenceParentId: true } });
      const sizes = new Map(seriesIds.map((id) => [id, 0]));
      for (const r of rows) {
        const series = r.recurrenceParentId ?? r.id;
        if (sizes.has(series)) sizes.set(series, sizes.get(series)! + 1);
      }
      return sizes;
    },
    async inProgress(taskIds) {
      const rows = await prisma.inspection.findMany({
        where: { taskId: { in: taskIds }, status: 'IN_PROGRESS', deletedAt: null },
        select: { id: true, taskId: true, inspectorId: true },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      });
      // The newest one per task.
      const seen = new Set<string>();
      return rows.flatMap((r) => (r.taskId && !seen.has(r.taskId) && seen.add(r.taskId) ? [{ taskId: r.taskId, inspectionId: r.id, inspectorId: r.inspectorId }] : []));
    },
    async formUsage(formId) {
      if ((await prisma.inspectionForm.count({ where: { id: formId, deletedAt: null } })) === 0) return null;
      const live = { inspectionFormId: formId, deletedAt: null, project: { is: { deletedAt: null } } } satisfies Prisma.TaskWhereInput;
      const [schedules, openChecks] = await Promise.all([
        prisma.task.count({ where: { ...live, NOT: [{ recurrenceRule: { equals: Prisma.DbNull } }] } }),
        prisma.task.count({ where: { ...live, ...openWhere } }),
      ]);
      return { schedules, openChecks };
    },
    workingDays: () => opts.workingDays(),
  };
}
