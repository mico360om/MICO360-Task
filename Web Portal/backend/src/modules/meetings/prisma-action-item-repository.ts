import type { PrismaClient, ActionItem, Prisma } from '@prisma/client';
import { hasActiveCompany, sharedCompanyWhere } from '../companies/company-access';
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
          taskId: data.taskId ?? null,
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

    async listByTask(taskId) {
      return (await prisma.actionItem.findMany({ where: { taskId } })).map(toRecord);
    },

    async listForAssignee(userId, filter: AssigneeListFilter = {}) {
      // Items from deleted meetings drop out of "My Action Items" (standalone items stay).
      const where: Prisma.ActionItemWhereInput = {
        assigneeId: userId,
        OR: [{ meetingId: null }, { meeting: { is: { deletedAt: null } } }],
      };
      if (filter.status) where.status = filter.status;
      else if (filter.openOnly) where.status = { notIn: ['COMPLETED', 'CANCELLED'] };
      if (filter.pick) {
        // companies: the picked company's items only (see AssigneeListFilter.pick).
        const { companyId } = filter.pick;
        // The company's projects (they're the person's own items: whether or not they're on its team).
        const projectIds = (await prisma.projectCompany.findMany({ where: { companyId }, select: { projectId: true } })).map((r) => r.projectId);
        where.AND = [
          {
            OR: [
              { projectId: { in: projectIds } },
              { projectId: null, meeting: { is: { projectId: { in: projectIds } } } },
              { projectId: null, meeting: { is: { projectId: null, companyId } } },
              { projectId: null, meetingId: null },
            ],
          },
        ];
      }
      else if (!filter.admin) {
        // companies: no pick — the person's own items inside their companies (see AssigneeListFilter.admin).
        const mine = (await prisma.project.findMany({ where: sharedCompanyWhere(userId), select: { id: true } })).map((p) => p.id);
        // Archived means no access: with no active company of their own, only items of no meeting or project.
        const active = await hasActiveCompany(prisma, userId);
        where.AND = [
          {
            OR: [
              { projectId: null, meetingId: null },
              ...(active
                ? [
                    { meeting: { is: { OR: [{ organizerId: userId }, { createdById: userId }, { attendees: { some: { userId } } }] } } },
                    { projectId: { in: mine } },
                    { projectId: null, meeting: { is: { projectId: { in: mine } } } },
                    { projectId: null, meeting: { is: { projectId: null, OR: [{ companyId: null }, { company: { status: 'ACTIVE' as const, members: { some: { userId } } } }] } } },
                  ]
                : []),
            ],
          },
        ];
      }
      if (filter.admin && filter.projectIds) {
        // 1.22 "Show my projects only" (see AssigneeListFilter.projectIds).
        const ids = filter.projectIds;
        const own = { OR: [{ organizerId: userId }, { createdById: userId }, { attendees: { some: { userId } } }] };
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          {
            OR: [
              { projectId: { in: ids } },
              { projectId: null, meeting: { is: { projectId: { in: ids } } } },
              { meeting: { is: own } },
              { projectId: null, meetingId: null },
              { projectId: null, meeting: { is: { projectId: null } } },
            ],
          },
        ];
      }
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
