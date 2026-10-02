import type { PrismaClient, MeetingNote } from '@prisma/client';
import type { NoteRepository, NoteRecord, CreateNoteData, UpdateNoteData } from './note-repository';

type Row = MeetingNote;

function toRecord(r: Row): NoteRecord {
  return {
    id: r.id,
    meetingId: r.meetingId,
    agendaItemId: r.agendaItemId,
    authorId: r.authorId,
    type: r.type,
    body: r.body,
    highlighted: r.highlighted,
    taskId: r.taskId,
    actionItemId: r.actionItemId,
    decisionId: r.decisionId,
    createdAt: r.createdAt,
    editedAt: r.editedAt,
  };
}

export function createPrismaNoteRepository(prisma: PrismaClient): NoteRepository {
  return {
    async add(data: CreateNoteData) {
      const row = await prisma.meetingNote.create({
        data: {
          meetingId: data.meetingId,
          agendaItemId: data.agendaItemId ?? null,
          authorId: data.authorId,
          type: data.type,
          body: data.body,
          highlighted: data.highlighted ?? false,
        },
      });
      return toRecord(row);
    },

    async findById(id) {
      const row = await prisma.meetingNote.findFirst({ where: { id, deletedAt: null } });
      return row ? toRecord(row) : null;
    },

    async listByMeeting(meetingId) {
      const rows = await prisma.meetingNote.findMany({ where: { meetingId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
      return rows.map(toRecord);
    },

    async update(id, patch: UpdateNoteData) {
      const row = await prisma.meetingNote.update({
        where: { id },
        data: {
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.highlighted !== undefined ? { highlighted: patch.highlighted } : {}),
          ...(patch.agendaItemId !== undefined ? { agendaItemId: patch.agendaItemId } : {}),
          ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
          ...(patch.editedAt !== undefined ? { editedAt: patch.editedAt } : {}),
        },
      });
      return toRecord(row);
    },

    async remove(id) {
      await prisma.meetingNote.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    },

    async findDeleted(id) {
      const row = await prisma.meetingNote.findFirst({ where: { id, deletedAt: { not: null } } });
      return row ? toRecord(row) : null;
    },

    async restore(id) {
      return toRecord(await prisma.meetingNote.update({ where: { id }, data: { deletedAt: null } }));
    },

    async claimTask(id, marker) {
      const { count } = await prisma.meetingNote.updateMany({ where: { id, taskId: null, deletedAt: null }, data: { taskId: marker } });
      return count === 1;
    },

    async releaseTaskClaim(id, marker) {
      await prisma.meetingNote.updateMany({ where: { id, taskId: marker }, data: { taskId: null } });
    },
  };
}
