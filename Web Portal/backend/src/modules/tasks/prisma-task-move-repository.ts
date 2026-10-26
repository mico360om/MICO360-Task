import type { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaTaskRepository, firstFreeKey, highestKeyNumber, isTaskKeyConflict, liveTaskWhere } from './prisma-task-repository';
import { TaskKeyConflictError } from './task-repository';
import { TaskChangedConflictError, TaskMovedConflictError, type TaskMoveRepository } from './task-move-repository';
import { moveHistory } from './task-move-history';
import { managedProjectsWhere } from '../projects/project-managers';

const projectSelect = { id: true, code: true, name: true, status: true, defaultDueToday: true, color: true, icon: true, imageUrl: true } as const;
const displayName = (u: { username: string; firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

/**
 * Prisma-backed moves between projects. The move itself is one transaction: the task takes the new
 * project's next number (after the highest used, old keys included), its old key is kept in task_key_aliases, the
 * people chosen join the new team or leave the task, and its history is filed under the new project
 * with a PROJECT_CHANGED line. A key taken at the same moment (unique index on tasks and on old keys)
 * rolls it all back for the service to try the next number.
 */
export function createPrismaTaskMoveRepository(prisma: PrismaClient): TaskMoveRepository {
  const tasks = createPrismaTaskRepository(prisma);
  return {
    async findTasks(ids) {
      if (ids.length === 0) return [];
      const rows = await prisma.task.findMany({
        where: { id: { in: ids }, ...liveTaskWhere },
        select: {
          id: true, key: true, title: true, projectId: true, columnId: true, isMilestone: true, dueDate: true, startDate: true, boardDate: true,
          completedAt: true, recurrenceRule: true, recurrenceParentId: true, version: true,
          column: { select: { category: true } },
          assignees: { select: { user: { select: { id: true, username: true, firstName: true, lastName: true } } }, orderBy: { assignedAt: 'asc' } },
        },
      });
      return rows.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        projectId: t.projectId,
        columnId: t.columnId,
        columnCategory: t.column?.category ?? null,
        isMilestone: t.isMilestone,
        dueDate: t.dueDate,
        startDate: t.startDate,
        boardDate: t.boardDate,
        completedAt: t.completedAt,
        version: t.version,
        repeats: t.recurrenceRule !== null,
        inSeries: t.recurrenceRule !== null || t.recurrenceParentId !== null,
        assignees: t.assignees.map((a) => ({ id: a.user.id, name: displayName(a.user) })),
      }));
    },

    async findProject(id) {
      return prisma.project.findFirst({ where: { id, deletedAt: null }, select: projectSelect });
    },

    async listOpenProjects() {
      return prisma.project.findMany({ where: { deletedAt: null, status: { notIn: ['COMPLETED', 'ARCHIVED'] } }, select: projectSelect, orderBy: { name: 'asc' } });
    },

    async managedProjectIds(userId) {
      // Its owner, its named manager or a MANAGER member (project-managers).
      const rows = await prisma.project.findMany({ where: { deletedAt: null, ...managedProjectsWhere(userId) }, select: { id: true } });
      return rows.map((r) => r.id);
    },

    async listColumns(projectId) {
      return prisma.kanbanColumn.findMany({ where: { projectId }, select: { id: true, name: true, category: true, position: true, enabled: true }, orderBy: { position: 'asc' } });
    },

    async teamIds(projectId, userIds) {
      if (userIds.length === 0) return [];
      const [project, admins] = await Promise.all([
        prisma.project.findFirst({
          where: { id: projectId },
          select: { ownerId: true, managerId: true, members: { where: { userId: { in: userIds } }, select: { userId: true } } },
        }),
        prisma.userRole.findMany({ where: { userId: { in: userIds }, role: { name: 'ADMIN' } }, select: { userId: true } }),
      ]);
      if (!project) return [];
      const team = new Set([project.ownerId, project.managerId, ...project.members.map((m) => m.userId), ...admins.map((a) => a.userId)]);
      return userIds.filter((id) => team.has(id));
    },

    async nextKeyNumber(projectId) {
      return (await highestKeyNumber(prisma, projectId)) + 1;
    },

    async move(w) {
      let key = '';
      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          // The next number, read in this transaction: a task that beat an earlier try is counted now.
          key = await firstFreeKey(tx, w.to.code, (await highestKeyNumber(tx, w.to.projectId)) + 1);
          // The old key keeps finding the task (it is already kept when the task moved away before and back).
          const kept = await tx.taskKeyAlias.findUnique({ where: { key: w.from.key }, select: { taskId: true } });
          if (!kept) await tx.taskKeyAlias.create({ data: { key: w.from.key, taskId: w.taskId, projectId: w.from.projectId } });
          else if (kept.taskId !== w.taskId) throw new TaskMovedConflictError(w.taskId);
          // At the bottom of its new column.
          const last = await tx.task.aggregate({ where: { columnId: w.columnId, deletedAt: null }, _max: { position: true } });
          // Saved only if the task is still where, and as, it was read: two moves of one task can't both
          // win, and a task completed (or edited) meanwhile isn't moved on what was read before.
          const { count } = await tx.task.updateMany({
            where: { id: w.taskId, projectId: w.from.projectId, key: w.from.key, version: w.version, deletedAt: null },
            // "Show to client" belongs to the old project's client page: the task leaves it.
            data: { ...w.patch, key, projectId: w.to.projectId, columnId: w.columnId, position: (last._max.position ?? -1) + 1, clientVisible: false, version: { increment: 1 } },
          });
          if (count === 0) {
            const now = await tx.task.findFirst({ where: { id: w.taskId, deletedAt: null }, select: { projectId: true, key: true } });
            if (!now || now.projectId !== w.from.projectId || now.key !== w.from.key) throw new TaskMovedConflictError(w.taskId);
            throw new TaskChangedConflictError(w.taskId);
          }
          if (w.addToTeam.length > 0) {
            await tx.projectMember.createMany({ data: w.addToTeam.map((userId) => ({ projectId: w.to.projectId, userId })), skipDuplicates: true });
          }
          if (w.unassign.length > 0) await tx.taskAssignee.deleteMany({ where: { taskId: w.taskId, userId: { in: w.unassign.map((p) => p.id) } } });

          // Its history goes with it: every line is filed under the new project. Then the move's own
          // lines (task-move-history), a millisecond apart so they read in the order they are written.
          await tx.activity.updateMany({ where: { taskId: w.taskId }, data: { projectId: w.to.projectId } });
          const at = Date.now();
          let i = 0;
          for (const line of moveHistory(w, key)) {
            await tx.activity.create({
              data: { taskId: line.taskId, projectId: line.projectId, userId: w.actorId, action: line.action, meta: line.meta as Prisma.InputJsonValue, createdAt: new Date(at + i++) },
            });
          }
        });
      } catch (err) {
        if (isTaskKeyConflict(err)) throw new TaskKeyConflictError(key);
        throw err;
      }
      const moved = await tasks.findById(w.taskId);
      if (!moved) throw new TaskMovedConflictError(w.taskId);
      return moved;
    },
  };
}
