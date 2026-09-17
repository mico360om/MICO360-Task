import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createAgendaService } from './agenda-service';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import type { AgendaRepository, AgendaItemRecord, CreateAgendaData, UpdateAgendaData } from './agenda-repository';
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

function agendaRepo(): AgendaRepository {
  const rows = new Map<string, AgendaItemRecord>();
  let seq = 0;
  return {
    async add(d: CreateAgendaData) {
      const rec: AgendaItemRecord = {
        id: `g${seq++}`, meetingId: d.meetingId, title: d.title, ownerId: d.ownerId ?? null,
        expectedMinutes: d.expectedMinutes ?? null, position: d.position, completed: false,
        linkedPrevActionId: d.linkedPrevActionId ?? null, createdAt: new Date(),
      };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async listByMeeting(meetingId) { return [...rows.values()].filter((a) => a.meetingId === meetingId).sort((a, b) => a.position - b.position); },
    async update(id, patch: UpdateAgendaData) { const u = { ...rows.get(id)!, ...patch } as AgendaItemRecord; rows.set(id, u); return u; },
    async remove(id) { rows.delete(id); },
    async setPositions(updates) { for (const u of updates) { const r = rows.get(u.id); if (r) r.position = u.position; } },
  };
}

const tokenService = createTokenService({
  accessSecret: 'ag-access', refreshSecret: 'ag-refresh', accessTtl: 900, refreshTtl: 1000,
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
  const agendaService = createAgendaService({ agenda: agendaRepo() });
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, agendaService });
  return app;
}

async function ownedMeeting(app: Awaited<ReturnType<typeof makeApp>>, owner: string) {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/meetings',
    headers: { authorization: `Bearer ${await tokenFor(owner, ['EMPLOYEE'])}` },
    payload: { title: 'Agenda meeting', startAt: '2026-10-01T09:00:00Z' },
  });
  return res.json().data.id as string;
}

describe('Agenda routes', () => {
  it('adds agenda items appended in order for the organizer', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const a = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'Intro' } });
    const b = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'Budget', expectedMinutes: 20 } });
    expect(a.statusCode).toBe(201);
    expect(a.json().data.position).toBe(0);
    expect(b.json().data.position).toBe(1);
    expect(b.json().data.expectedMinutes).toBe(20);
  });

  it('hides the agenda from an outsider (404) and forbids adding (403)', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const outsider = `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}`;
    const list = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: outsider } });
    expect(list.statusCode).toBe(404);
    const add = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: outsider }, payload: { title: 'Sneak' } });
    expect(add.statusCode).toBe(403);
  });

  it('toggles completion via PATCH', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'Do it' } });
    const itemId = created.json().data.id;
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/meetings/${id}/agenda/${itemId}`, headers: { authorization: auth }, payload: { completed: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.completed).toBe(true);
  });

  it('reorders items via PUT /agenda/reorder', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const a = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'A' } })).json().data.id;
    const b = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'B' } })).json().data.id;
    const c = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'C' } })).json().data.id;
    const res = await app.inject({ method: 'PUT', url: `/api/v1/meetings/${id}/agenda/reorder`, headers: { authorization: auth }, payload: { orderedIds: [c, a, b] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((x: { title: string }) => x.title)).toEqual(['C', 'A', 'B']);
  });

  it('removes an item (204)', async () => {
    const app = await makeApp();
    const id = await ownedMeeting(app, 'u1');
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const itemId = (await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth }, payload: { title: 'Bye' } })).json().data.id;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/meetings/${id}/agenda/${itemId}`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}/agenda`, headers: { authorization: auth } });
    expect(list.json().data).toHaveLength(0);
  });
});
