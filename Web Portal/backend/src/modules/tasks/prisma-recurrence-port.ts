import { Prisma, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../lib/http-errors';
import type { RecurrenceTaskPort } from './recurrence-service';
import type { RecurrenceRule } from './recurrence';
import { boardDateFromKey, boardDateKey } from './board-date';
import { defaultCompanyTimeZone } from './task-status';
import { firstFreeKey, highestKeyNumber, isRecurrenceCopyConflict, isTaskKeyConflict } from './prisma-task-repository';
import { projectAudienceIds } from './prisma-assignee-repository';

const KEY_ATTEMPTS = 5;

export interface PrismaRecurrencePortOptions {
  /** Company time zone — the new occurrence lands on today's board in this zone. */
  timeZone?: string;
  now?: () => Date;
  /** Tests only: runs after the source is read and before its copy is made (to reproduce a race). */
  beforeCopy?: (sourceTaskId: string) => Promise<void>;
}

/**
 * Prisma-backed recurrence port. Spawning the next instance also clears the
 * source task's rule, so the rule always travels forward to the newest instance in the series.
 * Each copy records its source task (`recurrenceSourceId`, unique), so the database itself refuses
 * a second copy of the same task — completing it twice, or from two apps at once, makes one.
 *
 * The next occurrence is a normal task: it sits on today's board, starts now, keeps the
 * series' assignees, watchers, tags, (unticked) checklist and inspection form and place, and gets a
 * CREATED activity row —
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
          inspectionForm: { select: { deletedAt: true } },
        },
      });
      if (!source) throw new NotFoundError('Task not found.');
      // A scheduled check whose form was deleted makes no more checks (deleting a form also stops them).
      if (source.inspectionForm?.deletedAt) return null;
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
      await opts.beforeCopy?.(sourceTaskId);

      for (let attempt = 0; ; attempt++) {
        try {
          const created = await prisma.$transaction(async (tx) => {
            // Read again, locked: a form deleted since the source was read (its schedules stopped) makes
            // no copy, nor does a source whose repeat (or form) changed meanwhile. The locks make it
            // right whichever commits first — a form delete waits for this, or this sees it — and are
            // taken in the delete's order (the form, then the task), so the two can't deadlock.
            if (source.inspectionFormId) {
              const [form] = await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`SELECT deletedAt FROM inspection_forms WHERE id = ${source.inspectionFormId} FOR SHARE`;
              if (!form || form.deletedAt) return null;
            }
            const [locked] = await tx.$queryRaw<Array<{ hasRule: number | bigint; formId: string | null }>>`SELECT (recurrenceRule IS NOT NULL) AS hasRule, inspectionFormId AS formId FROM tasks WHERE id = ${sourceTaskId} FOR UPDATE`;
            if (!locked || !Number(locked.hasRule) || (locked.formId ?? null) !== (source.inspectionFormId ?? null)) return null;
            // The project's next number, read afresh on each try (a create that beat this one is
            // counted then): the highest used — old keys of tasks moved away too — plus one.
            const key = await firstFreeKey(tx, source.project.code, (await highestKeyNumber(tx, source.projectId)) + 1);
            const task = await tx.task.create({
              data: {
                key,
                title: source.title,
                description: source.description ?? undefined,
                projectId: source.projectId,
                columnId: firstColumn?.id ?? source.columnId,
                priority: source.priority,
                isMilestone: source.isMilestone,
                // Shown to the project's client: the series' next copy is too (it stays in the same project).
                clientVisible: source.clientVisible,
                // The next copy still comes from the same meeting.
                meetingId: source.meetingId ?? undefined,
                // A scheduled check: every copy is carried out with the same form, at the same place.
                inspectionFormId: source.inspectionFormId ?? undefined,
                inspectionPlace: source.inspectionPlace ?? undefined,
                estimatedHours: source.estimatedHours ?? undefined,
                startDate: at,
                dueDate: nextDueDate,
                boardDate: boardDateFromKey(boardDateKey(at, timeZone)),
                createdById: source.createdById,
                recurrenceRule: rule as unknown as Prisma.InputJsonValue,
                recurrenceParentId: parentId,
                recurrenceSourceId: sourceTaskId,
                assignees: { create: assigneeIds.map((userId) => ({ userId })) },
                watchers: { create: watcherIds.map((userId) => ({ userId })) },
                tags: { create: source.tags.map((t) => ({ tagId: t.tagId })) },
                checklist: { create: source.checklist.map((c) => ({ text: c.text, position: c.position })) },
              },
              select: { id: true, projectId: true, title: true },
            });
            // The rule now lives on the new instance only. The first task of a series marks itself as
            // its start, so every app keeps showing it as part of the series once the rule moves on.
            // Its version is left alone: the client that just completed it holds that version (a
            // schedule's Stop and Edit ask for the newest copy instead: requireNewest).
            await tx.task.update({ where: { id: sourceTaskId }, data: { recurrenceRule: Prisma.DbNull, recurrenceParentId: parentId } });
            await tx.activity.create({
              data: { taskId: task.id, projectId: task.projectId, userId: source.createdById, action: 'CREATED', meta: { title: task.title, recurring: true } },
            });
            return task;
          });
          return created ? { id: created.id, projectId: created.projectId } : null;
        } catch (err) {
          // This task already has its next copy (a repeat or concurrent call): nothing to add.
          if (isRecurrenceCopyConflict(err)) return null;
          // A concurrent create took this key — retry, reading the next number again.
          if (!isTaskKeyConflict(err) || attempt >= KEY_ATTEMPTS - 1) throw err;
        }
      }
    },

    async listSeriesHeads() {
      const rows = await prisma.task.findMany({
        // An archived or completed project makes no more copies on schedule.
        where: {
          deletedAt: null,
          project: { is: { deletedAt: null, status: { notIn: ['ARCHIVED', 'COMPLETED'] } } },
          NOT: [{ recurrenceRule: { equals: Prisma.DbNull } }],
          // A scheduled check whose form was deleted makes no more checks.
          OR: [{ inspectionFormId: null }, { inspectionForm: { is: { deletedAt: null } } }],
        },
        select: { id: true, dueDate: true, startDate: true, recurrenceRule: true, recurrenceParentId: true },
      });
      return rows.map((r) => ({ ...r, recurrenceRule: r.recurrenceRule as unknown as RecurrenceRule | null }));
    },

    async countInstances(parentId) {
      return prisma.task.count({ where: { OR: [{ id: parentId }, { recurrenceParentId: parentId }] } });
    },
  };
}
