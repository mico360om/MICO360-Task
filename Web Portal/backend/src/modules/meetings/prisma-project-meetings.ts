import type { PrismaClient } from '@prisma/client';
import type { RecurrenceRule } from './meeting-repository';
import type { ProjectMeetingsData } from './project-meetings';

const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;

/** Reads a project's meetings in a date range with their people, notes, minutes and action items. */
export function createPrismaProjectMeetingsSource(prisma: PrismaClient) {
  return {
    async load(projectId: string, from: Date, to: Date): Promise<ProjectMeetingsData> {
      const meetings = await prisma.meeting.findMany({
        where: { projectId, deletedAt: null, startAt: { gte: from, lt: to } },
        orderBy: { startAt: 'asc' },
        take: 400,
        select: {
          id: true, title: true, status: true, startAt: true, endAt: true, timeZone: true, location: true, onlineLink: true,
          recurrenceRule: true, recurrenceParentId: true, organizerId: true,
        },
      });
      const ids = meetings.map((m) => m.id);
      const [attendees, decisions, notes, minutes, items] = await Promise.all([
        prisma.meetingAttendee.findMany({
          where: { meetingId: { in: ids } },
          orderBy: { createdAt: 'asc' },
          select: { meetingId: true, userId: true, externalName: true, externalEmail: true },
        }),
        prisma.meetingNote.findMany({
          where: { meetingId: { in: ids }, deletedAt: null, type: 'DECISION' },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: { id: true, meetingId: true, body: true, createdAt: true },
        }),
        prisma.meetingNote.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
        prisma.meetingMinutes.findMany({ where: { meetingId: { in: ids } }, select: { meetingId: true, status: true } }),
        // The project's action items, and its meetings' — never those of deleted meetings.
        prisma.actionItem.findMany({
          where: {
            AND: [
              { OR: [{ projectId }, { meetingId: { in: ids } }] },
              { OR: [{ meetingId: null }, { meeting: { is: { deletedAt: null } } }] },
            ],
          },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          take: 200,
          select: { id: true, meetingId: true, description: true, status: true, priority: true, dueDate: true, assigneeId: true, completedAt: true },
        }),
      ]);
      const userIds = [...new Set([...attendees.map((a) => a.userId), ...items.map((x) => x.assigneeId)].filter((u): u is string => !!u))];
      const users = userIds.length
        ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, username: true } })
        : [];
      const names = new Map(users.map((u) => [u.id, nameOf(u)]));
      return {
        meetings: meetings.map((m) => ({ ...m, recurrenceRule: (m.recurrenceRule as RecurrenceRule | null) ?? null })),
        attendees: attendees.map((a) => ({
          meetingId: a.meetingId,
          userId: a.userId,
          name: a.userId ? names.get(a.userId) ?? 'A team member' : a.externalName ?? a.externalEmail ?? 'A guest',
        })),
        decisions,
        noteCounts: Object.fromEntries(notes.map((n) => [n.meetingId, n._count._all])),
        minutes,
        actionItems: items.map((x) => ({ ...x, assigneeName: x.assigneeId ? names.get(x.assigneeId) ?? null : null })),
      };
    },
  };
}

export type ProjectMeetingsSource = ReturnType<typeof createPrismaProjectMeetingsSource>;
