import type { PrismaClient } from '@prisma/client';
import type { TimelinePerson, TimelineRows, TimelineSource } from './timeline';

const personFields = { id: true, firstName: true, lastName: true, username: true, avatarUrl: true } as const;
export const toPerson = (u: { id: string; firstName: string; lastName: string; username: string; avatarUrl: string | null }): TimelinePerson => ({
  id: u.id,
  name: `${u.firstName} ${u.lastName}`.trim() || u.username,
  avatarUrl: u.avatarUrl,
});

/** Meetings one timeline may show (a year of a project's daily meetings fits several times over). */
const MEETING_CAP = 3000;
const MILESTONE_CAP = 2000;

/**
 * The timeline's figures straight from the database, in five queries for any number of projects:
 * every live task per project, the open ones per project and due date (progress, overdue, busy
 * weeks), the milestones, the meetings in the window (not cancelled) and the owners.
 */
export function createPrismaTimelineSource(prisma: PrismaClient): TimelineSource {
  return {
    async load(projectIds, ownerIds, { meetingsFrom, meetingsTo }): Promise<TimelineRows> {
      if (projectIds.length === 0) return { totals: [], openByDue: [], milestones: [], meetings: [], owners: [] };
      const inProjects = { deletedAt: null, projectId: { in: projectIds } };
      const [totals, openByDue, milestones, meetings, owners] = await Promise.all([
        prisma.task.groupBy({ by: ['projectId'], where: inProjects, _count: { _all: true } }),
        // Open = the shared "not done" rule: not in a Done column and no completion time.
        prisma.task.groupBy({
          by: ['projectId', 'dueDate'],
          where: { ...inProjects, completedAt: null, column: { category: { not: 'DONE' } } },
          _count: { _all: true },
        }),
        prisma.task.findMany({
          where: { ...inProjects, isMilestone: true },
          select: { id: true, key: true, title: true, projectId: true, dueDate: true, completedAt: true, column: { select: { category: true } } },
          orderBy: [{ dueDate: 'asc' }, { title: 'asc' }],
          take: MILESTONE_CAP,
        }),
        prisma.meeting.findMany({
          where: { projectId: { in: projectIds }, deletedAt: null, status: { not: 'CANCELLED' }, startAt: { gte: meetingsFrom, lt: meetingsTo } },
          select: { id: true, title: true, projectId: true, startAt: true, endAt: true },
          orderBy: { startAt: 'asc' },
          take: MEETING_CAP,
        }),
        ownerIds.length ? prisma.user.findMany({ where: { id: { in: ownerIds }, deletedAt: null }, select: personFields }) : Promise.resolve([]),
      ]);
      return {
        totals: totals.map((t) => ({ projectId: t.projectId, total: t._count._all })),
        openByDue: openByDue.map((g) => ({ projectId: g.projectId, dueDate: g.dueDate, count: g._count._all })),
        milestones: milestones.map((m) => ({
          id: m.id,
          key: m.key,
          title: m.title,
          projectId: m.projectId,
          dueDate: m.dueDate,
          done: m.completedAt !== null || m.column.category === 'DONE',
        })),
        meetings: meetings.filter((m): m is typeof m & { projectId: string } => m.projectId !== null),
        owners: owners.map(toPerson),
      };
    },
  };
}
