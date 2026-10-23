import type { PrismaClient } from '@prisma/client';
import type { TimelineMilestoneRow, TimelinePerson, TimelineRows, TimelineSource } from './timeline';

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
        return { totals: [], openByDue: [], milestones: [], nextMilestones: [], soonMilestones: [], milestoneCounts: [], meetings: [], meetingsThisWeek: [], owners: [] };
      }
      const inProjects = { deletedAt: null, projectId: { in: projectIds } };
      const milestone = { ...inProjects, isMilestone: true };
      const meeting = { projectId: { in: projectIds }, deletedAt: null, status: { not: 'CANCELLED' as const } };
      const [totals, openByDue, shown, firstDue, soon, counts, meetings, thisWeek, owners] = await Promise.all([
        prisma.task.groupBy({ by: ['projectId'], where: inProjects, _count: { _all: true } }),
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
  };
}
