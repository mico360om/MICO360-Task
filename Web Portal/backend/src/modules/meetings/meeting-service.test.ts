import { describe, it, expect, vi } from 'vitest';
import { createMeetingService } from './meeting-service';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';

function inMemory(): MeetingRepository {
  const rows = new Map<string, MeetingRecord>();
  let seq = 0;
  return {
    async create(d: CreateMeetingData) {
      const now = new Date();
      const rec: MeetingRecord = {
        id: `m${seq++}`, title: d.title, description: d.description ?? null, category: d.category ?? null,
        status: d.status ?? 'DRAFT', projectId: d.projectId ?? null, organizerId: d.organizerId,
        location: d.location ?? null, onlineLink: d.onlineLink ?? null, startAt: d.startAt, endAt: d.endAt ?? null,
        timeZone: d.timeZone ?? null, recurrenceRule: d.recurrenceRule ?? null, recurrenceParentId: d.recurrenceParentId ?? null,
        templateId: d.templateId ?? null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: d.createdById, createdAt: now, updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
    async update(id, patch) { const u = { ...rows.get(id)!, ...patch, updatedAt: new Date() } as MeetingRecord; rows.set(id, u); return u; },
    async softDelete(id) { rows.delete(id); },
    async markInvitesSent() {},
    async markReminderSent() {},
    async listUpcomingWithoutReminder() { return []; },
    async accessCore(id) { const m = rows.get(id); return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: [] } : null; },
  };
}

const base = { organizerId: 'u1', createdById: 'u1', startAt: new Date('2026-10-01T09:00:00Z') };

describe('MeetingService', () => {
  it('creates a meeting (standalone: no project) and trims the title', async () => {
    const svc = createMeetingService({ meetings: inMemory() });
    const m = await svc.createMeeting({ ...base, title: '  Kickoff  ' });
    expect(m.title).toBe('Kickoff');
    expect(m.projectId).toBeNull();
    expect(m.status).toBe('DRAFT');
  });

  it('rejects an empty title and an end-before-start', async () => {
    const svc = createMeetingService({ meetings: inMemory() });
    await expect(svc.createMeeting({ ...base, title: '   ' })).rejects.toThrow(/title/i);
    await expect(svc.createMeeting({ ...base, title: 'x', endAt: new Date('2026-10-01T08:00:00Z') })).rejects.toThrow(/end before it starts/i);
  });

  it('updates fields and fires onChanged', async () => {
    const onChanged = vi.fn();
    const svc = createMeetingService({ meetings: inMemory(), onChanged });
    const m = await svc.createMeeting({ ...base, title: 'Sync' });
    const up = await svc.updateMeeting(m.id, { status: 'SCHEDULED', location: 'Room 2' });
    expect(up.status).toBe('SCHEDULED');
    expect(up.location).toBe('Room 2');
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: m.id }), 'created');
    expect(onChanged).toHaveBeenLastCalledWith(expect.objectContaining({ id: m.id }), 'updated');
  });

  it('cancel sets status CANCELLED and signals cancelled', async () => {
    const onChanged = vi.fn();
    const svc = createMeetingService({ meetings: inMemory(), onChanged });
    const m = await svc.createMeeting({ ...base, title: 'Standup' });
    const c = await svc.cancelMeeting(m.id);
    expect(c.status).toBe('CANCELLED');
    expect(onChanged).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'CANCELLED' }), 'cancelled');
  });

  it('duplicates into a fresh DRAFT titled "Copy of …" without the recurrence', async () => {
    const svc = createMeetingService({ meetings: inMemory() });
    const src = await svc.createMeeting({ ...base, title: 'Weekly', status: 'SCHEDULED', recurrenceRule: { freq: 'WEEKLY', interval: 1 } });
    const copy = await svc.duplicateMeeting(src.id, 'u2');
    expect(copy.id).not.toBe(src.id);
    expect(copy.title).toBe('Copy of Weekly');
    expect(copy.status).toBe('DRAFT');
    expect(copy.recurrenceRule).toBeNull();
    expect(copy.createdById).toBe('u2');
  });

  it('404s an unknown meeting on get/update/delete', async () => {
    const svc = createMeetingService({ meetings: inMemory() });
    await expect(svc.getMeeting('nope')).rejects.toThrow(/not found/i);
    await expect(svc.updateMeeting('nope', { title: 'x' })).rejects.toThrow(/not found/i);
    await expect(svc.deleteMeeting('nope')).rejects.toThrow(/not found/i);
  });
});
