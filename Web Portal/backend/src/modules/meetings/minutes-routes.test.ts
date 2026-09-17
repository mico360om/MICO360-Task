import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createAttendeeService } from './attendee-service';
import { createAgendaService } from './agenda-service';
import { createNoteService } from './note-service';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import type { AttendeeRepository, AttendeeRecord, CreateAttendeeData, UpdateAttendeeData } from './attendee-repository';
import type { AgendaRepository, AgendaItemRecord, CreateAgendaData, UpdateAgendaData } from './agenda-repository';
import type { NoteRepository, NoteRecord, CreateNoteData, UpdateNoteData } from './note-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

function meetingRepo(): MeetingRepository {
  const rows = new Map<string, MeetingRecord>();
  let seq = 0;
  return {
    async create(d: CreateMeetingData) {
      const now = new Date();
      const rec: MeetingRecord = {
        id: `m${seq++}`, title: d.title, description: d.description ?? null, category: null, status: d.status ?? 'DRAFT',
        projectId: d.projectId ?? null, organizerId: d.organizerId, location: d.location ?? null, onlineLink: d.onlineLink ?? null,
        startAt: d.startAt, endAt: d.endAt ?? null, timeZone: d.timeZone ?? null, recurrenceRule: null, recurrenceParentId: null,
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
      const rec: AttendeeRecord = { id: `a${seq++}`, meetingId: d.meetingId, userId: d.userId ?? null, externalName: d.externalName ?? null, externalEmail: d.externalEmail ?? null, role: d.role ?? 'REQUIRED', attendance: d.attendance ?? 'INVITED', department: d.department ?? null, createdAt: new Date() };
      rows.set(rec.id, rec); return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId); },
    async distinctUserIdsForMeetings() { return []; },
    async update(id, patch: UpdateAttendeeData) { const u = { ...rows.get(id)!, ...patch } as AttendeeRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}
function agendaRepo(): AgendaRepository {
  const rows = new Map<string, AgendaItemRecord>();
  let seq = 0;
  return {
    async add(d: CreateAgendaData) { const rec: AgendaItemRecord = { id: `g${seq++}`, meetingId: d.meetingId, title: d.title, ownerId: d.ownerId ?? null, expectedMinutes: d.expectedMinutes ?? null, position: d.position, completed: false, linkedPrevActionId: d.linkedPrevActionId ?? null, createdAt: new Date() }; rows.set(rec.id, rec); return rec; },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId).sort((a, b) => a.position - b.position); },
    async update(id, patch: UpdateAgendaData) { const u = { ...rows.get(id)!, ...patch } as AgendaItemRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
    async setPositions(updates) { for (const u of updates) { const r = rows.get(u.id); if (r) r.position = u.position; } },
  };
}
function noteRepo(): NoteRepository {
  const rows = new Map<string, NoteRecord>();
  let seq = 0;
  return {
    async add(d: CreateNoteData) { const rec: NoteRecord = { id: `n${seq++}`, meetingId: d.meetingId, agendaItemId: d.agendaItemId ?? null, authorId: d.authorId, type: d.type, body: d.body, highlighted: d.highlighted ?? false, taskId: null, actionItemId: null, decisionId: null, createdAt: new Date(), editedAt: null }; rows.set(rec.id, rec); return rec; },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((n) => n.meetingId === meetingId); },
    async update(id, patch: UpdateNoteData) { const u = { ...rows.get(id)!, ...patch } as NoteRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'min-access', refreshSecret: 'min-refresh', accessTtl: 900, refreshTtl: 1000,
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
  const agendaService = createAgendaService({ agenda: agendaRepo() });
  const noteService = createNoteService({ notes: noteRepo() });
  const resolveUserNames = async (ids: string[]) => new Map(ids.map((i) => [i, `User ${i}`]));
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, attendeeService, agendaService, noteService, resolveUserNames, appConfig: { timeZone: 'UTC', productName: 'MICO360', companyName: 'MICO360 Softwares' } });
  return app;
}

describe('Minutes PDF route', () => {
  it('returns a PDF with the right content-type and filename for an authorized viewer', async () => {
    const app = await makeApp();
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Q4 Planning Sync', startAt: '2026-10-01T09:00:00Z' } });
    const id = created.json().data.id;
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'Review outcomes' } });
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: auth }, payload: { body: 'Adopt sprint cadence', type: 'DECISION' } });

    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes.pdf`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('minutes-q4-planning-sync.pdf');
    const body = res.rawPayload.toString('latin1');
    expect(body.startsWith('%PDF-1.')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(body).toContain('(Q4 Planning Sync) Tj');
  });

  it('hides the minutes from an outsider (404)', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` }, payload: { title: 'Private', startAt: '2026-10-01T09:00:00Z' } });
    const id = created.json().data.id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/minutes.pdf`, headers: { authorization: `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}` } });
    expect(res.statusCode).toBe(404);
  });
});
