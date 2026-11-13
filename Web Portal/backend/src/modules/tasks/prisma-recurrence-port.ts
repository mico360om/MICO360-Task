import { copyRowsForRepeat } from './checklist-service';
import type { ItemRow, ListRow } from './checklist-tree';
import { Prisma, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../lib/http-errors';
import type { RecurrenceTaskPort, RecurringTask } from './recurrence-service';
import type { RecurrenceRule } from './recurrence';
import { boardDateFromKey, boardDateKey } from './board-date';
import { defaultCompanyTimeZone } from './task-status';
import { firstFreeKey, highestKeyNumber, isRecurrenceCopyConflict, isTaskKeyConflict } from './prisma-task-repository';
import { projectAudienceIds } from './prisma-assignee-repository';
import { liveProjectWhere } from '../companies/project-archive';

const KEY_ATTEMPTS = 5;

/**
 * The series' source, read again under a hold before its copy is made: still repeating, the same form, and
 * (#14 repair) still done and not in the Recycle Bin. The start-up database check sends the same text.
 */
export const lockSourceSql = (taskId: string): Prisma.Sql =>
  Prisma.sql`SELECT (recurrenceRule IS NOT NULL) AS hasRule, inspectionFormId AS formId, (completedAt IS NOT NULL AND deletedAt IS NULL) AS stillDone, version FROM tasks WHERE id = ${taskId} FOR UPDATE`;

/**
 * 1.23.27: the series' inspection form, read under a shared hold before a copy is made (a form deleted meanwhile
 * makes no copy). LOCK IN SHARE MODE, not FOR SHARE — MariaDB (the live server) refuses FOR SHARE (error 1064).
 * The start-up database check sends the same text.
 */
export const lockFormSql = (formId: string): Prisma.Sql => Prisma.sql`SELECT deletedAt FROM inspection_forms WHERE id = ${formId} LOCK IN SHARE MODE`;

export interface PrismaRecurrencePortOptions {
  /** Company time zone — the new occurrence lands on today's board in this zone. */
  timeZone?: string;
  now?: () => Date;
  /** Tests only: runs after the source is read and before its copy is made (to reproduce a race). */
  beforeCopy?: (sourceTaskId: string) => Promise<void>;
  /** #14 repair: finished tasks read per page (default 500; tests use a small one). */
  repairPageSize?: number;
}

/**
 * Prisma-backed recurrence port. Spawning the next instance also clears the
 * source task's rule, so the rule always travels forward to the newest instance in the series.
 * Each copy records its source task (`recurrenceSourceId`, unique), so the database itself refuses
 * a second copy of the same task — completing it twice, or from two apps at once, makes one.
 *
 * The next occurrence is a normal task: it sits on today's board, starts now, keeps the
 * series' assignees, watchers, tags, (unticked) checklist, external contacts (copied), inspection
 * form and place and "Needs approval" tick, and gets a
 * CREATED activity row —
 * all in one transaction with clearing the source's rule.
 */
export function createPrismaRecurrencePort(prisma: PrismaClient, opts: PrismaRecurrencePortOptions = {}): RecurrenceTaskPort {
  const timeZone = opts.timeZone ?? defaultCompanyTimeZone();
  const now = opts.now ?? (() => new Date());

  return {
    async spawnNext(sourceTaskId, nextDueDate, rule, spawnOpts = {}) {
      const source = await prisma.task.findFirst({
        where: { id: sourceTaskId, deletedAt: null, project: { is: { deletedAt: null } } },
        include: {
          project: { select: { code: true } },
          assignees: { select: { userId: true } },
          watchers: { select: { userId: true } },
          tags: { select: { tagId: true } },
          // 1.23.3: its live checklists (titles, nesting, people, due days).
          checklistLists: { where: { deletedAt: null } },
          checklist: { where: { deletedAt: null } },
          externalContacts: { orderBy: { position: 'asc' } },
          // 1.24: its categories (the same project's).
          categories: { select: { categoryId: true } },
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
      const itemPeople = source.checklist.map((c) => c.assigneeId).filter((id): id is string => !!id);
      const people = [...new Set([...source.assignees, ...source.watchers].map((r) => r.userId).concat(itemPeople))];
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
              const [form] = await tx.$queryRaw<Array<{ deletedAt: Date | null }>>(lockFormSql(source.inspectionFormId));
              if (!form || form.deletedAt) return null;
            }
            const [locked] = await tx.$queryRaw<Array<{ hasRule: number | bigint; formId: string | null; stillDone: number | bigint; version: number | bigint }>>(lockSourceSql(sourceTaskId));
            if (!locked || !Number(locked.hasRule) || (locked.formId ?? null) !== (source.inspectionFormId ?? null)) return null;
            // #14 repair: a task reopened (or binned) since the sweep read it makes no copy.
            if (spawnOpts.onlyIfDone && !Number(locked.stillDone)) return null;
            // …nor one changed since (its repeat paused, ended or edited): the next sweep reads it again.
            if (spawnOpts.version !== undefined && Number(locked.version) !== spawnOpts.version) return null;
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
                // 1.23.5: the next copy weighs what this one did.
                weight: source.weight,
                // Shown to the project's client: the series' next copy is too (it stays in the same project).
                clientVisible: source.clientVisible,
                // The next copy still comes from the same meeting.
                meetingId: source.meetingId ?? undefined,
                // A scheduled check: every copy is carried out with the same form, at the same place.
                inspectionFormId: source.inspectionFormId ?? undefined,
                inspectionPlace: source.inspectionPlace ?? undefined,
                // Needs approval: every copy does too (each starts fresh — not waiting, not approved).
                needsApproval: source.needsApproval,
                // Release B: its own reminder schedule (Notification & Scheduling) goes with the series.
                reminderScheduleId: source.reminderScheduleId ?? undefined,
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
                // 1.24: the same categories.
                categories: { create: (source.categories ?? []).map((c) => ({ categoryId: c.categoryId })) },
                // Its guests: each copy links the same guests (rows of its own, with this task's notes).
                externalContacts: {
                  create: (source.externalContacts ?? []).map((c) => ({
                    guestId: c.guestId,
                    name: c.name,
                    company: c.company,
                    designation: c.designation,
                    email: c.email,
                    phone: c.phone,
                    remarks: c.remarks,
                    position: c.position,
                    createdById: c.createdById,
                  })),
                },
              },
              select: { id: true, projectId: true, title: true },
            });
            // 1.23.3 (design call 2): the checklists, ticks cleared; each item keeps its person (while they
            // may still open the project) and its due day moves as far as the task's did — none when either
            // task has no due day. No "assigned" notices: the reminders cover them when they're due.
            const shift = source.dueDate && nextDueDate ? nextDueDate.getTime() - source.dueDate.getTime() : null;
            const copy = copyRowsForRepeat({ lists: source.checklistLists as ListRow[], items: source.checklist as ItemRow[] }, task.id, shift, at);
            for (const i of copy.items) if (i.assigneeId && !allowed.has(i.assigneeId)) i.assigneeId = null;
            if (copy.lists.length) await tx.checklistList.createMany({ data: copy.lists });
            if (copy.items.length) await tx.checklistItem.createMany({ data: copy.items });
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
          // companies: archived by its own status or by all its companies (liveProjectWhere).
          project: { is: liveProjectWhere({ deletedAt: null, status: { not: 'COMPLETED' } }) },
          NOT: [{ recurrenceRule: { equals: Prisma.DbNull } }],
          // A scheduled check whose form was deleted makes no more checks.
          OR: [{ inspectionFormId: null }, { inspectionForm: { is: { deletedAt: null } } }],
        },
        select: { id: true, dueDate: true, startDate: true, recurrenceRule: true, recurrenceParentId: true },
      });
      return rows.map((r) => ({ ...r, recurrenceRule: r.recurrenceRule as unknown as RecurrenceRule | null }));
    },

    async listMissedCopies(since) {
      const page = Math.max(1, opts.repairPageSize ?? 500);
      const where: Prisma.TaskWhereInput = {
        deletedAt: null,
        // Finished: in a Done column, with its completion date in the window (archived ones too: tidied away).
        completedAt: { gte: since },
        column: { is: { category: 'DONE' } },
        NOT: [{ recurrenceRule: { equals: Prisma.DbNull } }],
        // As the schedule sweep: an archived or completed project makes no more copies.
        project: { is: liveProjectWhere({ deletedAt: null, status: { not: 'COMPLETED' } }) },
        OR: [{ inspectionFormId: null }, { inspectionForm: { is: { deletedAt: null } } }],
      };
      const found: RecurringTask[] = [];
      // Every one, page by page (oldest completion first): finished on-schedule or ended series, which keep
      // their rule, can't crowd out one to repair.
      for (let cursor: string | undefined; ; ) {
        const heads = await prisma.task.findMany({
          where,
          select: { id: true, dueDate: true, startDate: true, recurrenceRule: true, recurrenceParentId: true, version: true },
          orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
          take: page,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (!heads.length) break;
        // A copy anywhere (in the Recycle Bin, archived, merged, moved to another project) counts: a copy
        // someone deleted on purpose is never made again (and the unique source guard refuses one anyway).
        const copied = new Set(
          (await prisma.task.findMany({ where: { recurrenceSourceId: { in: heads.map((h) => h.id) } }, select: { recurrenceSourceId: true } })).map((c) => c.recurrenceSourceId),
        );
        for (const h of heads) if (!copied.has(h.id)) found.push({ ...h, recurrenceRule: h.recurrenceRule as unknown as RecurrenceRule | null });
        if (heads.length < page) break;
        cursor = heads[heads.length - 1]!.id;
      }
      return found;
    },

    async countInstances(parentId) {
      // Every copy made: deleted ones too, and (Recycle Bin) those erased for good since.
      const [made, erased] = await Promise.all([
        prisma.task.count({ where: { OR: [{ id: parentId }, { recurrenceParentId: parentId }] } }),
        prisma.taskSeriesErased.findUnique({ where: { seriesId: parentId }, select: { erased: true } }),
      ]);
      return made + (erased?.erased ?? 0);
    },
  };
}
