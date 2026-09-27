import { Prisma, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../lib/http-errors';
import type { RecurrenceTaskPort } from './recurrence-service';
import { boardDateFromKey, boardDateKey } from './board-date';
import { defaultCompanyTimeZone } from './task-status';
import { isTaskKeyConflict } from './prisma-task-repository';
import { projectAudienceIds } from './prisma-assignee-repository';

const KEY_ATTEMPTS = 5;

export interface PrismaRecurrencePortOptions {
  /** Company time zone — the new occurrence lands on today's board in this zone. */
  timeZone?: string;
  now?: () => Date;
}

/**
 * Prisma-backed recurrence port. Spawning the next instance also clears the
 * source task's rule, so completing the same task twice never double-spawns —
 * the rule always travels forward to the newest instance in the series.
 *
 * The next occurrence is a normal task: it sits on today's board, starts now, keeps the
 * series' assignees, watchers, tags and (unticked) checklist, and gets a CREATED activity row —
 * all in one transaction with clearing the source's rule.
 */
export function createPrismaRecurrencePort(prisma: PrismaClient, opts: PrismaRecurrencePortOptions = {}): RecurrenceTaskPort {
  const timeZone = opts.timeZone ?? defaultCompanyTimeZone();
  const now = opts.now ?? (() => new Date());

  return {
    async spawnNext(sourceTaskId, nextDueDate, rule) {
      const source = await prisma.task.findFirst({
        where: { id: sourceTaskId, deletedAt: null, project: { is: { deletedAt: null } } },
        include: {
          project: { select: { code: true } },
          assignees: { select: { userId: true } },
          watchers: { select: { userId: true } },
          tags: { select: { tagId: true } },
          checklist: { select: { text: true, position: true }, orderBy: { position: 'asc' } },
        },
      });
      if (!source) throw new NotFoundError('Task not found.');
      // Start the new instance in the project's first enabled, not-done column (a fresh state).
      const firstColumn = await prisma.kanbanColumn.findFirst({
        where: { projectId: source.projectId, enabled: true, category: { not: 'DONE' } },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      const parentId = source.recurrenceParentId ?? source.id;
      // People who have since lost access to the project don't follow the series forward.
      const people = [...new Set([...source.assignees, ...source.watchers].map((r) => r.userId))];
      const allowed = new Set(people.length ? await projectAudienceIds(prisma, source.projectId, people) : []);
      const assigneeIds = source.assignees.map((a) => a.userId).filter((id) => allowed.has(id));
      const watcherIds = source.watchers.map((w) => w.userId).filter((id) => allowed.has(id));
      const at = now();

      for (let attempt = 0; ; attempt++) {
        try {
          const created = await prisma.$transaction(async (tx) => {
            const count = await tx.task.count({ where: { projectId: source.projectId } });
            const task = await tx.task.create({
              data: {
                key: `${source.project.code}-${count + 1 + attempt}`,
                title: source.title,
                description: source.description ?? undefined,
                projectId: source.projectId,
                columnId: firstColumn?.id ?? source.columnId,
                priority: source.priority,
                estimatedHours: source.estimatedHours ?? undefined,
                startDate: at,
                dueDate: nextDueDate,
                boardDate: boardDateFromKey(boardDateKey(at, timeZone)),
                createdById: source.createdById,
                recurrenceRule: rule as unknown as Prisma.InputJsonValue,
                recurrenceParentId: parentId,
                assignees: { create: assigneeIds.map((userId) => ({ userId })) },
                watchers: { create: watcherIds.map((userId) => ({ userId })) },
                tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) },
                checklist: { create: source.checklist.map((c) => ({ text: c.text, position: c.position })) },
              },
              select: { id: true, projectId: true, title: true },
            });
            // The rule now lives on the new instance only.
            await tx.task.update({ where: { id: sourceTaskId }, data: { recurrenceRule: Prisma.DbNull } });
            await tx.activity.create({
              data: { taskId: task.id, projectId: task.projectId, userId: source.createdById, action: 'CREATED', meta: { title: task.title, recurring: true } },
            });
            return task;
          });
          return { id: created.id, projectId: created.projectId };
        } catch (err) {
          // A concurrent create took this key — retry with the next number.
          if (!isTaskKeyConflict(err) || attempt >= KEY_ATTEMPTS - 1) throw err;
        }
      }
    },

    async countInstances(parentId) {
      return prisma.task.count({ where: { OR: [{ id: parentId }, { recurrenceParentId: parentId }] } });
    },
  };
}
