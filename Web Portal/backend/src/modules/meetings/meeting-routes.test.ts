import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

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
    async list(filter) {
      let all = [...rows.values()];
      if (filter.projectId) all = all.filter((m) => m.projectId === filter.projectId);
      if (filter.status) all = all.filter((m) => m.status === filter.status);
      const scope = filter.scope;
      if (scope && scope.projectIds !== null) {
        const ids = scope.projectIds;
        all = all.filter((m) => m.organizerId === scope.userId || (m.projectId != null && ids.includes(m.projectId)));
      }
      return all;
    },
    async update(id, patch) { const u = { ...rows.get(id)!, ...patch, updatedAt: new Date() } as MeetingRecord; rows.set(id, u); return u; },
    async softDelete(id) { rows.delete(id); },
    async markInvitesSent() {},
    async markReminderSent() {},
    async listUpcomingWithoutReminder() { return []; },
    async accessCore(id) { const m = rows.get(id); return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: [] } : null; },
  };
}

const tokenService = createTokenService({
  accessSecret: 'mtg-access',
  refreshSecret: 'mtg-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

// u1 is a member of p1; u2 is an outsider. Admins see everything.
const membership: Record<string, string[]> = { p1: ['u1'] };
const projectAccess = {
  async canViewProject(userId: string, roles: string[], projectId: string) {
    return roles.includes('ADMIN') || (membership[projectId] ?? []).includes(userId);
  },
  async accessibleProjectIds(userId: string, roles: string[]) {
    if (roles.includes('ADMIN')) return null;
    return Object.entries(membership).filter(([, u]) => u.includes(userId)).map(([p]) => p);
  },
};

async function makeApp() {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const meetings = inMemory();
  const meetingService = createMeetingService({ meetings });
  const meetingAccess = createMeetingAccess({ meetings, projectAccess });
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess });
  return app;
}

describe('Meeting routes', () => {
  it('creates a standalone meeting with the caller as organizer', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/meetings',
      headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` },
      payload: { title: 'Standalone sync', startAt: '2026-10-01T09:00:00Z' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.title).toBe('Standalone sync');
    expect(body.projectId).toBeNull();
    expect(body.organizerId).toBe('u1');
    expect(body.createdById).toBe('u1');
  });

  it('rejects creating a project meeting the caller cannot access (403)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/api/v1/meetings',
      headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` },
      payload: { title: 'p1 meeting', projectId: 'p1', startAt: '2026-10-01T09:00:00Z' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('hides a meeting from an outsider (404) but shows it to the organizer', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/meetings',
      headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` },
      payload: { title: 'Private', startAt: '2026-10-01T09:00:00Z' },
    });
    const id = created.json().data.id;
    const outsider = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}`, headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` } });
    expect(outsider.statusCode).toBe(404);
    const owner = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}`, headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` } });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().data.title).toBe('Private');
  });

  it('forbids an outsider from updating a meeting (403)', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST', url: '/api/v1/meetings',
      headers: { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` },
      payload: { title: 'Owned', startAt: '2026-10-01T09:00:00Z' },
    });
    const id = created.json().data.id;
    const res = await app.inject({
      method: 'PUT', url: `/api/v1/meetings/${id}`,
      headers: { authorization: `Bearer ${await tokenFor('u2', ['EMPLOYEE'])}` },
      payload: { status: 'SCHEDULED' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lists only meetings the caller organizes or can access via project', async () => {
    const app = await makeApp();
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Mine A', startAt: '2026-10-01T09:00:00Z' } });
    await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: `Bearer ${await tokenFor('u3', ['EMPLOYEE'])}` }, payload: { title: 'Someone else', startAt: '2026-10-02T09:00:00Z' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/meetings', headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    const titles = res.json().data.map((m: { title: string }) => m.title);
    expect(titles).toContain('Mine A');
    expect(titles).not.toContain('Someone else');
  });

  it('cancels a meeting the organizer owns', async () => {
    const app = await makeApp();
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Cancel me', startAt: '2026-10-01T09:00:00Z' } });
    const id = created.json().data.id;
    const res = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/cancel`, headers: { authorization: auth } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('CANCELLED');
  });
});
