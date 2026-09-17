import type { PrismaClient, ActionItem, Prisma } from '@prisma/client';
import type {
  ActionItemRepository,
  ActionItemRecord,
  CreateActionItemData,
  UpdateActionItemData,
  AssigneeListFilter,
} from './action-item-repository';

function toRecord(r: ActionItem): ActionItemRecord {
  return {
    id: r.id,
    meetingId: r.meetingId,
    agendaItemId: r.agendaItemId,
    sourceNoteId: r.sourceNoteId,
    projectId: r.projectId,
    description: r.description,
    assigneeId: r.assigneeId,
    priority: r.priority,
    status: r.status,
    dueDate: r.dueDate,
    progress: r.progress,
    completedAt: r.completedAt,
    taskId: r.taskId,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function createPrismaActionItemRepository(prisma: PrismaClient): ActionItemRepository {
  return {
    async create(data: CreateActionItemData) {
      const row = await prisma.actionItem.create({
        data: {
          meetingId: data.meetingId ?? null,
          agendaItemId: data.agendaItemId ?? null,
          sourceNoteId: data.sourceNoteId ?? null,
          projectId: data.projectId ?? null,
          description: data.description,
          assigneeId: data.assigneeId ?? null,
          priority: data.priority ?? 'NORMAL',
          status: data.status ?? 'OPEN',
          dueDate: data.dueDate ?? null,
          createdById: data.createdById,
        },
      });
      return toRecord(row);
    },

    async findById(id) {
      const row = await prisma.actionItem.findUnique({ where: { id } });
      return row ? toRecord(row) : null;
    },

    async listByMeeting(meetingId) {
      const rows = await prisma.actionItem.findMany({ where: { meetingId }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }] });
      return rows.map(toRecord);
    },

    async listForAssignee(userId, filter: AssigneeListFilter = {}) {
      const where: Prisma.ActionItemWhereInput = { assigneeId: userId };
      if (filter.status) where.status = filter.status;
      else if (filter.openOnly) where.status = { notIn: ['COMPLETED', 'CANCELLED'] };
      const rows = await prisma.actionItem.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
      return rows.map(toRecord);
    },

    async update(id, patch: UpdateActionItemData) {
      const row = await prisma.actionItem.update({
        where: { id },
        data: {
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.assigneeId !== undefined ? { assigneeId: patch.assigneeId } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
          ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
          ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
          ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
        },
      });
      return toRecord(row);
    },

    async remove(id) {
      await prisma.actionItem.delete({ where: { id } });
    },
  };
}
