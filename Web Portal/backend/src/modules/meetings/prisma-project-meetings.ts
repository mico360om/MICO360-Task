import type { PrismaClient } from '@prisma/client';
import type { RecurrenceRule } from './meeting-repository';
import { buildMeetingListCounts, type ProjectMeetingsData } from './project-meetings';
import { PERSON_SUMMARY_SELECT, personSummary, type PersonSummary } from '../../lib/person-summary';

/**
 * These people's names and photos (team members by name; unknown ids are left out) — one query for the
 * whole list (avatar hotfix: the cards' faces show the photos).
 */
async function peopleOf(prisma: PrismaClient, ids: Array<string | null>): Promise<Map<string, PersonSummary>> {
  const userIds = [...new Set(ids.filter((u): u is string => !!u))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: PERSON_SUMMARY_SELECT }) : [];
  return new Map(users.map((u) => [u.id, personSummary(u)]));
}

/** An attendee's display name: a team member's name, or a guest's name or email. */
const attendeeName = (a: { userId: string | null; externalName: string | null; externalEmail: string | null }, people: Map<string, PersonSummary>) =>
  a.userId ? people.get(a.userId)?.name ?? 'A team member' : a.externalName ?? a.externalEmail ?? 'A guest';
/** An attendee's photo: a team member's own (null without one); a guest has none. */
const attendeePhoto = (a: { userId: string | null }, people: Map<string, PersonSummary>) => (a.userId ? people.get(a.userId)?.avatarUrl ?? null : null);

/**
 * The meetings list's summary of each meeting — people (the first few by name), minutes,
 * decisions and open action items, and `viewerId`'s own row on it — in a handful of queries for the
 * whole list.
 */
export function createPrismaMeetingListCounts(prisma: PrismaClient) {
  return async (ids: string[], viewerId?: string) => {
    const [attendees, open, notes, decisions, minutes] = await Promise.all([
      prisma.meetingAttendee.findMany({ where: { meetingId: { in: ids } }, orderBy: { createdAt: 'asc' }, select: { id: true, meetingId: true, userId: true, externalName: true, externalEmail: true, response: true } }),
      prisma.actionItem.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, status: { notIn: ['COMPLETED', 'CANCELLED'] } }, _count: { _all: true } }),
      prisma.meetingNote.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
      prisma.meetingNote.groupBy({ by: ['meetingId'], where: { meetingId: { in: ids }, deletedAt: null, type: 'DECISION' }, _count: { _all: true } }),
      prisma.meetingMinutes.findMany({ where: { meetingId: { in: ids } }, select: { meetingId: true, status: true } }),
    ]);
    const people = await peopleOf(prisma, attendees.map((a) => a.userId));
    return buildMeetingListCounts(ids, {
      attendees: attendees.map((a) => ({ meetingId: a.meetingId, userId: a.userId, name: attendeeName(a, people), avatarUrl: attendeePhoto(a, people), id: a.id, response: a.response })),
      noteCounts: Object.fromEntries(notes.map((n) => [n.meetingId, n._count._all])),
      decisionCounts: Object.fromEntries(decisions.map((n) => [n.meetingId, n._count._all])),
      minutes,
      openActionItemCounts: Object.fromEntries(open.filter((o) => o.meetingId).map((o) => [o.meetingId!, o._count._all])),
    }, viewerId);
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
          select: { id: true, meetingId: true, body: true, bodyFormat: true, createdAt: true },
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
      const people = await peopleOf(prisma, [...attendees.map((a) => a.userId), ...items.map((x) => x.assigneeId)]);
      return {
        meetings: meetings.map((m) => ({ ...m, recurrenceRule: (m.recurrenceRule as RecurrenceRule | null) ?? null })),
        seriesRoots: seriesRoots.map((r) => ({ ...r, recurrenceRule: (r.recurrenceRule as RecurrenceRule | null) ?? null })),
        attendees: attendees.map((a) => ({ meetingId: a.meetingId, userId: a.userId, name: attendeeName(a, people), avatarUrl: attendeePhoto(a, people) })),
        decisions,
        noteCounts: Object.fromEntries(notes.map((n) => [n.meetingId, n._count._all])),
        minutes,
        actionItems: items.map((x) => ({ ...x, assigneeName: x.assigneeId ? people.get(x.assigneeId)?.name ?? null : null })),
      };
    },
  };
}

export type ProjectMeetingsSource = ReturnType<typeof createPrismaProjectMeetingsSource>;
