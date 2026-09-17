import { Prisma, type PrismaClient, type Task } from '@prisma/client';
import type { CreateTaskData, ProjectLookup, TaskRecord, TaskRepository, UpdateTaskData } from './task-repository';
import type { RecurrenceRule } from './recurrence';
import type { CarryForwardRepo } from './carry-forward-service';
import type { CarryLogEntry } from './board-date';

type TagRelation = { tag: { id: string; name: string; color: string } };
type AssigneeRelation = { user: { id: string; username: string; firstName: string | null; lastName: string | null } };
type EnrichedTask = Task & {
  column?: { category: string } | null;
  tags?: TagRelation[];
  assignees?: AssigneeRelation[];
  checklist?: { done: boolean }[];
  _count?: { comments: number; attachments: number };
};
const displayName = (u: AssigneeRelation['user']): string => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

function toRecord(t: EnrichedTask): TaskRecord {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    description: t.description,
    projectId: t.projectId,
    columnId: t.columnId,
    columnCategory: t.column?.category ?? null,
    tags: t.tags ? t.tags.map((tt) => ({ id: tt.tag.id, name: tt.tag.name, color: tt.tag.color })) : undefined,
    position: t.position,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    estimatedHours: t.estimatedHours,
    actualHours: t.actualHours,
    progress: t.progress,
    createdById: t.createdById,
    completedAt: t.completedAt,
    boardDate: t.boardDate ?? null,
    carryForwardLog: (t.carryForwardLog as unknown as CarryLogEntry[] | null) ?? null,
    recurrenceRule: (t.recurrenceRule as unknown as RecurrenceRule | null) ?? null,
    recurrenceParentId: t.recurrenceParentId,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    ...(t.assignees ? { assignees: t.assignees.map((a) => ({ id: a.user.id, name: displayName(a.user) })) } : {}),
    ...(t._count || t.checklist
      ? {
          counts: {
            comments: t._count?.comments ?? 0,
            attachments: t._count?.attachments ?? 0,
            checklistDone: (t.checklist ?? []).filter((c) => c.done).length,
            checklistTotal: (t.checklist ?? []).length,
          },
        }
      : {}),
  };
}

export function createPrismaTaskRepository(prisma: PrismaClient): TaskRepository {
  // Always join the column's category (Kanban stage) and the task's tags so every
  // task payload carries them (used for status classification, tag filtering + display).
  const withColumn = { column: { select: { category: true } }, tags: { include: { tag: true } } } as const;
  return {
    async create(data: CreateTaskData) {
      const t = await prisma.task.create({
        include: withColumn,
        data: {
          key: data.key,
          title: data.title,
          projectId: data.projectId,
          columnId: data.columnId,
          createdById: data.createdById,
          description: data.description ?? undefined,
          priority: data.priority ?? undefined,
          startDate: data.startDate ?? undefined,
          dueDate: data.dueDate ?? undefined,
          estimatedHours: data.estimatedHours ?? undefined,
          progress: data.progress ?? undefined,
          boardDate: data.boardDate ?? undefined,
          recurrenceRule: (data.recurrenceRule ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          recurrenceParentId: data.recurrenceParentId ?? undefined,
        },
      });
      return toRecord(t);
    },
    async findById(id) {
      const t = await prisma.task.findFirst({ where: { id, deletedAt: null }, include: withColumn });
      return t ? toRecord(t) : null;
    },
    async list(filter) {
      const ts = await prisma.task.findMany({
        where: {
          deletedAt: null,
          ...(filter.projectId ? { projectId: filter.projectId } : {}),
          ...(filter.columnId ? { columnId: filter.columnId } : {}),
          ...(filter.assigneeId ? { assignees: { some: { userId: filter.assigneeId } } } : {}),
          ...(filter.boardDate ? { boardDate: filter.boardDate } : {}),
        },
        // Enrich list rows for card display: assignees + lightweight aggregate counts. `_count`
        // + a `select`-only checklist keep this a single query (no N+1) with minimal payload.
        include: {
          ...withColumn,
          assignees: { include: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } },
          checklist: { select: { done: true } },
          _count: { select: { comments: true, attachments: true } },
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      return ts.map(toRecord);
    },
    async update(id, patch: UpdateTaskData) {
      const { recurrenceRule, carryForwardLog, ...rest } = patch;
      const data: Prisma.TaskUpdateInput = { ...rest, version: { increment: 1 } };
      if (recurrenceRule !== undefined) {
        // A nullable Json column needs Prisma's DbNull sentinel to store SQL NULL.
        data.recurrenceRule = recurrenceRule === null ? Prisma.DbNull : (recurrenceRule as unknown as Prisma.InputJsonValue);
      }
      if (carryForwardLog !== undefined) {
        data.carryForwardLog = carryForwardLog === null ? Prisma.DbNull : (carryForwardLog as unknown as Prisma.InputJsonValue);
      }
      const t = await prisma.task.update({ where: { id }, data, include: withColumn });
      return toRecord(t);
    },
    async softDelete(id) {
      await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
    },
    async updateSeries(seriesId, patch) {
      // One atomic UPDATE over the origin + all its occurrences — no full-table scan, no loop.
      const { recurrenceRule, carryForwardLog, ...rest } = patch;
      const data: Prisma.TaskUpdateManyMutationInput = { ...rest, version: { increment: 1 } };
      if (recurrenceRule !== undefined) {
        data.recurrenceRule = recurrenceRule === null ? Prisma.DbNull : (recurrenceRule as unknown as Prisma.InputJsonValue);
      }
      if (carryForwardLog !== undefined) {
        data.carryForwardLog = carryForwardLog === null ? Prisma.DbNull : (carryForwardLog as unknown as Prisma.InputJsonValue);
      }
      await prisma.task.updateMany({
        where: { deletedAt: null, OR: [{ id: seriesId }, { recurrenceParentId: seriesId }] },
        data,
      });
    },
    async softDeleteSeries(seriesId) {
      await prisma.task.updateMany({
        where: { deletedAt: null, OR: [{ id: seriesId }, { recurrenceParentId: seriesId }] },
        data: { deletedAt: new Date() },
      });
    },
    async countByProject(projectId) {
      // Count every task ever created (incl. soft-deleted) so keys never repeat.
      return prisma.task.count({ where: { projectId } });
    },
  };
}

/** Prisma-backed data access for the daily carry-forward sweep (per-date boards). */
export function createPrismaCarryForwardRepo(prisma: PrismaClient): CarryForwardRepo {
  return {
    async listCarryCandidates(beforeAnchor) {
      const ts = await prisma.task.findMany({
        where: {
          deletedAt: null,
          completedAt: null,
          boardDate: { lt: beforeAnchor },
          column: { category: { not: 'DONE' } },
        },
        select: { id: true, completedAt: true, boardDate: true, column: { select: { category: true } } },
      });
      return ts.map((t) => ({ id: t.id, columnCategory: t.column.category, completedAt: t.completedAt, boardDate: t.boardDate! }));
    },
    async applyCarry(id, toAnchor, entry) {
      // Read-modify-write the append-only JSON history, then move the board day.
      const cur = await prisma.task.findUnique({ where: { id }, select: { carryForwardLog: true } });
      const log = Array.isArray(cur?.carryForwardLog) ? (cur!.carryForwardLog as unknown[]) : [];
      await prisma.task.update({
        where: { id },
        data: { boardDate: toAnchor, carryForwardLog: [...log, entry] as unknown as Prisma.InputJsonValue },
      });
    },
  };
}

export function createPrismaProjectLookup(prisma: PrismaClient): ProjectLookup {
  return {
    async getCodeById(id) {
      const p = await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { code: true } });
      return p?.code ?? null;
    },
  };
}
