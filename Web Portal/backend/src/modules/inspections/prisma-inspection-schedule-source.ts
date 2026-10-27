import { Prisma, type PrismaClient } from '@prisma/client';
import type { RecurrenceRule } from '../tasks/recurrence';
import type { CheckRow, InspectionScheduleSource, SeriesStats } from './inspection-schedules';

const displayName = (u: { username: string; firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

const checkSelect = {
  id: true,
  key: true,
  version: true,
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
  version: t.version,
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
/** A project's checks: its live tasks that carry a form. */
const checksOf = (projectId: string) => ({ projectId, deletedAt: null, project: { is: { deletedAt: null } }, inspectionFormId: { not: null } }) satisfies Prisma.TaskWhereInput;

/** Scheduled inspections read from the tasks table: a check is a live task with `inspectionFormId` set. */
export function createPrismaInspectionScheduleSource(prisma: PrismaClient, opts: { workingDays: () => Promise<number[]> }): InspectionScheduleSource {
  return {
    async schedules(projectId) {
      const rows = await prisma.task.findMany({
        where: { ...checksOf(projectId), NOT: [{ recurrenceRule: { equals: Prisma.DbNull } }] },
        select: checkSelect,
        orderBy: [{ title: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.filter((t) => t.inspectionForm).map(toCheck);
    },
    async seriesStats(projectId, seriesIds, dueBefore) {
      // Grouped over the copies that name their series (tasks_recurrenceParentId_idx); the first task
      // names itself once its first copy is made. Never every copy loaded.
      const members = { projectId, recurrenceParentId: { in: seriesIds } } satisfies Prisma.TaskWhereInput;
      const live = { ...members, deletedAt: null } satisfies Prisma.TaskWhereInput;
      const [open, late, done, made] = await Promise.all([
        prisma.task.groupBy({ by: ['recurrenceParentId'], where: { ...live, ...openWhere }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['recurrenceParentId'], where: { ...live, ...openWhere, dueDate: { lt: dueBefore } }, _count: { _all: true } }),
        prisma.task.groupBy({ by: ['recurrenceParentId'], where: { ...live, completedAt: { not: null } }, _max: { completedAt: true } }),
        // Every copy made, deleted ones too — as the repeat itself counts them (countInstances).
        prisma.task.groupBy({ by: ['recurrenceParentId'], where: members, _count: { _all: true } }),
      ]);
      const count = (rows: Array<{ recurrenceParentId: string | null; _count: { _all: number } }>, id: string) => rows.find((r) => r.recurrenceParentId === id)?._count._all ?? 0;
      return new Map(
        seriesIds.map((id): [string, SeriesStats] => [
          id,
          { open: count(open, id), late: count(late, id), lastDone: done.find((r) => r.recurrenceParentId === id)?._max.completedAt ?? null, size: count(made, id) },
        ]),
      );
    },
    async openChecks(projectId, limit) {
      // By due day, the undated last (MySQL sorts NULL first): the dated ones, then as many undated
      // as still fit — each capped in the query (tasks_projectId_inspectionFormId_idx).
      const where = { ...checksOf(projectId), ...openWhere } satisfies Prisma.TaskWhereInput;
      const [total, dated] = await Promise.all([
        prisma.task.count({ where }),
        prisma.task.findMany({ where: { ...where, dueDate: { not: null } }, select: checkSelect, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: limit }),
      ]);
      const undated = dated.length < limit ? await prisma.task.findMany({ where: { ...where, dueDate: null }, select: checkSelect, orderBy: [{ createdAt: 'asc' }], take: limit - dated.length }) : [];
      return { rows: [...dated, ...undated].filter((t) => t.inspectionForm).map(toCheck), total };
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
