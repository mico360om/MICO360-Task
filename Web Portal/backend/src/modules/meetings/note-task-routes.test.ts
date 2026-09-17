import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createNoteService } from './note-service';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import type { NoteRepository, NoteRecord, CreateNoteData, UpdateNoteData } from './note-repository';
import type { NoteTaskService } from './note-task-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

function meetingRepo(): MeetingRepository {
  const rows = new Map<string, MeetingRecord>();
  let seq = 0;
  return {
    async create(d: CreateMeetingData) {
      const now = new Date();
      const rec: MeetingRecord = { id: `m${seq++}`, title: d.title, description: null, category: null, status: d.status ?? 'DRAFT', projectId: d.projectId ?? null, organizerId: d.organizerId, location: null, onlineLink: null, startAt: d.startAt, endAt: null, timeZone: null, recurrenceRule: null, recurrenceParentId: null, templateId: null, transcript: null, invitesSentAt: null, reminderSentAt: null, createdById: d.createdById, createdAt: now, updatedAt: now };
      rows.set(rec.id, rec); return rec;
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
    async add(d: CreateNoteData) { const rec: NoteRecord = { id: `n${seq++}`, meetingId: d.meetingId, agendaItemId: d.agendaItemId ?? null, authorId: d.authorId, type: d.type, body: d.body, highlighted: d.highlighted ?? false, taskId: null, actionItemId: null, decisionId: null, createdAt: new Date(), editedAt: null }; rows.set(rec.id, rec); return rec; },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((n) => n.meetingId === meetingId); },
    async update(id, patch: UpdateNoteData) { const u = { ...rows.get(id)!, ...patch } as NoteRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
  };
}

const tokenService = createTokenService({
  accessSecret: 'nt-access', refreshSecret: 'nt-refresh', accessTtl: 900, refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

const membership: Record<string, string[]> = { p1: ['u1'] };
const projectAccess = {
  async canViewProject(userId: string, roles: string[], projectId: string) { return roles.includes('ADMIN') || (membership[projectId] ?? []).includes(userId); },
  async canViewTask() { return true; },
  async canViewColumn() { return true; },
  async accessibleProjectIds(userId: string, roles: string[]) { return roles.includes('ADMIN') ? null : Object.entries(membership).filter(([, u]) => u.includes(userId)).map(([p]) => p); },
};

async function makeApp() {
  const authService = createAuthService({ users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} }, maxAttempts: 5 });
  const meetings = meetingRepo();
  const meetingService = createMeetingService({ meetings });
  const meetingAccess = createMeetingAccess({ meetings, projectAccess });
  const noteService = createNoteService({ notes: noteRepo() });
  const createTaskFromNote = vi.fn(async (_mid: string, nid: string, uid: string) => ({
    task: { id: 't1', key: 'MICO-1', title: 'From note', projectId: 'p1', columnId: 'c1', createdById: uid },
    note: { id: nid, taskId: 't1' },
  }));
  const noteTaskService = { createTaskFromNote } as unknown as NoteTaskService;
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, projectAccess, noteService, noteTaskService });
  return { app, createTaskFromNote };
}

async function seed(app: Awaited<ReturnType<typeof makeApp>>['app'], owner: string) {
  const auth = `Bearer ${await tokenFor(owner, ['EMPLOYEE'])}`;
  const m = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Sync', startAt: '2026-10-01T09:00:00Z' } });
  const mid = m.json().data.id;
  const n = await app.inject({ method: 'POST', url: `/api/v1/meetings/${mid}/notes`, headers: { authorization: auth }, payload: { body: 'Do the thing', type: 'ACTION' } });
  return { mid, nid: n.json().data.id, auth };
}

describe('Create Task from Note route', () => {
  it('promotes a note to a task and returns both (201)', async () => {
    const { app, createTaskFromNote } = await makeApp();
    const { mid, nid, auth } = await seed(app, 'u1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${mid}/notes/${nid}/task`, headers: { authorization: auth }, payload: { priority: 'HIGH' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.task.id).toBe('t1');
    expect(res.json().data.note.taskId).toBe('t1');
    expect(createTaskFromNote).toHaveBeenCalledWith(mid, nid, 'u1', expect.objectContaining({ priority: 'HIGH' }));
  });

  it('forbids an outsider (403) and never invokes the service', async () => {
    const { app, createTaskFromNote } = await makeApp();
    const { mid, nid } = await seed(app, 'u1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${mid}/notes/${nid}/task`, headers: { authorization: `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}` }, payload: {} });
    expect(res.statusCode).toBe(403); // a write on a meeting the caller can't view is forbidden
    expect(createTaskFromNote).not.toHaveBeenCalled();
  });

  it('rejects targeting a project the caller cannot access (403)', async () => {
    const { app, createTaskFromNote } = await makeApp();
    const { mid, nid, auth } = await seed(app, 'u1');
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${mid}/notes/${nid}/task`, headers: { authorization: auth }, payload: { projectId: 'p2' } });
    expect(res.statusCode).toBe(403);
    expect(createTaskFromNote).not.toHaveBeenCalled();
  });
});
