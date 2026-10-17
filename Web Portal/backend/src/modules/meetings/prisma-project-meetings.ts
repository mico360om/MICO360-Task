import type { PrismaClient } from '@prisma/client';
import type { RecurrenceRule } from './meeting-repository';
import { buildMeetingListCounts, type ProjectMeetingsData } from './project-meetings';

const nameOf = (u: { firstName: string | null; lastName: string | null; username: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username;

/** Display names of these people (team members by name; unknown ids are left out). */
async function namesOf(prisma: PrismaClient, ids: Array<string | null>): Promise<Map<string, string>> {
  const userIds = [...new Set(ids.filter((u): u is string => !!u))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, username: true } }) : [];
  return new Map(users.map((u) => [u.id, nameOf(u)]));
}

/** An attendee's display name: a team member's name, or a guest's name or email. */
const attendeeName = (a: { userId: string | null; externalName: string | null; externalEmail: string | null }, names: Map<string, string>) =>
  a.userId ? names.get(a.userId) ?? 'A team member' : a.externalName ?? a.externalEmail ?? 'A guest';

/**
 * The meetings list's summary of each meeting — people (the first few by name), minutes,
 * decisions and open action items — in a handful of queries for the whole list.
 */
export function createPrismaMeetingListCounts(prisma: PrismaClient) {
  return async (ids: string[]) => {
    const [attendees, open, notes, decisions, minutes] = await Promise.all([
      prisma.meetingAttendee.findMany({ where: { meetingId: { in: ids } }, orderBy: { createdAt: 'asc' }, select: { meetingId: true, userId: true, externalName: true, externalEmail: true } }),
      prisma.actionItem.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, _count: { _all: true } }),
      prisma.meetingNote.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
      prisma.meetingNote.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, deletedAt: null, type: 'DECISION' }, _count: { _all: true } }),
      prisma.meetingMinutes.findMany({ where: { meetingId: { in: ids } }, select: { meetingId: true, status: true } }),
    ]);
    const names = await namesOf(prisma, attendees.map((a) => a.userId));
    return buildMeetingListCounts(ids, {
      attendees: attendees.map((a) => ({ meetingId: a.meetingId, userId: a.userId, name: attendeeName(a, names) })),
      noteCounts: Object.fromEntries(notes.map((n) => [n.meetingId, n._count._all])),
      decisionCounts: Object.fromEntries(decisions.map((n) => [n.meetingId, n._count._all])),
      minutes,
      openActionItemCounts: Object.fromEntries(open.filter((o) => o.meetingId).map((o) => [o.meetingId!, o._count._all])),
    });
  };
}

/** Reads a project's meetings in a date range with their people, notes, minutes and action items. */
export function createPrismaProjectMeetingsSource(prisma: PrismaClient) {
  return {
    async load(projectId: string, from: Date, to: Date): Promise<ProjectMeetingsData> {
      const select = {
        id: true, title: true, status: true, startAt: true, endAt: true, timeZone: true, location: true, onlineLink: true,
        recurrenceRule: true, recurrenceParentId: true, organizerId: true, recurrenceStart: true,
      } as const;
      // The most recent past meetings and the soonest coming ones, each capped — so a busy project
      // (daily series) never loses its upcoming meetings to its history.
      const now = new Date();
      const [past, coming] = await Promise.all([
        prisma.meeting.findMany({ where: { projectId, deletedAt: null, startAt: { gte: from, lt: now } }, orderBy: { startAt: 'desc' }, take: 200, select }),
        prisma.meeting.findMany({ where: { projectId, deletedAt: null, startAt: { gte: now, lt: to } }, orderBy: { startAt: 'asc' }, take: 300, select }),
      ]);
      const meetings = [...past.reverse(), ...coming];
      const ids = meetings.map((m) => m.id);
      // First meetings of the series shown that aren't loaded: older than the range, or deleted on their own.
      const missingRoots = [...new Set(meetings.map((m) => m.recurrenceParentId).filter((id): id is string => !!id && !ids.includes(id)))];
      const seriesRoots = missingRoots.length
        ? await prisma.meeting.findMany({ where: { id: { in: missingRoots } }, select: { id: true, title: true, recurrenceRule: true, recurrenceStart: true, startAt: true } })
        : [];
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
      const names = await namesOf(prisma, [...attendees.map((a) => a.userId), ...items.map((x) => x.assigneeId)]);
      return {
        meetings: meetings.map((m) => ({ ...m, recurrenceRule: (m.recurrenceRule as RecurrenceRule | null) ?? null })),
        seriesRoots: seriesRoots.map((r) => ({ ...r, recurrenceRule: (r.recurrenceRule as RecurrenceRule | null) ?? null })),
        attendees: attendees.map((a) => ({ meetingId: a.meetingId, userId: a.userId, name: attendeeName(a, names) })),
        decisions,
        noteCounts: Object.fromEntries(notes.map((n) => [n.meetingId, n._count._all])),
        minutes,
        actionItems: items.map((x) => ({ ...x, assigneeName: x.assigneeId ? names.get(x.assigneeId) ?? null : null })),
      };
    },
  };
}

export type ProjectMeetingsSource = ReturnType<typeof createPrismaProjectMeetingsSource>;
