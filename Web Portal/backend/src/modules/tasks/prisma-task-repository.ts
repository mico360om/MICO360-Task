import { Prisma, type ColumnCategory, type PrismaClient, type Task } from '@prisma/client';
import {
  TaskKeyConflictError,
  type CreateTaskData,
  type ProjectLookup,
  type TaskRecord,
  type TaskRepository,
  type UpdateTaskData,
} from './task-repository';
import type { RecurrenceRule } from './recurrence';
import type { CarryForwardRepo } from './carry-forward-service';
import type { CarryLogEntry } from './board-date';
import { paletteColorFor } from './tag-repository';

type TagRelation = { tag: { id: string; name: string; color: string } };
type AssigneeRelation = { user: { id: string; username: string; firstName: string | null; lastName: string | null } };
type EnrichedTask = Omit<Task, 'carryForwardLog'> & {
  /** Absent on list rows — the carry-forward history is only returned for a single task. */
  carryForwardLog?: Prisma.JsonValue;
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
    ...(t.carryForwardLog !== undefined ? { carryForwardLog: (t.carryForwardLog as unknown as CarryLogEntry[] | null) ?? null } : {}),
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

/** Live tasks only: not deleted, and not in a deleted project. */
export const liveTaskWhere = { deletedAt: null, project: { is: { deletedAt: null } } } satisfies Prisma.TaskWhereInput;

/** True for a unique-constraint violation on the task key (a concurrent create took it). */
export function isTaskKeyConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return /key/i.test(text);
}

// Every scalar except the carry-forward history, which can grow long and is left out of lists.
const listScalars = {
  id: true, key: true, title: true, description: true, projectId: true, columnId: true, position: true,
  priority: true, startDate: true, dueDate: true, estimatedHours: true, actualHours: true, progress: true,
  createdById: true, completedAt: true, boardDate: true, recurrenceRule: true, recurrenceParentId: true,
  version: true, createdAt: true, updatedAt: true, deletedAt: true,
} as const;

export function createPrismaTaskRepository(prisma: PrismaClient): TaskRepository {
  // Always join the column's category (Kanban stage) and the task's tags so every
  // task payload carries them (used for status classification, tag filtering + display).
  const withColumn = { column: { select: { category: true } }, tags: { include: { tag: true } } } as const;
  return {
    async create(data: CreateTaskData) {
      const tagNames = data.tagNames ?? [];
      const assigneeIds = [...new Set(data.assigneeIds ?? [])];
      try {
        // Task, tags and assignees are one nested write — all of it lands or none of it does.
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
            completedAt: data.completedAt ?? undefined,
            boardDate: data.boardDate ?? undefined,
            recurrenceRule: (data.recurrenceRule ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
            recurrenceParentId: data.recurrenceParentId ?? undefined,
            ...(tagNames.length
              ? {
                  tags: {
                    create: tagNames.map((name) => ({
                      tag: { connectOrCreate: { where: { name }, create: { name, color: paletteColorFor(name) } } },
                    })),
                  },
                }
              : {}),
            ...(assigneeIds.length ? { assignees: { create: assigneeIds.map((userId) => ({ userId })) } } : {}),
          },
        });
        return toRecord(t);
      } catch (err) {
        if (isTaskKeyConflict(err)) throw new TaskKeyConflictError(data.key);
        throw err;
      }
    },
    async findById(id) {
      const t = await prisma.task.findFirst({ where: { id, ...liveTaskWhere }, include: withColumn });
      return t ? toRecord(t) : null;
    },
    async list(filter) {
      const and: Prisma.TaskWhereInput[] = [];
      if (filter.projectId) and.push({ projectId: filter.projectId });
      if (filter.projectIds) and.push({ projectId: { in: filter.projectIds } });
      if (filter.columnId) and.push({ columnId: filter.columnId });
      if (filter.assigneeId) and.push({ assignees: { some: { userId: filter.assigneeId } } });
      if (filter.boardDate) and.push({ boardDate: filter.boardDate });
      if (filter.priorities?.length) and.push({ priority: { in: filter.priorities as Task['priority'][] } });
      if (filter.categories?.length) and.push({ column: { category: { in: filter.categories as ColumnCategory[] } } });
      if (filter.tagIds?.length) and.push({ tags: { some: { tagId: { in: filter.tagIds } } } });
      if (filter.dueBefore) and.push({ dueDate: { lte: filter.dueBefore } });
      if (filter.dueAfter) and.push({ dueDate: { gte: filter.dueAfter } });
      const ts = await prisma.task.findMany({
        where: { ...liveTaskWhere, AND: and },
        // Enrich list rows for card display: assignees + lightweight aggregate counts. `_count`
        // + a `select`-only checklist keep this a single query (no N+1) with minimal payload.
        select: {
          ...listScalars,
          ...withColumn,
          assignees: { select: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } },
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
    async updateSeries(seriesId, patch, opts = {}) {
      // One atomic UPDATE over the series members — no full-table scan, no loop.
      const { recurrenceRule, carryForwardLog, ...rest } = patch;
      const data: Prisma.TaskUpdateManyMutationInput = { ...rest, version: { increment: 1 } };
      if (recurrenceRule !== undefined) {
        data.recurrenceRule = recurrenceRule === null ? Prisma.DbNull : (recurrenceRule as unknown as Prisma.InputJsonValue);
      }
      if (carryForwardLog !== undefined) {
        data.carryForwardLog = carryForwardLog === null ? Prisma.DbNull : (carryForwardLog as unknown as Prisma.InputJsonValue);
      }
      await prisma.task.updateMany({
        where: {
          deletedAt: null,
          OR: [{ id: seriesId }, { recurrenceParentId: seriesId }],
          ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
          ...(opts.openOnly ? { completedAt: null, column: { category: { not: 'DONE' } } } : {}),
        },
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
    async findColumn(columnId) {
      const c = await prisma.kanbanColumn.findUnique({ where: { id: columnId }, select: { id: true, projectId: true, category: true } });
      return c ?? null;
    },
    async reorderInColumn(columnId, orderedIds) {
      // Scoped to live tasks of this column, so stray ids (other columns/projects, deleted tasks)
      // are ignored. Position isn't content, so the version stays put (no false edit conflicts).
      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.task.updateMany({ where: { id, columnId, deletedAt: null }, data: { position: index } }),
        ),
      );
    },
  };
}

/** Prisma-backed data access for the daily carry-forward sweep (per-date boards). */
export function createPrismaCarryForwardRepo(prisma: PrismaClient): CarryForwardRepo {
  return {
    async listCarryCandidates(beforeAnchor) {
      const ts = await prisma.task.findMany({
        where: {
          ...liveTaskWhere,
          completedAt: null,
          boardDate: { lt: beforeAnchor },
          column: { category: { not: 'DONE' } },
        },
        select: { id: true, completedAt: true, boardDate: true, column: { select: { category: true } } },
      });
      return ts.map((t) => ({ id: t.id, columnCategory: t.column.category, completedAt: t.completedAt, boardDate: t.boardDate! }));
    },
    async applyCarry(id, toAnchor, entry) {
      // Read-modify-write the append-only JSON history, then move the board day. The nightly
      // move is bookkeeping, not an edit, so it keeps the task's updatedAt.
      const cur = await prisma.task.findUnique({ where: { id }, select: { carryForwardLog: true, updatedAt: true } });
      if (!cur) return;
      const log = Array.isArray(cur.carryForwardLog) ? (cur.carryForwardLog as unknown[]) : [];
      await prisma.task.update({
        where: { id },
        data: { boardDate: toAnchor, carryForwardLog: [...log, entry] as unknown as Prisma.InputJsonValue, updatedAt: cur.updatedAt },
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
