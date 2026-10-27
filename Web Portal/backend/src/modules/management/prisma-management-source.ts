import { Prisma, type PrismaClient } from '@prisma/client';
import { zonedStartOfDay } from '../../lib/due-date';
import { managedProjectsWhere } from '../projects/project-managers';
import type { ProjectStatus } from './management-rules';
import type { ActionLine, ManagementSource, MgmtPerson, TaskLine } from './management-source';

/**
 * The Management page's reads straight from the database: grouped queries with bound parameters,
 * a fixed number for the whole page however many projects or tasks there are. Raw SQL only where
 * Prisma can't group the way the page needs (late counts, the weekly trend, answers per inspection).
 */

const personFields = { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } as const;
const toPerson = (u: { id: string; firstName: string; lastName: string; username: string; avatarUrl: string | null }): MgmtPerson => ({
  id: u.id,
  name: `${u.firstName} ${u.lastName}`.trim() || u.username,
  avatarUrl: u.avatarUrl,
});
const utcDay = (key: string) => new Date(`${key}T00:00:00.000Z`);
const num = (v: unknown) => Number(v ?? 0);
const OPEN_ACTION = ['OPEN', 'IN_PROGRESS', 'PENDING'] as const;
/** The shared "open" rule (not in a Done column, no completion time), for a task `t` joined to its column `c`. */
const OPEN = Prisma.sql`t.completedAt IS NULL AND c.category <> 'DONE'`;
const inList = (ids: string[]) => Prisma.join(ids);

/**
 * `col`'s due day is before `day` — lib/due-date `dueDayKey(col) < day`, i.e. `isOverdue` when `day`
 * is today: a date-only value (stored at UTC midnight) by its UTC date, any other moment by its day in
 * the company time zone.
 */
function dueBefore(col: Prisma.Sql, day: string, timeZone: string): Prisma.Sql {
  return Prisma.sql`(${col} IS NOT NULL AND ((TIME(${col}) = '00:00:00' AND ${col} < ${utcDay(day)}) OR (TIME(${col}) <> '00:00:00' AND ${col} < ${zonedStartOfDay(day, timeZone)})))`;
}

export function createPrismaManagementSource(prisma: PrismaClient, timeZone: string): ManagementSource {
  const tDue = Prisma.sql`t.dueDate`;

  async function lines(ids: string[]): Promise<TaskLine[]> {
    if (ids.length === 0) return [];
    const rows = await prisma.task.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        key: true,
        title: true,
        projectId: true,
        dueDate: true,
        completedAt: true,
        isMilestone: true,
        column: { select: { category: true } },
        assignees: { select: { user: { select: personFields } } },
      },
    });
    const byId = new Map<string, TaskLine>(
      rows.map((t) => [
        t.id,
        {
          id: t.id,
          key: t.key,
          title: t.title,
          projectId: t.projectId,
          dueDate: t.dueDate,
          completedAt: t.completedAt,
          columnCategory: t.column.category,
          isMilestone: t.isMilestone,
          assignees: t.assignees.map((a) => toPerson(a.user).name).sort((a, b) => a.localeCompare(b)),
        },
      ]),
    );
    // In the order asked for.
    return ids.map((id) => byId.get(id)).filter((t): t is TaskLine => !!t);
  }

  return {
    async projects(runBy) {
      const rows = await prisma.project.findMany({
        where: { deletedAt: null, ...(runBy ? managedProjectsWhere(runBy) : {}) },
        select: { id: true, code: true, name: true, status: true, color: true, icon: true, imageUrl: true, ownerId: true, managerId: true, updatedAt: true },
        orderBy: { name: 'asc' },
      });
      return rows.map((p) => ({ ...p, status: p.status as ProjectStatus }));
    },

    async runCount(userId) {
      return prisma.project.count({ where: { deletedAt: null, ...managedProjectsWhere(userId) } });
    },

    async people(ids) {
      if (ids.length === 0) return [];
      return (await prisma.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: personFields })).map(toPerson);
    },

    async taskFigures(projectIds, today) {
      if (projectIds.length === 0) return [];
      const rows = await prisma.$queryRaw<Array<{ projectId: string; total: bigint; done: unknown; late: unknown; lastTaskUpdate: Date | null }>>`
        SELECT t.projectId AS projectId,
               COUNT(*) AS total,
               CAST(SUM(CASE WHEN c.category = 'DONE' OR t.completedAt IS NOT NULL THEN 1 ELSE 0 END) AS SIGNED) AS done,
               CAST(SUM(CASE WHEN ${OPEN} AND ${dueBefore(tDue, today, timeZone)} THEN 1 ELSE 0 END) AS SIGNED) AS late,
               MAX(t.updatedAt) AS lastTaskUpdate
          FROM tasks t JOIN kanban_columns c ON c.id = t.columnId
         WHERE t.deletedAt IS NULL AND t.projectId IN (${inList(projectIds)})
         GROUP BY t.projectId`;
      return rows.map((r) => ({ projectId: r.projectId, total: num(r.total), done: num(r.done), open: num(r.total) - num(r.done), late: num(r.late), lastTaskUpdate: r.lastTaskUpdate }));
    },

    async openMilestones(projectIds) {
      if (projectIds.length === 0) return [];
      return prisma.task.findMany({
        where: { projectId: { in: projectIds }, deletedAt: null, isMilestone: true, completedAt: null, column: { category: { not: 'DONE' } } },
        select: { id: true, key: true, title: true, projectId: true, dueDate: true },
        orderBy: [{ dueDate: 'asc' }, { title: 'asc' }],
      });
    },

    async checks(projectIds, w) {
      if (projectIds.length === 0) return [];
      const doneWindow = w.doneFrom && w.doneTo ? Prisma.sql` OR (t.completedAt >= ${w.doneFrom} AND t.completedAt < ${w.doneTo})` : Prisma.empty;
      const rows = await prisma.$queryRaw<Array<{ id: string; projectId: string; dueDate: Date | null; completedAt: Date | null; columnCategory: string; hasReport: unknown }>>`
        SELECT t.id AS id, t.projectId AS projectId, t.dueDate AS dueDate, t.completedAt AS completedAt, c.category AS columnCategory,
               EXISTS (SELECT 1 FROM inspections i WHERE i.taskId = t.id AND i.status = 'FINISHED' AND i.deletedAt IS NULL) AS hasReport
          FROM tasks t JOIN kanban_columns c ON c.id = t.columnId
         WHERE t.deletedAt IS NULL AND t.inspectionFormId IS NOT NULL AND t.projectId IN (${inList(projectIds)})
           AND ((t.dueDate >= ${w.dueFrom} AND t.dueDate < ${w.dueTo})
                OR (${OPEN} AND t.dueDate < ${w.openBefore})${doneWindow})`;
      return rows.map((r) => ({ id: r.id, projectId: r.projectId, dueDate: r.dueDate, completedAt: r.completedAt, columnCategory: r.columnCategory, hasReport: num(r.hasReport) === 1 }));
    },

    async finishedInspections(projectIds, from, to) {
      if (projectIds.length === 0) return [];
      const rows = await prisma.$queryRaw<Array<{ id: string; projectId: string; formId: string | null; title: string; place: string | null; taskId: string | null; finishedAt: Date; passed: unknown; failed: unknown }>>`
        SELECT i.id AS id, i.projectId AS projectId, i.formId AS formId, i.title AS title, i.place AS place, i.taskId AS taskId, i.finishedAt AS finishedAt,
               CAST(COALESCE(SUM(a.result = 'PASS'), 0) AS SIGNED) AS passed,
               CAST(COALESCE(SUM(a.result = 'FAIL'), 0) AS SIGNED) AS failed
          FROM inspections i LEFT JOIN inspection_answers a ON a.inspectionId = i.id
         WHERE i.deletedAt IS NULL AND i.status = 'FINISHED' AND i.finishedAt >= ${from} AND i.finishedAt < ${to}
           AND i.projectId IN (${inList(projectIds)})
         GROUP BY i.id, i.projectId, i.formId, i.title, i.place, i.taskId, i.finishedAt`;
      return rows.map((r) => ({ ...r, passed: num(r.passed), failed: num(r.failed) }));
    },

    async failedItems(projectIds, from, to, limit) {
      if (projectIds.length === 0) return [];
      const rows = await prisma.$queryRaw<Array<{ formId: string | null; itemId: string; failures: bigint; sampleId: string }>>`
        SELECT i.formId AS formId, a.itemId AS itemId, COUNT(*) AS failures, MAX(i.id) AS sampleId
          FROM inspection_answers a JOIN inspections i ON i.id = a.inspectionId
         WHERE a.result = 'FAIL' AND i.deletedAt IS NULL AND i.status = 'FINISHED' AND i.finishedAt >= ${from} AND i.finishedAt < ${to}
           AND i.projectId IN (${inList(projectIds)})
         GROUP BY i.formId, a.itemId
         ORDER BY failures DESC, a.itemId ASC
         LIMIT ${limit}`;
      return rows.map((r) => ({ formId: r.formId, itemId: r.itemId, failures: num(r.failures), sampleId: r.sampleId }));
    },

    async structures(inspectionIds) {
      if (inspectionIds.length === 0) return [];
      return prisma.inspection.findMany({ where: { id: { in: inspectionIds } }, select: { id: true, title: true, structure: true } });
    },

    async openFollowUps(projectIds) {
      if (projectIds.length === 0) return [];
      const rows = await prisma.$queryRaw<Array<{ projectId: string; n: bigint }>>`
        SELECT t.projectId AS projectId, COUNT(*) AS n
          FROM inspection_follow_ups f
          JOIN inspections i ON i.id = f.inspectionId AND i.deletedAt IS NULL
          JOIN tasks t ON t.id = f.taskId
          JOIN kanban_columns c ON c.id = t.columnId
         WHERE t.deletedAt IS NULL AND ${OPEN} AND t.projectId IN (${inList(projectIds)})
         GROUP BY t.projectId`;
      return rows.map((r) => ({ projectId: r.projectId, count: num(r.n) }));
    },

    async lateByPerson(projectIds, today) {
      if (projectIds.length === 0) return [];
      const rows = await prisma.$queryRaw<Array<{ userId: string; n: bigint }>>`
        SELECT ta.userId AS userId, COUNT(*) AS n
          FROM task_assignees ta
          JOIN tasks t ON t.id = ta.taskId
          JOIN kanban_columns c ON c.id = t.columnId
          JOIN users u ON u.id = ta.userId
         WHERE t.deletedAt IS NULL AND ${OPEN} AND ${dueBefore(tDue, today, timeZone)} AND t.projectId IN (${inList(projectIds)})
           AND u.deletedAt IS NULL AND u.status = 'ACTIVE'
         GROUP BY ta.userId`;
      return rows.map((r) => ({ userId: r.userId, count: num(r.n) }));
    },

    async actionItems(projectIds, today) {
      if (projectIds.length === 0) return [];
      // A project's action items as its page counts them: filed on it, or from one of its meetings (a
      // meeting moved to another project takes them along); never a deleted meeting's; active people only.
      const rows = await prisma.$queryRaw<Array<{ userId: string; open: bigint; overdue: unknown }>>`
        SELECT a.assigneeId AS userId, COUNT(*) AS open,
               CAST(SUM(CASE WHEN ${dueBefore(Prisma.sql`a.dueDate`, today, timeZone)} THEN 1 ELSE 0 END) AS SIGNED) AS overdue
          FROM action_items a
          LEFT JOIN meetings m ON m.id = a.meetingId
          JOIN users u ON u.id = a.assigneeId
         WHERE (a.projectId IN (${inList(projectIds)}) OR m.projectId IN (${inList(projectIds)}))
           AND a.status IN (${Prisma.join([...OPEN_ACTION])}) AND (a.meetingId IS NULL OR m.deletedAt IS NULL)
           AND u.deletedAt IS NULL AND u.status = 'ACTIVE'
         GROUP BY a.assigneeId`;
      return rows.map((r) => ({ userId: r.userId, open: num(r.open), overdue: num(r.overdue) }));
    },

    async trend(projectIds, buckets) {
      if (projectIds.length === 0 || buckets.length === 0) return { created: buckets.map(() => 0), completed: buckets.map(() => 0), late: buckets.map(() => 0) };
      const x = Prisma.sql`x.dueDate`;
      const sums = buckets.flatMap((b, i) => [
        Prisma.sql`CAST(SUM(x.createdAt >= ${b.from} AND x.createdAt < ${b.to}) AS SIGNED) AS ${Prisma.raw(`c${i}`)}`,
        Prisma.sql`CAST(SUM(x.doneAt >= ${b.from} AND x.doneAt < ${b.to}) AS SIGNED) AS ${Prisma.raw(`d${i}`)}`,
        Prisma.sql`CAST(SUM(x.createdAt < ${b.lateAt} AND (x.doneAt IS NULL OR x.doneAt >= ${b.lateAt}) AND ${dueBefore(x, b.lateDay, timeZone)}) AS SIGNED) AS ${Prisma.raw(`l${i}`)}`,
      ]);
      // When a task counts as done: its completion time, or — sitting in a Done column without one
      // (older rows) — its last change, as the Reports page's trend counts it.
      const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT ${Prisma.join(sums)}
          FROM (SELECT t.createdAt AS createdAt, t.dueDate AS dueDate,
                       COALESCE(t.completedAt, CASE WHEN c.category = 'DONE' THEN t.updatedAt END) AS doneAt
                  FROM tasks t JOIN kanban_columns c ON c.id = t.columnId
                 WHERE t.deletedAt IS NULL AND t.projectId IN (${inList(projectIds)})) x`;
      const pick = (p: string) => buckets.map((_, i) => num(row?.[`${p}${i}`]));
      return { created: pick('c'), completed: pick('d'), late: pick('l') };
    },

    async lateTasks({ projectIds, today, personId, milestonesOnly, limit }) {
      if (projectIds.length === 0) return { total: 0, rows: [] };
      const who = personId ? Prisma.sql` AND EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.taskId = t.id AND ta.userId = ${personId})` : Prisma.empty;
      const marks = milestonesOnly ? Prisma.sql` AND t.isMilestone = 1` : Prisma.empty;
      const where = Prisma.sql`t.deletedAt IS NULL AND ${OPEN} AND ${dueBefore(tDue, today, timeZone)} AND t.projectId IN (${inList(projectIds)})${who}${marks}`;
      const [count, ids] = await Promise.all([
        prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM tasks t JOIN kanban_columns c ON c.id = t.columnId WHERE ${where}`,
        prisma.$queryRaw<Array<{ id: string }>>`SELECT t.id AS id FROM tasks t JOIN kanban_columns c ON c.id = t.columnId WHERE ${where} ORDER BY t.dueDate ASC, t.\`key\` ASC LIMIT ${limit}`,
      ]);
      return { total: num(count[0]?.n), rows: await lines(ids.map((r) => r.id)) };
    },

    tasksByIds: lines,

    async followUpTasks({ projectIds, limit }) {
      if (projectIds.length === 0) return { total: 0, rows: [] };
      const from = Prisma.sql`FROM inspection_follow_ups f
          JOIN inspections i ON i.id = f.inspectionId AND i.deletedAt IS NULL
          JOIN tasks t ON t.id = f.taskId
          JOIN kanban_columns c ON c.id = t.columnId
         WHERE t.deletedAt IS NULL AND ${OPEN} AND t.projectId IN (${inList(projectIds)})`;
      const [count, ids] = await Promise.all([
        prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n ${from}`,
        prisma.$queryRaw<Array<{ id: string }>>`SELECT t.id AS id ${from} ORDER BY t.dueDate IS NULL, t.dueDate ASC, t.\`key\` ASC LIMIT ${limit}`,
      ]);
      return { total: num(count[0]?.n), rows: await lines(ids.map((r) => r.id)) };
    },

    async failedOccurrences({ projectIds, from, to, formId, itemId, limit }) {
      if (projectIds.length === 0) return { total: 0, rows: [] };
      const form = formId === null ? Prisma.sql`i.formId IS NULL` : Prisma.sql`i.formId = ${formId}`;
      const where = Prisma.sql`a.result = 'FAIL' AND a.itemId = ${itemId} AND ${form} AND i.deletedAt IS NULL AND i.status = 'FINISHED'
           AND i.finishedAt >= ${from} AND i.finishedAt < ${to} AND i.projectId IN (${inList(projectIds)})`;
      const [count, rows] = await Promise.all([
        prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM inspection_answers a JOIN inspections i ON i.id = a.inspectionId WHERE ${where}`,
        prisma.$queryRaw<Array<{ inspectionId: string; title: string; place: string | null; projectId: string; finishedAt: Date; note: string | null }>>`
          SELECT i.id AS inspectionId, i.title AS title, i.place AS place, i.projectId AS projectId, i.finishedAt AS finishedAt, a.note AS note
            FROM inspection_answers a JOIN inspections i ON i.id = a.inspectionId
           WHERE ${where}
           ORDER BY i.finishedAt DESC, i.id ASC
           LIMIT ${limit}`,
      ]);
      return { total: num(count[0]?.n), rows };
    },

    async failedAnswers({ projectIds, from, to, formId, limit }) {
      if (projectIds.length === 0) return { total: 0, rows: [] };
      const form = formId === null ? Prisma.sql`i.formId IS NULL` : Prisma.sql`i.formId = ${formId}`;
      const where = Prisma.sql`a.result = 'FAIL' AND ${form} AND i.deletedAt IS NULL AND i.status = 'FINISHED'
           AND i.finishedAt >= ${from} AND i.finishedAt < ${to} AND i.projectId IN (${inList(projectIds)})`;
      const [count, rows] = await Promise.all([
        prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM inspection_answers a JOIN inspections i ON i.id = a.inspectionId WHERE ${where}`,
        prisma.$queryRaw<Array<{ inspectionId: string; itemId: string; title: string; place: string | null; projectId: string; finishedAt: Date; note: string | null }>>`
          SELECT i.id AS inspectionId, a.itemId AS itemId, i.title AS title, i.place AS place, i.projectId AS projectId, i.finishedAt AS finishedAt, a.note AS note
            FROM inspection_answers a JOIN inspections i ON i.id = a.inspectionId
           WHERE ${where}
           ORDER BY i.finishedAt DESC, i.id ASC, a.itemId ASC
           LIMIT ${limit}`,
      ]);
      return { total: num(count[0]?.n), rows };
    },

    async formTitles(ids) {
      if (ids.length === 0) return [];
      return prisma.inspectionForm.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
    },

    async actionItemList({ projectIds, personId, overdueOn, limit }) {
      if (projectIds.length === 0) return { total: 0, rows: [] };
      // Overdue only: the shared due-date rule (dueBefore) picks the ids; the list reads them as usual.
      const overdueIds = overdueOn
        ? (
            await prisma.$queryRaw<Array<{ id: string }>>`
              SELECT a.id AS id FROM action_items a WHERE a.dueDate IS NOT NULL AND ${dueBefore(Prisma.sql`a.dueDate`, overdueOn, timeZone)}
                AND a.status IN (${Prisma.join([...OPEN_ACTION])})${personId ? Prisma.sql` AND a.assigneeId = ${personId}` : Prisma.empty}`
          ).map((r) => r.id)
        : null;
      if (overdueIds && overdueIds.length === 0) return { total: 0, rows: [] };
      // As the project page counts them: filed on the project, or from one of its meetings; never a deleted meeting's.
      const where: Prisma.ActionItemWhereInput = {
        status: { in: [...OPEN_ACTION] },
        ...(personId ? { assigneeId: personId } : {}),
        ...(overdueIds ? { id: { in: overdueIds } } : {}),
        AND: [
          { OR: [{ projectId: { in: projectIds } }, { meeting: { is: { projectId: { in: projectIds } } } }] },
          { OR: [{ meetingId: null }, { meeting: { is: { deletedAt: null } } }] },
        ],
      };
      const select = { id: true, description: true, projectId: true, meetingId: true, taskId: true, dueDate: true, status: true, assigneeId: true, meeting: { select: { title: true, projectId: true } } } as const;
      const inScope = new Set(projectIds);
      // The most overdue first, then the ones with no due date.
      const [total, dated] = await Promise.all([
        prisma.actionItem.count({ where }),
        prisma.actionItem.findMany({ where: { ...where, dueDate: { not: null } }, select, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: limit }),
      ]);
      const undated = dated.length < limit ? await prisma.actionItem.findMany({ where: { ...where, dueDate: null }, select, orderBy: { createdAt: 'asc' }, take: limit - dated.length }) : [];
      const rows = [...dated, ...undated];
      const names = new Map(
        (await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.assigneeId).filter((id): id is string => !!id))] } }, select: personFields })).map((u) => [u.id, toPerson(u).name]),
      );
      return {
        total,
        rows: rows.map(
          (a): ActionLine => ({
            id: a.id,
            description: a.description,
            // The meeting's project when it is one of these (it may have moved), else the one it was filed on.
            projectId: a.meeting?.projectId && inScope.has(a.meeting.projectId) ? a.meeting.projectId : a.projectId!,
            meetingId: a.meetingId,
            meetingTitle: a.meeting?.title ?? null,
            taskId: a.taskId,
            dueDate: a.dueDate,
            status: a.status,
            assigneeId: a.assigneeId,
            assigneeName: a.assigneeId ? names.get(a.assigneeId) ?? null : null,
          }),
        ),
      };
    },
  };
}
