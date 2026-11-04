/**
 * An in-memory named-series store for tests, over the in-memory meeting and attendee stores (a
 * stand-in for prisma-named-series-store.ts).
 */
import type { ActionItemRecord } from './action-item-repository';
import type { MemoryAttendees, MemoryMeetings } from './meeting-memory.fixture';
import type { MeetingRecord } from './meeting-repository';
import { familyRootOf, inDateOrder, type NamedSeriesRecord, type SeriesMeetingRow } from './named-series';
import type { NamedSeriesStore } from './named-series-store';

export type MemoryNamedSeries = NamedSeriesStore & {
  series: Map<string, NamedSeriesRecord>;
  actionItems: ActionItemRecord[];
  /** Meetings whose final minutes are approved. */
  finalMinutes: Set<string>;
};

export function memoryNamedSeries(meetings: MemoryMeetings, attendees?: MemoryAttendees): MemoryNamedSeries {
  const series = new Map<string, NamedSeriesRecord>();
  const actionItems: ActionItemRecord[] = [];
  const finalMinutes = new Set<string>();
  let seq = 0;
  const now = new Date('2026-01-01T00:00:00Z');

  const toRow = (m: MeetingRecord): SeriesMeetingRow => ({
    id: m.id,
    title: m.title,
    status: m.status,
    startAt: m.startAt,
    endAt: m.endAt,
    timeZone: m.timeZone,
    projectId: m.projectId,
    companyId: m.projectId ? null : (m.companyId ?? null),
    organizerId: m.organizerId,
    createdById: m.createdById,
    attendeeUserIds: attendees ? [...attendees.rows.values()].filter((a) => a.meetingId === m.id && a.userId).map((a) => a.userId!) : [],
    familyRootId: familyRootOf(m),
    seriesId: m.seriesId ?? null,
    minutesFinal: finalMinutes.has(m.id),
  });
  const alive = () => [...meetings.rows.values()].filter((m) => !m.deletedAt);
  const rec = (id: string) => {
    const s = series.get(id);
    if (!s) throw new Error(`no series ${id}`);
    return s;
  };

  return {
    series,
    actionItems,
    finalMinutes,
    async find(id) {
      return series.get(id) ?? null;
    },
    async create(data) {
      const s: NamedSeriesRecord = { id: `s${++seq}`, ...data, createdAt: now, updatedAt: now };
      series.set(s.id, s);
      return s;
    },
    async rename(id, name) {
      const s = { ...rec(id), name };
      series.set(id, s);
      return s;
    },
    async remove(id) {
      for (const m of meetings.rows.values()) if (m.seriesId === id) meetings.rows.set(m.id, { ...m, seriesId: null });
      series.delete(id);
    },
    async meetingsOf(seriesId) {
      return inDateOrder(alive().filter((m) => m.seriesId === seriesId).map(toRow));
    },
    async meeting(id) {
      const m = meetings.rows.get(id);
      return m && !m.deletedAt ? toRow(m) : null;
    },
    async family(rootId) {
      return inDateOrder(alive().filter((m) => m.id === rootId || m.recurrenceParentId === rootId).map(toRow));
    },
    async link(ids, seriesId) {
      for (const id of ids) {
        const m = meetings.rows.get(id);
        if (m) meetings.rows.set(id, { ...m, seriesId });
      }
    },
    async moveAll(fromId, toId) {
      for (const m of meetings.rows.values()) if (m.seriesId === fromId) meetings.rows.set(m.id, { ...m, seriesId: toId });
    },
    async ofPlace(place) {
      return [...series.values()]
        .filter((s) => s.projectId === place.projectId && (place.projectId !== null || s.companyId === place.companyId))
        .reverse();
    },
    async unseriedOfPlace(place, limit) {
      return inDateOrder(
        alive()
          .filter((m) => !m.seriesId && !familyRootOf(m))
          .filter((m) => m.projectId === place.projectId && (place.projectId !== null || (m.companyId ?? null) === place.companyId))
          .map(toRow),
      )
        .reverse()
        .slice(0, limit);
    },
    async names(ids) {
      return new Map(ids.flatMap((id) => (series.has(id) ? [[id, series.get(id)!.name] as const] : [])));
    },
    async openActionItems(ids) {
      return actionItems.filter((a) => a.meetingId && ids.includes(a.meetingId) && a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
    },
  };
}
