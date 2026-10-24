import type { Prisma, PrismaClient } from '@prisma/client';
import { TIMELINE_TASK_LIMIT, type TimelineMilestoneRow, type TimelinePerson, type TimelineRows, type TimelineSource, type TimelineTaskRow } from './timeline';

const personFields = { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } as const;
export const toPerson = (u: { id: string; firstName: string; lastName: string; username: string; avatarUrl: string | null }): TimelinePerson => ({
  id: u.id,
  name: `${u.firstName} ${u.lastName}`.trim() || u.username,
  avatarUrl: u.avatarUrl,
});

/** The shared "not done" rule: not in a Done column and no completion time. */
const NOT_DONE = { completedAt: null, column: { category: { not: 'DONE' as const } } };
const milestoneFields = { id: true, key: true, title: true, projectId: true, dueDate: true, completedAt: true, column: { select: { category: true } } } as const;
const toMilestone = (m: { id: string; key: string; title: string; projectId: string; dueDate: Date | null; completedAt: Date | null; column: { category: string } }): TimelineMilestoneRow => ({
  id: m.id,
  key: m.key,
  title: m.title,
  projectId: m.projectId,
  dueDate: m.dueDate,
  done: m.completedAt !== null || m.column.category === 'DONE',
});

/**
 * The timeline's figures straight from the database in a fixed number of grouped queries, none of
 * them capped: every live task per project, the open ones per project and due date (progress,
 * overdue, busy weeks), the milestones and meetings of the shown weeks (the markers), each project's
 * next milestone (the earliest not reached, else an undated one), the milestones due in the next 30
 * days, the milestone counts, this week's meetings per project, and the owners.
 */
export function createPrismaTimelineSource(prisma: PrismaClient): TimelineSource {
  return {
    async load(projectIds, ownerIds, w): Promise<TimelineRows> {
      if (projectIds.length === 0) {
        return { totals: [], openByDue: [], taskDates: [], milestones: [], nextMilestones: [], soonMilestones: [], milestoneCounts: [], meetings: [], meetingsThisWeek: [], owners: [] };
      }
      const inProjects = { deletedAt: null, projectId: { in: projectIds } };
      const milestone = { ...inProjects, isMilestone: true };
      const meeting = { projectId: { in: projectIds }, deletedAt: null, status: { not: 'CANCELLED' as const } };
      const [totals, openByDue, shown, firstDue, soon, counts, meetings, thisWeek, owners] = await Promise.all([
        // Every live task, with the dates a project without its own takes from them (done tasks too).
        prisma.task.groupBy({ by: ['projectId'], where: inProjects, _count: { _all: true }, _min: { startDate: true, dueDate: true }, _max: { dueDate: true } }),
        prisma.task.groupBy({ by: ['projectId', 'dueDate'], where: { ...inProjects, ...NOT_DONE }, _count: { _all: true } }),
        prisma.task.findMany({ where: { ...milestone, dueDate: { gte: w.shownFrom, lt: w.shownTo } }, select: milestoneFields, orderBy: [{ dueDate: 'asc' }, { title: 'asc' }] }),
        prisma.task.groupBy({ by: ['projectId'], where: { ...milestone, ...NOT_DONE, dueDate: { not: null } }, _min: { dueDate: true } }),
        prisma.task.findMany({ where: { ...milestone, ...NOT_DONE, dueDate: { gte: w.soonFrom, lt: w.soonTo } }, select: { projectId: true, dueDate: true } }),
        prisma.task.groupBy({ by: ['projectId'], where: milestone, _count: { _all: true } }),
        prisma.meeting.findMany({ where: { ...meeting, startAt: { gte: w.shownFrom, lt: w.shownTo } }, select: { id: true, title: true, projectId: true, startAt: true, endAt: true }, orderBy: { startAt: 'asc' } }),
        prisma.meeting.groupBy({ by: ['projectId'], where: { ...meeting, startAt: { gte: w.weekFrom, lt: w.weekTo } }, _count: { _all: true } }),
        ownerIds.length ? prisma.user.findMany({ where: { id: { in: ownerIds }, deletedAt: null }, select: personFields }) : Promise.resolve([]),
      ]);
      // The next milestone: the earliest not reached (every one on that day), else an undated one.
      const dated = firstDue.filter((g) => g._min.dueDate !== null);
      const withoutDated = projectIds.filter((id) => !dated.some((g) => g.projectId === id));
      const [nextDated, nextUndated] = await Promise.all([
        dated.length
          ? prisma.task.findMany({ where: { ...milestone, ...NOT_DONE, OR: dated.map((g) => ({ projectId: g.projectId, dueDate: g._min.dueDate! })) }, select: milestoneFields })
          : Promise.resolve([]),
        withoutDated.length
          ? prisma.task.findMany({
              where: { ...milestone, ...NOT_DONE, projectId: { in: withoutDated }, dueDate: null },
              select: milestoneFields,
              distinct: ['projectId'],
              orderBy: [{ projectId: 'asc' }, { title: 'asc' }],
            })
          : Promise.resolve([]),
      ]);
      return {
        totals: totals.map((t) => ({ projectId: t.projectId, total: t._count._all })),
        taskDates: totals.map((t) => ({ projectId: t.projectId, minStart: t._min.startDate ?? null, minDue: t._min.dueDate ?? null, maxDue: t._max.dueDate ?? null })),
        openByDue: openByDue.map((g) => ({ projectId: g.projectId, dueDate: g.dueDate, count: g._count._all })),
        milestones: shown.map(toMilestone),
        nextMilestones: [...nextDated, ...nextUndated].map(toMilestone),
        soonMilestones: soon,
        milestoneCounts: counts.map((c) => ({ projectId: c.projectId, count: c._count._all })),
        meetings: meetings.filter((m): m is typeof m & { projectId: string } => m.projectId !== null),
        meetingsThisWeek: thisWeek.filter((g): g is typeof g & { projectId: string } => g.projectId !== null).map((g) => ({ projectId: g.projectId, count: g._count._all })),
        owners: owners.map(toPerson),
      };
    },

    async projectTasks(projectId, { from, to, overdueBefore, upcomingFrom }) {
      const live = { projectId, deletedAt: null };
      const select = {
        id: true,
        key: true,
        title: true,
        startDate: true,
        dueDate: true,
        priority: true,
        isMilestone: true,
        completedAt: true,
        column: { select: { category: true } },
        assignees: { select: { user: { select: personFields } } },
      } as const;
      type Row = { id: string; key: string; title: string; startDate: Date | null; dueDate: Date | null; priority: TimelineTaskRow['priority']; isMilestone: boolean; completedAt: Date | null; column: { category: string }; assignees: { user: Parameters<typeof toPerson>[0] }[] };
      const toRow = (t: Row): TimelineTaskRow => ({
        id: t.id,
        key: t.key,
        title: t.title,
        startDate: t.startDate,
        dueDate: t.dueDate,
        done: t.completedAt !== null || t.column.category === 'DONE',
        priority: t.priority,
        isMilestone: t.isMilestone,
        assignees: t.assignees.map((a) => ({ id: a.user.id, name: toPerson(a.user).name })),
      });
      // Due from `from` on, and due (or started) before `to`: in or reaching into the shown weeks.
      const reaches: Prisma.TaskWhereInput = { OR: [{ dueDate: { lt: to } }, { startDate: { lt: to } }] };
      const inWindow: Prisma.TaskWhereInput = { ...live, dueDate: { gte: from }, ...reaches };
      // Open and not yet overdue (overdue work is read on its own).
      const openInWindow: Prisma.TaskWhereInput = { ...live, ...NOT_DONE, AND: [{ dueDate: { gte: from } }, { dueDate: { gte: upcomingFrom } }, reaches] };
      const doneInWindow: Prisma.TaskWhereInput = { ...live, AND: [{ dueDate: { gte: from } }, reaches, { OR: [{ completedAt: { not: null } }, { column: { category: 'DONE' } }] }] };
      // Each part is read at most two pages deep, in the order the lane shows it (open work by its
      // first day: the earliest by due day and the earliest by start day hold it).
      const page = 2 * TIMELINE_TASK_LIMIT;
      const days = (where: Prisma.TaskWhereInput) => prisma.task.groupBy({ by: ['dueDate', 'startDate'], where, _count: { _all: true } });
      const [overdue, byDue, byStart, done, inRangeDays, overdueDays, open, undated] = await Promise.all([
        prisma.task.findMany({ where: { ...live, ...NOT_DONE, dueDate: { lt: overdueBefore } }, select, orderBy: [{ dueDate: 'asc' }, { key: 'asc' }], take: page }),
        prisma.task.findMany({ where: openInWindow, select, orderBy: [{ dueDate: 'asc' }, { key: 'asc' }], take: page }),
        prisma.task.findMany({ where: { ...openInWindow, startDate: { not: null } }, select, orderBy: [{ startDate: 'asc' }, { key: 'asc' }], take: page }),
        prisma.task.findMany({ where: doneInWindow, select, orderBy: [{ dueDate: 'desc' }, { key: 'asc' }], take: page }),
        days(inWindow),
        days({ ...live, ...NOT_DONE, dueDate: { lt: overdueBefore } }),
        prisma.task.count({ where: { ...live, ...NOT_DONE } }),
        prisma.task.count({ where: { ...live, ...NOT_DONE, dueDate: null } }),
      ]);
      const once = new Map([...byDue, ...byStart].map((t) => [t.id, t]));
      const toDays = (g: { dueDate: Date | null; startDate: Date | null; _count: { _all: number } }[]) =>
        g.filter((x): x is typeof x & { dueDate: Date } => x.dueDate !== null).map((x) => ({ dueDate: x.dueDate, startDate: x.startDate, count: x._count._all }));
      return {
        overdue: overdue.map(toRow),
        openInRange: [...once.values()].map(toRow),
        doneInRange: done.map(toRow),
        inRangeDays: toDays(inRangeDays),
        overdueDays: toDays(overdueDays),
        open,
        undated,
      };
    },
  };
}
