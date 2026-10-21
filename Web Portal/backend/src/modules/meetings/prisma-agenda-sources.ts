import type { PrismaClient } from '@prisma/client';
import type { AgendaLeftover, AgendaSourceStore } from './agenda-sources';

/** Draft agenda's project tasks and earlier meetings' leftovers, read from MySQL. */
export function createPrismaAgendaSources(prisma: PrismaClient): AgendaSourceStore {
  const countable = { deletedAt: null, status: { not: 'CANCELLED' as const } };
  return {
    async openTasks(projectId, dueBy) {
      const rows = await prisma.task.findMany({
        where: {
          projectId,
          deletedAt: null,
          completedAt: null,
          AND: [{ column: { category: { not: 'DONE' } } }, { OR: [{ column: { category: 'BLOCKED' } }, { dueDate: { lte: dueBy } }] }],
        },
        select: { key: true, title: true, dueDate: true, column: { select: { category: true } } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: 100,
      });
      return rows.map((r) => ({ key: r.key, title: r.title, dueDate: r.dueDate, blocked: r.column.category === 'BLOCKED' }));
    },

    async previousInSeries(meetingId) {
      const m = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true, startAt: true, recurrenceParentId: true, recurrenceRule: true } });
      const root = m ? (m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null)) : null;
      if (!m || !root) return null;
      const prev = await prisma.meeting.findFirst({
        where: { ...countable, id: { not: m.id }, OR: [{ id: root }, { recurrenceParentId: root }], startAt: { lt: m.startAt } },
        orderBy: { startAt: 'desc' },
        select: { id: true },
      });
      return prev?.id ?? null;
    },

    async lastProjectMeetingBefore(projectId, before, excludeId) {
      const last = await prisma.meeting.findFirst({
        where: { ...countable, projectId, startAt: { lt: before }, ...(excludeId ? { id: { not: excludeId } } : {}) },
        orderBy: { startAt: 'desc' },
        select: { id: true },
      });
      return last?.id ?? null;
    },

    async leftovers(meetingId) {
      const [actions, agenda] = await Promise.all([
        prisma.actionItem.findMany({
          where: { meetingId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          select: { description: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 30,
        }),
        prisma.agendaItem.findMany({ where: { meetingId, completed: false }, select: { title: true }, orderBy: { position: 'asc' }, take: 30 }),
      ]);
      return [
        ...actions.map((a): AgendaLeftover => ({ title: a.description.trim().slice(0, 300), kind: 'action' })),
        ...agenda.map((g): AgendaLeftover => ({ title: g.title, kind: 'agenda' })),
      ];
    },
  };
}
