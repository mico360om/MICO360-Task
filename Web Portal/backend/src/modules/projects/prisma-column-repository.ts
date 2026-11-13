import type { PrismaClient, KanbanColumn } from '@prisma/client';
import { ConflictError } from '../../lib/http-errors';
import { withRowLock } from '../../lib/sentinel-lock';
import type { ColumnCategory, ColumnRepository } from './column-repository';

/**
 * Review fix #13: the hold a status change takes on its column — the transaction's first statement, so
 * what it then counts is read after anyone who held it first has finished (lib/sentinel-lock).
 */
export const LOCK_COLUMN_SQL = 'SELECT id, category FROM kanban_columns WHERE id = ? FOR UPDATE';
/** Review fix #26: a whole reorder holds the project's row first, then reads its columns with their own holds. */
export const LOCK_PROJECT_SQL = 'SELECT id FROM projects WHERE id = ? FOR UPDATE';
export const LOCK_PROJECT_COLUMNS_SQL = 'SELECT id, position FROM kanban_columns WHERE projectId = ? FOR UPDATE';

export interface PrismaColumnRepositoryOptions {
  /** Tests only: runs after the columns are parked and before their final positions (to stop a reorder part-way). */
  beforeFinalPositions?: () => Promise<void>;
}

function toRecord(c: KanbanColumn) {
  return { id: c.id, projectId: c.projectId, name: c.name, category: c.category, position: c.position, color: c.color, enabled: c.enabled };
}

/**
 * The live tasks of a column waiting for approval (a column holding one can't become a Done column: they
 * would count as done unapproved). Task archive (lead's ruling, 11 Nov): an archived one counts too.
 */
export function countWaitingTasksIn(prisma: PrismaClient, columnId: string): Promise<number> {
  return prisma.task.count({ where: { columnId, deletedAt: null, approvalRequestedAt: { not: null } } });
}

export function createPrismaColumnRepository(prisma: PrismaClient, opts: PrismaColumnRepositoryOptions = {}): ColumnRepository {
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
    async changeStatus(id, patch, check) {
      return withRowLock(
        prisma,
        (tx) => tx.$queryRawUnsafe<Array<{ id: string; category: ColumnCategory }>>(LOCK_COLUMN_SQL, id),
        async (tx, [column]) => {
          if (column) {
            // Every task that is in the column or comes back into it: on the board, archived, in the
            // Recycle Bin. A merged task's record never comes back on its own and nobody can move it.
            const [live, archived, binned, waiting] = await Promise.all([
              tx.task.count({ where: { columnId: id, deletedAt: null, archivedAt: null } }),
              tx.task.count({ where: { columnId: id, deletedAt: null, archivedAt: { not: null } } }),
              tx.task.count({ where: { columnId: id, deletedAt: { not: null }, mergedIntoId: null } }),
              tx.task.count({ where: { columnId: id, deletedAt: null, approvalRequestedAt: { not: null } } }),
            ]);
            check({ category: column.category, live, archived, binned, waiting });
          }
          // A column that isn't there answers as before (the update's own "not found").
          return toRecord(await tx.kanbanColumn.update({ where: { id }, data: patch }));
        },
      );
    },
    async reorder(projectId, orderedIds) {
      return withRowLock(
        prisma,
        (tx) => tx.$queryRawUnsafe<Array<{ id: string }>>(LOCK_PROJECT_SQL, projectId),
        async (tx) => {
          const held = await tx.$queryRawUnsafe<Array<{ id: string; position: number }>>(LOCK_PROJECT_COLUMNS_SQL, projectId);
          const ids = new Set(held.map((c) => c.id));
          if (held.length !== orderedIds.length || orderedIds.some((id) => !ids.has(id))) return null;
          // Two steps inside the one transaction: park every column below any position in use (the
          // (projectId, position) index allows no direct swap), then give each its place.
          const low = Math.min(0, ...held.map((c) => Number(c.position))) - 1;
          for (const [i, id] of orderedIds.entries()) await tx.kanbanColumn.update({ where: { id }, data: { position: low - i } });
          await opts.beforeFinalPositions?.();
          for (const [i, id] of orderedIds.entries()) await tx.kanbanColumn.update({ where: { id }, data: { position: i } });
          return (await tx.kanbanColumn.findMany({ where: { projectId }, orderBy: { position: 'asc' } })).map(toRecord);
        },
      );
    },
    async countLiveTasks(id) {
      // Task archive: an archived task never keeps a column from going (it is parked, as binned ones are).
      return prisma.task.count({ where: { columnId: id, deletedAt: null, archivedAt: null } });
    },
    async remove(id) {
      return prisma.$transaction(async (tx) => {
        const column = await tx.kanbanColumn.findUnique({ where: { id }, select: { projectId: true, category: true } });
        if (!column) return null;
        // Re-checked inside the transaction: a task may have landed here since the caller looked.
        if ((await tx.task.count({ where: { columnId: id, deletedAt: null, archivedAt: null } })) > 0) {
          throw new ConflictError('This column still has tasks. Move them to another column first.', 'COLUMN_NOT_EMPTY');
        }
        // Soft-deleted tasks keep a (restricting) reference to their column; park them on another
        // column of the project so this one can go — the first of the same kind (Recycle Bin: restored,
        // a task comes back in the same stage), else the first column. Task archive: archived tasks too
        // (unarchived, one comes back in that column).
        if ((await tx.task.count({ where: { columnId: id } })) > 0) {
          const others = { projectId: column.projectId, id: { not: id } };
          const fallback =
            (await tx.kanbanColumn.findFirst({ where: { ...others, category: column.category }, orderBy: { position: 'asc' }, select: { id: true } })) ??
            (await tx.kanbanColumn.findFirst({ where: others, orderBy: { position: 'asc' }, select: { id: true } }));
          if (!fallback) {
            throw new ConflictError('A project needs at least one column. Add another column before deleting this one.', 'LAST_COLUMN');
          }
          await tx.task.updateMany({ where: { columnId: id, OR: [{ deletedAt: { not: null } }, { archivedAt: { not: null } }] }, data: { columnId: fallback.id } });
        }
        await tx.kanbanColumn.delete({ where: { id } });
        return { projectId: column.projectId };
      });
    },
  };
}
