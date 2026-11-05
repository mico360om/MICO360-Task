import { Prisma, type PrismaClient } from '@prisma/client';
import type { ActionItemRecord } from './action-item-repository';
import type { NamedSeriesRecord, SeriesMeetingRow, SeriesPlace } from './named-series';
import type { NamedSeriesStore } from './named-series-store';

/** The columns a series needs of a meeting. */
const ROW_SELECT = {
  id: true,
  title: true,
  status: true,
  startAt: true,
  endAt: true,
  timeZone: true,
  projectId: true,
  companyId: true,
  organizerId: true,
  createdById: true,
  recurrenceParentId: true,
  recurrenceRule: true,
  seriesId: true,
  attendees: { select: { userId: true } },
  minutes: { select: { status: true } },
} satisfies Prisma.MeetingSelect;

type Row = Prisma.MeetingGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(r: Row): SeriesMeetingRow {
  const repeats = r.recurrenceParentId ?? (r.recurrenceRule !== null && r.recurrenceRule !== undefined ? r.id : null);
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    startAt: r.startAt,
    endAt: r.endAt,
    timeZone: r.timeZone,
    projectId: r.projectId,
    companyId: r.projectId ? null : r.companyId,
    organizerId: r.organizerId,
    createdById: r.createdById,
    attendeeUserIds: r.attendees.map((a) => a.userId).filter((u): u is string => !!u),
    familyRootId: repeats,
    seriesId: r.seriesId,
    minutesFinal: r.minutes?.status === 'APPROVED' || r.minutes?.status === 'SENT',
  };
}

const toSeries = (s: Prisma.MeetingSeriesGetPayload<object>): NamedSeriesRecord => ({
  id: s.id,
  name: s.name,
  projectId: s.projectId,
  companyId: s.companyId,
  auto: s.auto,
  createdById: s.createdById,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const placeWhere = (place: SeriesPlace): Prisma.MeetingWhereInput =>
  place.projectId ? { projectId: place.projectId } : { projectId: null, companyId: place.companyId };

/** A repeating meeting: the first of a family (it holds the rule) or one made from it. */
const REPEATS: Prisma.MeetingWhereInput = { OR: [{ recurrenceParentId: { not: null } }, { recurrenceRule: { not: Prisma.DbNull } }] };

const ORDER: Prisma.MeetingOrderByWithRelationInput[] = [{ startAt: 'asc' }, { id: 'asc' }];

export function createPrismaNamedSeriesStore(prisma: PrismaClient): NamedSeriesStore {
  return {
    async find(id) {
      const s = await prisma.meetingSeries.findUnique({ where: { id } });
      return s ? toSeries(s) : null;
    },

    async create(data) {
      return toSeries(await prisma.meetingSeries.create({ data }));
    },

    async rename(id, name) {
      return toSeries(await prisma.meetingSeries.update({ where: { id }, data: { name } }));
    },

    async remove(id) {
      // The foreign key clears the meetings' seriesId (ON DELETE SET NULL); deleted meetings too.
      await prisma.meetingSeries.deleteMany({ where: { id } });
    },

    async meetingsOf(seriesId) {
      return (await prisma.meeting.findMany({ where: { seriesId, deletedAt: null }, select: ROW_SELECT, orderBy: ORDER })).map(toRow);
    },

    async meeting(id) {
      const r = await prisma.meeting.findFirst({ where: { id, deletedAt: null }, select: ROW_SELECT });
      return r ? toRow(r) : null;
    },

    async family(rootId) {
      const rows = await prisma.meeting.findMany({
        where: { deletedAt: null, OR: [{ id: rootId }, { recurrenceParentId: rootId }] },
        select: ROW_SELECT,
        orderBy: ORDER,
      });
      // A first meeting whose rule was cleared is no longer of the family (it is a one-off).
      return rows.map(toRow).filter((r) => r.familyRootId === rootId);
    },

    async link(meetingIds, seriesId) {
      if (meetingIds.length === 0) return;
      await prisma.meeting.updateMany({ where: { id: { in: meetingIds } }, data: { seriesId } });
    },

    async moveAll(fromSeriesId, toSeriesId) {
      await prisma.meeting.updateMany({ where: { seriesId: fromSeriesId }, data: { seriesId: toSeriesId } });
    },

    async ofPlace(place) {
      const where: Prisma.MeetingSeriesWhereInput = place.projectId ? { projectId: place.projectId } : { projectId: null, companyId: place.companyId };
      return (await prisma.meetingSeries.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 500 })).map(toSeries);
    },

    async unseriedOfPlace(place, limit) {
      const rows = await prisma.meeting.findMany({
        where: { AND: [placeWhere(place), { deletedAt: null, seriesId: null }, { NOT: REPEATS }] },
        select: ROW_SELECT,
        orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
        take: limit,
      });
      return rows.map(toRow);
    },

    async names(ids) {
      if (ids.length === 0) return new Map();
      const rows = await prisma.meetingSeries.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
      return new Map(rows.map((r) => [r.id, r.name]));
    },

    async openActionItems(meetingIds) {
      if (meetingIds.length === 0) return [];
      const rows = await prisma.actionItem.findMany({
        where: { meetingId: { in: meetingIds }, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map(
        (r): ActionItemRecord => ({
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
        }),
      );
    },
  };
}
