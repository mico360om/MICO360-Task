import type { PrismaClient } from '@prisma/client';
import { normalizeFinalMinutes, type FinalMinutesContent } from '../meetings/final-minutes';
import type { ClientMinutesSource, ClientProjectSource, ClientTaskSource } from './client-view-payload';
import { nameVariants, type PersonName } from './client-minutes-content';

/** What the client page reads. Every query selects only the fields the page may show. */
export interface ClientViewSource {
  /** The project; `gone` when it was deleted (the client is told it is no longer shared). */
  project(projectId: string): Promise<(ClientProjectSource & { gone: boolean }) | null>;
  /** Every live task of the project, and how many are done (a DONE column or a completion time). */
  counts(projectId: string): Promise<{ total: number; done: number }>;
  /** Only the live tasks (and milestones) marked "Show to client". */
  items(projectId: string): Promise<ClientTaskSource[]>;
  /** Only the approved final minutes marked "Show to client", of the project's live meetings. */
  minutes(projectId: string): Promise<ClientMinutesSource[]>;
  /** One of those, for its PDF; null when that meeting's minutes aren't shown to the client. */
  minutesOf(projectId: string, meetingId: string): Promise<ClientMinutesSource | null>;
}

export function readMinutesContent(raw: string): FinalMinutesContent {
  try {
    return normalizeFinalMinutes(JSON.parse(raw));
  } catch {
    return normalizeFinalMinutes({ summary: raw });
  }
}

/**
 * For each meeting, the names its minutes may carry: the project's owner, named manager and team, the
 * meeting's organizer and attendees (guests too) — each person's full and first name. In a fixed number
 * of queries for any number of meetings.
 */
export async function peopleNames(prisma: PrismaClient, projectId: string | null, meetingIds: string[]): Promise<Map<string, string[]>> {
  const person = { select: { firstName: true, lastName: true } } as const;
  const [project, meetings] = await Promise.all([
    projectId
      ? prisma.project.findUnique({ where: { id: projectId }, select: { manager: person, ownerId: true, members: { select: { user: person } } } })
      : Promise.resolve(null),
    meetingIds.length
      ? prisma.meeting.findMany({ where: { id: { in: meetingIds } }, select: { id: true, organizerId: true, attendees: { select: { userId: true, externalName: true } } } })
      : Promise.resolve([]),
  ]);
  const userIds = [...new Set([project?.ownerId, ...meetings.flatMap((m) => [m.organizerId, ...m.attendees.map((a) => a.userId)])].filter((id): id is string => !!id))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const projectPeople: PersonName[] = [
    ...(project?.manager ? [project.manager] : []),
    ...(project?.ownerId && userById.get(project.ownerId) ? [userById.get(project.ownerId)!] : []),
    ...(project?.members ?? []).map((m) => m.user),
  ];
  const out = new Map<string, string[]>();
  for (const m of meetings) {
    const meetingPeople: PersonName[] = [
      ...[m.organizerId, ...m.attendees.map((a) => a.userId)].map((id) => (id ? userById.get(id) : undefined)).filter((u): u is NonNullable<typeof u> => !!u),
      ...m.attendees.filter((a) => !a.userId && a.externalName).map((a) => ({ name: a.externalName! })),
    ];
    out.set(m.id, nameVariants([...projectPeople, ...meetingPeople]));
  }
  return out;
}

export function createPrismaClientViewSource(prisma: PrismaClient): ClientViewSource {
  // Shown only for the project they were marked on, while the meeting is still filed under it.
  const minutesWhere = (projectId: string, meetingId?: string) => ({
    status: 'APPROVED' as const,
    clientVisible: true,
    clientVisibleProjectId: projectId,
    meeting: { projectId, deletedAt: null, ...(meetingId ? { id: meetingId } : {}) },
  });
  const minutesSelect = {
    content: true,
    status: true,
    clientVisible: true,
    clientShowRisks: true,
    approvedAt: true,
    meeting: { select: { id: true, title: true, startAt: true, endAt: true, timeZone: true } },
  } as const;
  type MinutesRow = { content: string; status: string; clientVisible: boolean; clientShowRisks: boolean; approvedAt: Date | null; meeting: { id: string; title: string; startAt: Date; endAt: Date | null; timeZone: string | null } };
  const toMinutes = (r: MinutesRow, people: string[]): ClientMinutesSource => ({
    meetingId: r.meeting.id,
    title: r.meeting.title,
    startAt: r.meeting.startAt,
    endAt: r.meeting.endAt,
    timeZone: r.meeting.timeZone,
    status: r.status === 'APPROVED' ? 'APPROVED' : 'DRAFT',
    clientVisible: r.clientVisible,
    approvedAt: r.approvedAt,
    content: readMinutesContent(r.content),
    showRisks: r.clientShowRisks,
    people,
  });

  return {
    async project(projectId) {
      const p = await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, code: true, number: true, clientName: true, status: true, color: true, icon: true, imageUrl: true, startDate: true, targetDate: true, deletedAt: true },
      });
      if (!p) return null;
      const { deletedAt, ...look } = p;
      return { ...look, gone: deletedAt !== null };
    },
    async counts(projectId) {
      const live = { projectId, deletedAt: null };
      const [total, done] = await Promise.all([
        prisma.task.count({ where: live }),
        prisma.task.count({ where: { ...live, OR: [{ completedAt: { not: null } }, { column: { category: 'DONE' } }] } }),
      ]);
      return { total, done };
    },
    async items(projectId) {
      const rows = await prisma.task.findMany({
        where: { projectId, deletedAt: null, clientVisible: true },
        select: { title: true, isMilestone: true, clientVisible: true, dueDate: true, completedAt: true, column: { select: { category: true } } },
      });
      return rows.map((t) => ({
        title: t.title,
        isMilestone: t.isMilestone,
        clientVisible: t.clientVisible,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        columnCategory: t.column?.category ?? null,
      }));
    },
    async minutes(projectId) {
      const rows = await prisma.meetingMinutes.findMany({ where: minutesWhere(projectId), select: minutesSelect });
      const names = await peopleNames(prisma, projectId, rows.map((r) => r.meeting.id));
      return rows.map((r) => toMinutes(r, names.get(r.meeting.id) ?? []));
    },
    async minutesOf(projectId, meetingId) {
      const row = await prisma.meetingMinutes.findFirst({ where: minutesWhere(projectId, meetingId), select: minutesSelect });
      if (!row) return null;
      return toMinutes(row, (await peopleNames(prisma, projectId, [meetingId])).get(meetingId) ?? []);
    },
  };
}
