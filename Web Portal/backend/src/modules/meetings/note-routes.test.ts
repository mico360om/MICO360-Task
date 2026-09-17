import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createNoteService } from './note-service';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
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

function noteRepo(): NoteRepository {
  const rows = new Map<string, NoteRecord>();
  let seq = 0;
  return {
    async add(d: CreateNoteData) {
      const rec: NoteRecord = {
        id: `n${seq++}`, meetingId: d.meetingId, agendaItemId: d.agendaItemId ?? null, authorId: d.authorId,
        type: d.type, body: d.body, highlighted: d.highlighted ?? false, taskId: null, actionItemId: null,
        decisionId: null, createdAt: new Date(), editedAt: null,
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((n) => n.meetingId === meetingId); },
    async update(id, patch: UpdateNoteData) { const u = { ...rows.get(id)!, ...patch } as NoteRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'note-access', refreshSecret: 'note-refresh', accessTtl: 900, refreshTtl: 1000,
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
  const noteService = createNoteService({ notes: noteRepo() });
  return buildApp({ authService, tokenService, meetingService, meetingAccess, noteService });
}

async function ownedMeeting(app: Awaited<ReturnType<typeof makeApp>>, owner: string) {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/meetings',
    headers: { authorization: `Bearer ${await tokenFor(owner, ['EMPLOYEE'])}` },
    payload: { title: 'Notes meeting', startAt: '2026-10-01T09:00:00Z' },
  });
  return res.json().data.id as string;
}

describe('Note routes', () => {
  it('captures a typed note authored by the caller', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const res = await app.inject({
      method: 'POST', url: `/api/v1/meetings/${id}/notes`,
      headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` },
      payload: { body: 'Ship the beta Friday', type: 'ACTION', highlighted: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ body: 'Ship the beta Friday', type: 'ACTION', highlighted: true, authorId: 'u1' });
  });

  it('hides notes from an outsider (404) and forbids capturing (403)', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const outsider = `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}`;
    const list = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: outsider } });
    expect(list.statusCode).toBe(404);
    const add = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: outsider }, payload: { body: 'sneak' } });
    expect(add.statusCode).toBe(403);
  });

  it('edits a note via PATCH', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: auth }, payload: { body: 'draft' } });
    const noteId = created.json().data.id;
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/meetings/${id}/notes/${noteId}`, headers: { authorization: auth }, payload: { body: 'final', type: 'DECISION' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ body: 'final', type: 'DECISION' });
    expect(res.json().data.editedAt).toBeTruthy();
  });

  it('rejects an empty note body (400)', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` }, payload: { body: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('removes a note (204)', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const noteId = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: auth }, payload: { body: 'bye' } })).json().data.id;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/meetings/${id}/notes/${noteId}`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/notes`, headers: { authorization: auth } });
    expect(list.json().data).toHaveLength(0);
  });
});
