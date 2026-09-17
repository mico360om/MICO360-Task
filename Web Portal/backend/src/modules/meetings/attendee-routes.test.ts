import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createAttendeeService } from './attendee-service';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import type { AttendeeRepository, AttendeeRecord, CreateAttendeeData, UpdateAttendeeData } from './attendee-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

function meetingRepo(): MeetingRepository {
  const rows = new Map<string, MeetingRecord>();
  let seq = 0;
  return {
    async create(d: CreateMeetingData) {
      const now = new Date();
      const rec: MeetingRecord = {
        id: `m${seq++}`, title: d.title, description: null, category: null, status: d.status ?? 'DRAFT',
        projectId: d.projectId ?? null, organizerId: d.organizerId, location: null, onlineLink: null,
        startAt: d.startAt, endAt: null, timeZone: null, recurrenceRule: null, recurrenceParentId: null,
        templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: d.createdById, createdAt: now, updatedAt: now,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
    async update(id, patch) { const u = { ...rows.get(id)!, ...patch } as MeetingRecord; rows.set(id, u); return u; },
    async softDelete(id) { rows.delete(id); },
    async markInvitesSent() {},
    async markReminderSent() {},
    async listUpcomingWithoutReminder() { return []; },
    async accessCore(id) { const m = rows.get(id); return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: [] } : null; },
  };
}

function attendeeRepo(): AttendeeRepository {
  const rows = new Map<string, AttendeeRecord>();
  let seq = 0;
  return {
    async add(d: CreateAttendeeData) {
      const rec: AttendeeRecord = {
        id: `a${seq++}`, meetingId: d.meetingId, userId: d.userId ?? null, externalName: d.externalName ?? null,
        externalEmail: d.externalEmail ?? null, role: d.role ?? 'REQUIRED', attendance: d.attendance ?? 'INVITED',
        department: d.department ?? null, createdAt: new Date(),
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId); },
    async distinctUserIdsForMeetings(ids) { return [...new Set([...rows.values()].filter((a) => a.userId && ids.includes(a.meetingId)).map((a) => a.userId!))]; },
    async update(id, patch: UpdateAttendeeData) { const u = { ...rows.get(id)!, ...patch } as AttendeeRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'att-access', refreshSecret: 'att-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

async function makeApp() {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const meetings = meetingRepo();
  const meetingService = createMeetingService({ meetings });
  const meetingAccess = createMeetingAccess({ meetings, projectAccess: { async canViewProject() { return false; }, async accessibleProjectIds() { return []; } } });
  const attendeeService = createAttendeeService({ attendees: attendeeRepo() });
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, attendeeService });
  return { app, meetingService };
}

async function ownedMeeting(app: Awaited<ReturnType<typeof makeApp>>['app'], owner: string) {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/meetings',
    headers: { authorization: `Bearer ${await tokenFor(owner, ['EMPLOYEE'])}` },
    payload: { title: 'Roster meeting', startAt: '2026-10-01T09:00:00Z' },
  });
  return res.json().data.id as string;
}

describe('Attendee routes', () => {
  it('adds an internal attendee to a meeting the caller organizes', async () => {
    const { app } = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const res = await app.inject({
      method: 'POST', url: `/api/v1/meetings/${id}/attendees`,
      headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` },
      payload: { userId: 'u2', role: 'OPTIONAL' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ userId: 'u2', role: 'OPTIONAL', attendance: 'INVITED' });
  });

  it('rejects a duplicate internal attendee (409)', async () => {
    const { app } = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/attendees`, headers: { authorization: auth }, payload: { userId: 'u2' } });
    const dup = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/attendees`, headers: { authorization: auth }, payload: { userId: 'u2' } });
    expect(dup.statusCode).toBe(409);
  });

  it('forbids an outsider from adding attendees (403) and hides the roster (404)', async () => {
    const { app } = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const outsider = `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}`;
    const add = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/attendees`, headers: { authorization: outsider }, payload: { userId: 'u2' } });
    expect(add.statusCode).toBe(403);
    const list = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/attendees`, headers: { authorization: outsider } });
    expect(list.statusCode).toBe(404);
  });

  it('marks attendance via PATCH', async () => {
    const { app } = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const added = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/attendees`, headers: { authorization: auth }, payload: { externalName: 'Guest Q', externalEmail: 'q@ext.co' } });
    const attendeeId = added.json().data.id;
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/meetings/${id}/attendees/${attendeeId}`, headers: { authorization: auth }, payload: { attendance: 'PRESENT' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.attendance).toBe('PRESENT');
  });

  it('removes an attendee (204)', async () => {
    const { app } = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const added = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/attendees`, headers: { authorization: auth }, payload: { userId: 'u2' } });
    const attendeeId = added.json().data.id;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/meetings/${id}/attendees/${attendeeId}`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/attendees`, headers: { authorization: auth } });
    expect(list.json().data).toHaveLength(0);
  });
});
