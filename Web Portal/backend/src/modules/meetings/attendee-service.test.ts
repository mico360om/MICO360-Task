import { describe, it, expect } from 'vitest';
import { createAttendeeService } from './attendee-service';
import type { AttendeeRepository, AttendeeRecord, CreateAttendeeData, UpdateAttendeeData } from './attendee-repository';

function inMemory(): AttendeeRepository {
  const rows = new Map<string, AttendeeRecord>();
  let seq = 0;
  return {
    async add(d: CreateAttendeeData) {
      const rec: AttendeeRecord = {
        id: `a${seq++}`, meetingId: d.meetingId, userId: d.userId ?? null,
        externalName: d.externalName ?? null, externalEmail: d.externalEmail ?? null,
        role: d.role ?? 'REQUIRED', attendance: d.attendance ?? 'INVITED', department: d.department ?? null,
        createdAt: new Date(),
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId); },
    async distinctUserIdsForMeetings(meetingIds) {
      const set = new Set<string>();
      for (const a of rows.values()) if (a.userId && meetingIds.includes(a.meetingId)) set.add(a.userId);
      return [...set];
    },
    async update(id, patch: UpdateAttendeeData) { const u = { ...rows.get(id)!, ...patch } as AttendeeRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}

describe('AttendeeService', () => {
  it('adds an internal attendee with defaults (REQUIRED / INVITED)', async () => {
    const svc = createAttendeeService({ attendees: inMemory() });
    const a = await svc.addAttendee('m1', { userId: 'u2' });
    expect(a.userId).toBe('u2');
    expect(a.role).toBe('REQUIRED');
    expect(a.attendance).toBe('INVITED');
  });

  it('adds an external attendee with a name; rejects an attendee with neither user nor name', async () => {
    const svc = createAttendeeService({ attendees: inMemory() });
    const a = await svc.addAttendee('m1', { externalName: 'Jane Guest', externalEmail: 'jane@ext.co', role: 'OPTIONAL' });
    expect(a.externalName).toBe('Jane Guest');
    expect(a.role).toBe('OPTIONAL');
    await expect(svc.addAttendee('m1', {})).rejects.toThrow(/user or an external name/i);
  });

  it('does not add the same internal user twice to one meeting', async () => {
    const svc = createAttendeeService({ attendees: inMemory() });
    await svc.addAttendee('m1', { userId: 'u2' });
    await expect(svc.addAttendee('m1', { userId: 'u2' })).rejects.toThrow(/already/i);
    // same user is fine on a different meeting
    await expect(svc.addAttendee('m2', { userId: 'u2' })).resolves.toBeTruthy();
  });

  it('marks attendance and validates the status', async () => {
    const svc = createAttendeeService({ attendees: inMemory() });
    const a = await svc.addAttendee('m1', { userId: 'u2' });
    const up = await svc.setAttendance('m1', a.id, 'PRESENT');
    expect(up.attendance).toBe('PRESENT');
    // @ts-expect-error invalid status
    await expect(svc.setAttendance('m1', a.id, 'MAYBE')).rejects.toThrow(/status/i);
  });

  it('rejects marking attendance on an attendee from another meeting', async () => {
    const svc = createAttendeeService({ attendees: inMemory() });
    const a = await svc.addAttendee('m1', { userId: 'u2' });
    await expect(svc.setAttendance('m2', a.id, 'PRESENT')).rejects.toThrow(/not found/i);
  });

  it('removes an attendee', async () => {
    const svc = createAttendeeService({ attendees: inMemory() });
    const a = await svc.addAttendee('m1', { userId: 'u2' });
    await svc.removeAttendee('m1', a.id);
    expect(await svc.listAttendees('m1')).toHaveLength(0);
  });

  it('suggests distinct internal users from previous meetings, excluding those already invited', async () => {
    const svc = createAttendeeService({ attendees: inMemory() });
    await svc.addAttendee('past1', { userId: 'u2' });
    await svc.addAttendee('past1', { userId: 'u3' });
    await svc.addAttendee('past2', { userId: 'u3' });
    await svc.addAttendee('m1', { userId: 'u2' }); // already on the target meeting
    const suggestions = await svc.suggestAttendees('m1', ['past1', 'past2']);
    expect(suggestions.sort()).toEqual(['u3']);
  });
});
