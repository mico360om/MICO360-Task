import type { PrismaClient, Prisma, Meeting } from '@prisma/client';
import type {
  MeetingRepository,
  MeetingRecord,
  CreateMeetingData,
  UpdateMeetingData,
  MeetingListFilter,
  RecurrenceRule,
  MeetingAccessCore,
} from './meeting-repository';

type Row = Meeting;

function toRecord(r: Row): MeetingRecord {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    status: r.status,
    projectId: r.projectId,
    organizerId: r.organizerId,
    location: r.location,
    onlineLink: r.onlineLink,
    startAt: r.startAt,
    endAt: r.endAt,
    timeZone: r.timeZone,
    recurrenceRule: (r.recurrenceRule as RecurrenceRule | null) ?? null,
    recurrenceParentId: r.recurrenceParentId,
    templateId: r.templateId,
    transcript: r.transcript,
    invitesSentAt: r.invitesSentAt,
    reminderSentAt: r.reminderSentAt,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function createPrismaMeetingRepository(prisma: PrismaClient): MeetingRepository {
  return {
    async create(data: CreateMeetingData) {
      const row = await prisma.meeting.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          category: data.category ?? null,
          status: data.status ?? 'DRAFT',
          projectId: data.projectId ?? null,
          organizerId: data.organizerId,
          location: data.location ?? null,
          onlineLink: data.onlineLink ?? null,
          startAt: data.startAt,
          endAt: data.endAt ?? null,
          timeZone: data.timeZone ?? null,
          recurrenceRule: (data.recurrenceRule ?? undefined) as Prisma.InputJsonValue | undefined,
          recurrenceParentId: data.recurrenceParentId ?? null,
          templateId: data.templateId ?? null,
          createdById: data.createdById,
        },
      });
      return toRecord(row);
    },

    async findById(id) {
      const row = await prisma.meeting.findFirst({ where: { id, deletedAt: null } });
      return row ? toRecord(row) : null;
    },

    async list(filter: MeetingListFilter) {
      const where: Prisma.MeetingWhereInput = { deletedAt: null };
      if (filter.projectId) where.projectId = filter.projectId;
      if (filter.status) where.status = filter.status;
      // Object-level scope: non-admins see meetings they organize/attend or in their accessible projects.
      const scope = filter.scope;
      if (scope && scope.projectIds !== null) {
        const or: Prisma.MeetingWhereInput[] = [
          { organizerId: scope.userId },
          { attendees: { some: { userId: scope.userId } } },
        ];
        if (scope.projectIds.length > 0) or.push({ projectId: { in: scope.projectIds } });
        where.OR = or;
      }
      const rows = await prisma.meeting.findMany({ where, orderBy: { startAt: 'desc' }, take: 500 });
      return rows.map(toRecord);
    },

    async update(id, patch: UpdateMeetingData) {
      const row = await prisma.meeting.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
          ...(patch.organizerId !== undefined ? { organizerId: patch.organizerId } : {}),
          ...(patch.location !== undefined ? { location: patch.location } : {}),
          ...(patch.onlineLink !== undefined ? { onlineLink: patch.onlineLink } : {}),
          ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
          ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
          ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
          ...(patch.recurrenceRule !== undefined ? { recurrenceRule: (patch.recurrenceRule ?? undefined) as Prisma.InputJsonValue | undefined } : {}),
        },
      });
      return toRecord(row);
    },

    async softDelete(id) {
      await prisma.meeting.update({ where: { id }, data: { deletedAt: new Date() } });
    },

    async accessCore(id): Promise<MeetingAccessCore | null> {
      const row = await prisma.meeting.findFirst({
        where: { id, deletedAt: null },
        select: { organizerId: true, createdById: true, projectId: true, attendees: { select: { userId: true } } },
      });
      if (!row) return null;
      return {
        organizerId: row.organizerId,
        createdById: row.createdById,
        projectId: row.projectId,
        attendeeUserIds: row.attendees.map((a) => a.userId).filter((u): u is string => !!u),
      };
    },

    async markInvitesSent(id, at) {
      await prisma.meeting.update({ where: { id }, data: { invitesSentAt: at } });
    },

    async markReminderSent(id, at) {
      await prisma.meeting.update({ where: { id }, data: { reminderSentAt: at } });
    },

    async listUpcomingWithoutReminder(now, leadMs) {
      const rows = await prisma.meeting.findMany({
        where: {
          deletedAt: null,
          reminderSentAt: null,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          startAt: { gte: now, lte: new Date(now.getTime() + leadMs) },
        },
        orderBy: { startAt: 'asc' },
        take: 200,
      });
      return rows.map(toRecord);
    },
  };
}
