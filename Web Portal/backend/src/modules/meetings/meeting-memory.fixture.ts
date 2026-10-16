/**
 * In-memory meeting + attendee stores for tests (a stand-in for the Prisma adapters, including
 * the series guard: one meeting per place in a series).
 */
import type { AttendeeRecord, AttendeeRepository, CreateAttendeeData } from './attendee-repository';
import type { CreateMeetingData, MeetingRecord, MeetingRepository, MeetingSeriesStore, UpdateMeetingData } from './meeting-repository';

export type MemoryMeetings = MeetingRepository & MeetingSeriesStore & { rows: Map<string, MeetingRecord> };

export function memoryMeetings(): MemoryMeetings {
  const rows = new Map<string, MeetingRecord>();
  let seq = 0;
  const alive = (m: MeetingRecord | undefined) => (m && !m.deletedAt ? m : null);
  const place = (m: MeetingRecord) => (m.recurrenceStart ?? m.startAt).getTime();
  const strip = (m: MeetingRecord): MeetingRecord => {
    const copy = { ...m };
    delete copy.deletedAt;
    return copy;
  };
  function assertFreePlace(id: string | null, parentId: string | null | undefined, start: Date | null | undefined) {
    if (!parentId || !start) return;
    for (const r of rows.values()) {
      if (r.id !== id && r.recurrenceParentId === parentId && r.recurrenceStart?.getTime() === start.getTime()) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
    }
  }
  function apply(id: string, patch: UpdateMeetingData): MeetingRecord {
    const current = rows.get(id);
    if (!current) throw new Error(`no meeting ${id}`);
    const next = { ...current, updatedAt: new Date(current.updatedAt.getTime() + 1000) } as MeetingRecord;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (next as unknown as Record<string, unknown>)[k] = v;
    rows.set(id, next);
    return next;
  }

  return {
    rows,
    async create(d: CreateMeetingData) {
      assertFreePlace(null, d.recurrenceParentId, d.recurrenceStart);
      const now = new Date('2026-01-01T00:00:00Z');
      const rec: MeetingRecord = {
        id: `m${++seq}`, title: d.title, description: d.description ?? null, category: d.category ?? null,
        status: d.status ?? 'DRAFT', projectId: d.projectId ?? null, organizerId: d.organizerId,
        location: d.location ?? null, onlineLink: d.onlineLink ?? null, startAt: d.startAt, endAt: d.endAt ?? null,
        timeZone: d.timeZone ?? null, recurrenceRule: d.recurrenceRule ?? null, recurrenceParentId: d.recurrenceParentId ?? null,
        recurrenceStart: d.recurrenceStart ?? null, templateId: d.templateId ?? null, transcript: null,
        invitesSentAt: d.invitesSentAt ?? null, reminderSentAt: null, createdById: d.createdById, createdAt: now, updatedAt: now,
        deletedAt: null,
      };
      rows.set(rec.id, rec);
      return strip(rec);
    },
    async findById(id) {
      const m = alive(rows.get(id));
      return m ? strip(m) : null;
    },
    async list(filter) {
      return [...rows.values()]
        .filter((m) => !m.deletedAt)
        .filter((m) => !filter.projectId || m.projectId === filter.projectId)
        .filter((m) => !filter.status || m.status === filter.status)
        .filter((m) => !filter.from || m.startAt >= filter.from)
        .filter((m) => !filter.to || m.startAt < filter.to)
        .sort((a, b) => (filter.from || filter.to ? a.startAt.getTime() - b.startAt.getTime() : b.startAt.getTime() - a.startAt.getTime()))
        .map(strip);
    },
    async update(id, patch) {
      assertFreePlace(id, patch.recurrenceParentId !== undefined ? patch.recurrenceParentId : rows.get(id)?.recurrenceParentId, patch.recurrenceStart);
      return strip(apply(id, patch));
    },
    async softDelete(id) {
      apply(id, {});
      rows.set(id, { ...rows.get(id)!, deletedAt: new Date() });
    },
    async accessCore(id) {
      const m = alive(rows.get(id));
      return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: [] } : null;
    },
    async markInvitesSent(id, at) {
      const m = rows.get(id);
      if (m) rows.set(id, { ...m, invitesSentAt: at });
    },
    async markReminderSent(id, at) {
      const m = rows.get(id);
      if (m) rows.set(id, { ...m, reminderSentAt: at });
    },
    async listUpcomingWithoutReminder() {
      return [];
    },
    async findAnyById(id) {
      const m = rows.get(id);
      return m ? { ...m } : null;
    },
    async listSeries(rootId) {
      const list = [...rows.values()].filter((m) => m.id === rootId || m.recurrenceParentId === rootId).sort((a, b) => place(a) - place(b));
      return list.sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : 0)).map((m) => ({ ...m }));
    },
    async listSeriesRoots() {
      return [...rows.values()].filter((m) => !m.recurrenceParentId && m.recurrenceRule && !m.recurrenceRule.paused).map((m) => ({ ...m }));
    },
    async applySeriesChanges(changes) {
      for (const c of changes) if (c.patch.recurrenceStart !== undefined) rows.set(c.id, { ...rows.get(c.id)!, recurrenceStart: null });
      for (const c of changes) {
        const parent = c.patch.recurrenceParentId !== undefined ? c.patch.recurrenceParentId : rows.get(c.id)?.recurrenceParentId;
        assertFreePlace(c.id, parent, c.patch.recurrenceStart);
        apply(c.id, c.patch);
      }
    },
    async removeMany(ids, opts) {
      for (const id of ids) {
        const m = rows.get(id);
        if (!m) continue;
        rows.set(id, { ...m, deletedAt: new Date(), ...(opts?.detach ? { recurrenceParentId: null, recurrenceStart: null, recurrenceRule: null } : {}) });
      }
    },
  };
}

export type MemoryAttendees = AttendeeRepository & { rows: Map<string, AttendeeRecord> };

export function memoryAttendees(): MemoryAttendees {
  const rows = new Map<string, AttendeeRecord>();
  let seq = 0;
  return {
    rows,
    async add(d: CreateAttendeeData) {
      const rec: AttendeeRecord = {
        id: `a${++seq}`, meetingId: d.meetingId, userId: d.userId ?? null, externalName: d.externalName ?? null,
        externalEmail: d.externalEmail ?? null, role: d.role ?? 'REQUIRED', attendance: d.attendance ?? 'INVITED',
        response: 'PENDING', respondedAt: null, invitedAt: null, department: d.department ?? null, createdAt: new Date(),
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async listByMeeting(meetingId) {
      return [...rows.values()].filter((a) => a.meetingId === meetingId);
    },
    async distinctUserIdsForMeetings(ids) {
      return [...new Set([...rows.values()].filter((a) => ids.includes(a.meetingId) && a.userId).map((a) => a.userId!))];
    },
    async update(id, patch) {
      const next = { ...rows.get(id)!, ...patch } as AttendeeRecord;
      rows.set(id, next);
      return next;
    },
    async remove(id) {
      rows.delete(id);
    },
    async markInvited(ids, at) {
      for (const id of ids) {
        const a = rows.get(id);
        if (a) rows.set(id, { ...a, invitedAt: at });
      }
    },
  };
}
