import { Prisma, type PrismaClient, type Meeting } from '@prisma/client';
import type {
  MeetingRepository,
  MeetingRecord,
  CreateMeetingData,
  UpdateMeetingData,
  MeetingListFilter,
  RecurrenceRule,
  MeetingAccessCore,
  MeetingSeriesStore,
  EndedMeetingSweep,
} from './meeting-repository';
import { MEETING_DEFAULT_LENGTH_MS } from './meeting-end';

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
    recurrenceStart: r.recurrenceStart,
    templateId: r.templateId,
    transcript: r.transcript,
    invitesSentAt: r.invitesSentAt,
    reminderSentAt: r.reminderSentAt,
    createdById: r.createdById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** A record with its deletion time (series bookkeeping sees deleted meetings too). */
const withDeleted = (r: Row): MeetingRecord => ({ ...toRecord(r), deletedAt: r.deletedAt });

/** The columns an update may set (undefined leaves a column unchanged). */
function updateData(patch: UpdateMeetingData): Prisma.MeetingUncheckedUpdateInput {
  return {
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
    // null clears the rule (a series made one-off again); undefined leaves it unchanged.
    ...(patch.recurrenceRule !== undefined
      ? { recurrenceRule: patch.recurrenceRule === null ? Prisma.DbNull : (patch.recurrenceRule as unknown as Prisma.InputJsonValue) }
      : {}),
    ...(patch.recurrenceParentId !== undefined ? { recurrenceParentId: patch.recurrenceParentId } : {}),
    ...(patch.recurrenceStart !== undefined ? { recurrenceStart: patch.recurrenceStart } : {}),
    ...(patch.invitesSentAt !== undefined ? { invitesSentAt: patch.invitesSentAt } : {}),
  };
}

export function createPrismaMeetingRepository(prisma: PrismaClient): MeetingRepository & MeetingSeriesStore & EndedMeetingSweep {
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
          recurrenceStart: data.recurrenceStart ?? null,
          templateId: data.templateId ?? null,
          invitesSentAt: data.invitesSentAt ?? null,
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
      if (filter.organizerId) where.organizerId = filter.organizerId;
      if (filter.from || filter.to) where.startAt = { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) };
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
      // A calendar range lists every meeting in it; the plain list is the latest 500.
      const ranged = !!(filter.from || filter.to);
      const rows = await prisma.meeting.findMany({ where, orderBy: { startAt: ranged ? 'asc' : 'desc' }, take: ranged ? 2000 : 500 });
      return rows.map(toRecord);
    },

    async update(id, patch: UpdateMeetingData) {
      const row = await prisma.meeting.update({ where: { id }, data: updateData(patch) });
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

    async completeEnded(now) {
      const ended = await prisma.meeting.findMany({
        where: {
          deletedAt: null,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          // The same rule as meetingHasEnded: its end time, else an hour after it starts.
          OR: [{ endAt: { lte: now } }, { endAt: null, startAt: { lte: new Date(now.getTime() - MEETING_DEFAULT_LENGTH_MS) } }],
        },
        select: { id: true },
      });
      const ids = ended.map((m) => m.id);
      if (ids.length) {
        // The status check again, so a meeting cancelled meanwhile stays cancelled.
        await prisma.meeting.updateMany({ where: { id: { in: ids }, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } }, data: { status: 'COMPLETED' } });
      }
      return ids;
    },

    async findAnyById(id) {
      const row = await prisma.meeting.findUnique({ where: { id } });
      return row ? withDeleted(row) : null;
    },

    async listSeries(rootId) {
      const rows = await prisma.meeting.findMany({
        where: { OR: [{ id: rootId }, { recurrenceParentId: rootId }] },
        orderBy: [{ recurrenceStart: 'asc' }, { startAt: 'asc' }],
      });
      // The first meeting leads even if it was moved after a later one.
      return rows.map(withDeleted).sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : 0));
    },

    async listSeriesRoots() {
      const rows = await prisma.meeting.findMany({
        where: { recurrenceParentId: null, recurrenceRule: { not: Prisma.DbNull } },
        take: 5000,
      });
      return rows.map(withDeleted).filter((r) => r.recurrenceRule && !r.recurrenceRule.paused);
    },

    async applySeriesChanges(changes, remove = []) {
      if (changes.length === 0 && remove.length === 0) return;
      await prisma.$transaction(async (tx) => {
        // Clear the places being changed or freed first: two meetings swapping places never share one.
        const clearing = [...changes.filter((c) => c.patch.recurrenceStart !== undefined).map((c) => c.id), ...remove];
        if (clearing.length) await tx.meeting.updateMany({ where: { id: { in: clearing } }, data: { recurrenceStart: null } });
        if (remove.length) {
          await tx.meeting.updateMany({
            where: { id: { in: remove } },
            data: { deletedAt: new Date(), recurrenceParentId: null, recurrenceRule: Prisma.DbNull },
          });
        }
        for (const c of changes) await tx.meeting.update({ where: { id: c.id }, data: updateData(c.patch) });
      });
    },

    async removeMany(ids, opts) {
      if (ids.length === 0) return;
      await prisma.meeting.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date(), ...(opts?.detach ? { recurrenceParentId: null, recurrenceStart: null, recurrenceRule: Prisma.DbNull } : {}) },
      });
    },
  };
}
