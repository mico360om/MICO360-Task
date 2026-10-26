import type { PrismaClient } from '@prisma/client';
import { normalizeFinalMinutes, type FinalMinutesContent } from '../meetings/final-minutes';
import type { ClientMinutesSource, ClientProjectSource, ClientTaskSource } from './client-view-payload';

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

function readContent(raw: string): FinalMinutesContent {
  try {
    return normalizeFinalMinutes(JSON.parse(raw));
  } catch {
    return normalizeFinalMinutes({ summary: raw });
  }
}

export function createPrismaClientViewSource(prisma: PrismaClient): ClientViewSource {
  const minutesWhere = (projectId: string, meetingId?: string) => ({
    status: 'APPROVED' as const,
    clientVisible: true,
    meeting: { projectId, deletedAt: null, ...(meetingId ? { id: meetingId } : {}) },
  });
  const minutesSelect = {
    content: true,
    status: true,
    clientVisible: true,
    approvedAt: true,
    meeting: { select: { id: true, title: true, startAt: true, timeZone: true } },
  } as const;
  type MinutesRow = { content: string; status: string; clientVisible: boolean; approvedAt: Date | null; meeting: { id: string; title: string; startAt: Date; timeZone: string | null } };
  const toMinutes = (r: MinutesRow): ClientMinutesSource => ({
    meetingId: r.meeting.id,
    title: r.meeting.title,
    startAt: r.meeting.startAt,
    timeZone: r.meeting.timeZone,
    status: r.status === 'APPROVED' ? 'APPROVED' : 'DRAFT',
    clientVisible: r.clientVisible,
    approvedAt: r.approvedAt,
    content: readContent(r.content),
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
      return rows.map(toMinutes);
    },
    async minutesOf(projectId, meetingId) {
      const row = await prisma.meetingMinutes.findFirst({ where: minutesWhere(projectId, meetingId), select: minutesSelect });
      return row ? toMinutes(row) : null;
    },
  };
}
