import type { PrismaClient, AgendaItem } from '@prisma/client';
import type { AgendaRepository, AgendaItemRecord, CreateAgendaData, UpdateAgendaData } from './agenda-repository';

type Row = AgendaItem;

function toRecord(r: Row): AgendaItemRecord {
  return {
    id: r.id,
    meetingId: r.meetingId,
    title: r.title,
    ownerId: r.ownerId,
    expectedMinutes: r.expectedMinutes,
    position: r.position,
    completed: r.completed,
    linkedPrevActionId: r.linkedPrevActionId,
    createdAt: r.createdAt,
  };
}

export function createPrismaAgendaRepository(prisma: PrismaClient): AgendaRepository {
  return {
    async add(data: CreateAgendaData) {
      const row = await prisma.agendaItem.create({
        data: {
          meetingId: data.meetingId,
          title: data.title,
          ownerId: data.ownerId ?? null,
          expectedMinutes: data.expectedMinutes ?? null,
          position: data.position,
          linkedPrevActionId: data.linkedPrevActionId ?? null,
        },
      });
      return toRecord(row);
    },

    async findById(id) {
      const row = await prisma.agendaItem.findUnique({ where: { id } });
      return row ? toRecord(row) : null;
    },

    async listByMeeting(meetingId) {
      const rows = await prisma.agendaItem.findMany({ where: { meetingId }, orderBy: { position: 'asc' } });
      return rows.map(toRecord);
    },

    async update(id, patch: UpdateAgendaData) {
      const row = await prisma.agendaItem.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
          ...(patch.expectedMinutes !== undefined ? { expectedMinutes: patch.expectedMinutes } : {}),
          ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
          ...(patch.position !== undefined ? { position: patch.position } : {}),
        },
      });
      return toRecord(row);
    },

    async remove(id) {
      await prisma.agendaItem.delete({ where: { id } });
    },

    async setPositions(updates) {
      if (updates.length === 0) return;
      await prisma.$transaction(updates.map((u) => prisma.agendaItem.update({ where: { id: u.id }, data: { position: u.position } })));
    },
  };
}
