import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createNoteService } from './note-service';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import type { NoteRepository, NoteRecord, CreateNoteData, UpdateNoteData } from './note-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

function meetingRepo(attendeesOf: Record<string, string[]> = {}): MeetingRepository {
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
    async accessCore(id) { const m = rows.get(id); return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: attendeesOf[id] ?? [] } : null; },
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
    async claimTask(id, marker) { const r = rows.get(id); if (!r || r.taskId) return false; rows.set(id, { ...r, taskId: marker }); return true; },
    async releaseTaskClaim(id, marker) { const r = rows.get(id); if (r && r.taskId === marker) rows.set(id, { ...r, taskId: null }); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'note-access', refreshSecret: 'note-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

async function makeApp(attendeesOf: Record<string, string[]> = {}) {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const meetings = meetingRepo(attendeesOf);
  const meetingService = createMeetingService({ meetings });
  const meetingAccess = createMeetingAccess({ meetings, projectAccess: { async canViewProject() { return false; }, async accessibleProjectIds() { return []; } } });
  const noteService = createNoteService({ notes: noteRepo(), canEditMeeting: meetingAccess.canEditMeeting });
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

describe('Note routes — authorship (SEC-06)', () => {
  it('lets only the author edit a note; the organizer may highlight or remove it; other attendees neither', async () => {
    const attendeesOf: Record<string, string[]> = {};
    const app = await makeApp(attendeesOf);
    const id = await ownedMeeting(app, 'u1');
    attendeesOf[id] = ['u2', 'u3'];
    const organizer = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    const author = { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` };
    const other = { authorization: `Bearer ${await tokenFor('u3', ['EMPLOYEE'])}` };
    const noteId = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/notes`, headers: author, payload: { body: 'Budget approved' } })).json().data.id;
    const patch = (headers: Record<string, string>, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/api/v1/meetings/${id}/notes/${noteId}`, headers, payload });

    expect((await patch(other, { body: 'Budget rejected' })).statusCode).toBe(403);
    expect((await patch(other, { highlighted: true })).statusCode).toBe(403);
    expect((await patch(organizer, { body: 'Budget rejected' })).statusCode).toBe(403);
    const lit = await patch(organizer, { highlighted: true });
    expect(lit.statusCode).toBe(200);
    expect(lit.json().data).toMatchObject({ highlighted: true, body: 'Budget approved', editedAt: null });
    expect((await patch(author, { body: 'Budget approved (with cuts)' })).json().data.editedAt).toBeTruthy();

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/meetings/${id}/notes/${noteId}`, headers: other })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/meetings/${id}/notes/${noteId}`, headers: organizer })).statusCode).toBe(204);
  });
});
