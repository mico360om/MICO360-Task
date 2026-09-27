import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

function inMemory(attendeesOf: Record<string, string[]> = {}): MeetingRepository {
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
      if (filter.organizerId) all = all.filter((m) => m.organizerId === filter.organizerId);
      const scope = filter.scope;
      if (scope && scope.projectIds !== null) {
        const ids = scope.projectIds;
        all = all.filter((m) =>
          m.organizerId === scope.userId ||
          (attendeesOf[m.id] ?? []).includes(scope.userId) ||
          (m.projectId != null && ids.includes(m.projectId)));
      }
      return all;
    },
    async update(id, patch) { const u = { ...rows.get(id)!, ...patch, updatedAt: new Date() } as MeetingRecord; rows.set(id, u); return u; },
    async softDelete(id) { rows.delete(id); },
    async markInvitesSent() {},
    async markReminderSent() {},
    async listUpcomingWithoutReminder() { return []; },
    async accessCore(id) { const m = rows.get(id); return m ? { organizerId: m.organizerId, createdById: m.createdById, projectId: m.projectId, attendeeUserIds: attendeesOf[id] ?? [] } : null; },
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
    expect(body.canEdit).toBe(true); // the creator can always edit what they just made
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

describe('Meeting routes — who may change a meeting (SEC-06)', () => {
  // Project p1: u1 organizes, u2 is a member (can view), pm manages the project, u5 attends a standalone meeting.
  const team: Record<string, string[]> = { p1: ['u1', 'u2', 'pm'], p2: ['u2'] };
  const managers: Record<string, string[]> = { p1: ['pm'] };
  const attendeesOf: Record<string, string[]> = {};
  const access = {
    async canViewProject(userId: string, roles: string[], projectId: string) { return roles.includes('ADMIN') || (team[projectId] ?? []).includes(userId); },
    async accessibleProjectIds(userId: string, roles: string[]) {
      return roles.includes('ADMIN') ? null : Object.entries(team).filter(([, u]) => u.includes(userId)).map(([p]) => p);
    },
    async canManageProject(userId: string, roles: string[], projectId: string) { return roles.includes('ADMIN') || (managers[projectId] ?? []).includes(userId); },
  };
  const activeUsers = new Set(['u1', 'u2', 'pm', 'u5']);

  async function makeTeamApp() {
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const meetings = inMemory(attendeesOf);
    const meetingAccess = createMeetingAccess({ meetings, projectAccess: access });
    const meetingService = createMeetingService({
      meetings,
      access: meetingAccess,
      defaultTimeZone: 'Asia/Muscat',
      isActiveUser: async (id) => activeUsers.has(id),
    });
    return buildApp({ authService, tokenService, meetingService, meetingAccess });
  }
  const as = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${await tokenFor(id, roles)}` });

  async function projectMeeting(app: Awaited<ReturnType<typeof makeTeamApp>>) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await as('u1'), payload: { title: 'Planning', projectId: 'p1', startAt: '2026-10-01T09:00:00Z' } });
    expect(res.statusCode).toBe(201);
    return res.json().data.id as string;
  }

  it('lets a project member view but not edit, cancel, delete or re-invite', async () => {
    const app = await makeTeamApp();
    const id = await projectMeeting(app);
    const member = await as('u2');
    const view = await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}`, headers: member });
    expect(view.statusCode).toBe(200);
    expect(view.json().data.canEdit).toBe(false);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/meetings/${id}`, headers: member, payload: { title: 'Hijacked' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/cancel`, headers: member })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/meetings/${id}`, headers: member })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/invites`, headers: member })).statusCode).toBe(403);
    // …and the meeting is untouched.
    expect((await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}`, headers: member })).json().data.title).toBe('Planning');
  });

  it('lets the organizer, the project manager and an admin edit (canEdit: true)', async () => {
    const app = await makeTeamApp();
    const id = await projectMeeting(app);
    for (const [user, roles] of [['u1', ['EMPLOYEE']], ['pm', ['EMPLOYEE']], ['boss', ['ADMIN']]] as const) {
      const headers = await as(user, [...roles]);
      expect((await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}`, headers })).json().data.canEdit).toBe(true);
      const res = await app.inject({ method: 'PUT', url: `/api/v1/meetings/${id}`, headers, payload: { location: `Room ${user}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.canEdit).toBe(true);
    }
  });

  it('includes canEdit on create, get, update, duplicate and cancel responses', async () => {
    const app = await makeTeamApp();
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await as('u1'), payload: { title: 'Flags', projectId: 'p1', startAt: '2026-10-01T09:00:00Z' } });
    const id = created.json().data.id;
    expect(created.json().data.canEdit).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}`, headers: await as('u1') })).json().data.canEdit).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/api/v1/meetings/${id}`, headers: await as('u2') })).json().data.canEdit).toBe(false);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/meetings/${id}`, headers: await as('u1'), payload: { title: 'Flags 2' } })).json().data.canEdit).toBe(true);
    // A member who duplicates a meeting becomes the copy's creator, so they can edit the copy.
    const copy = await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/duplicate`, headers: await as('u2') });
    expect(copy.json().data).toMatchObject({ canEdit: true, createdById: 'u2' });
    expect((await app.inject({ method: 'POST', url: `/api/v1/meetings/${id}/cancel`, headers: await as('u1') })).json().data.canEdit).toBe(true);
  });

  it('flags canEdit per meeting in the list', async () => {
    const app = await makeTeamApp();
    await projectMeeting(app);
    await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await as('u2'), payload: { title: 'Mine', startAt: '2026-10-02T09:00:00Z' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/meetings', headers: await as('u2') });
    const flags = Object.fromEntries(res.json().data.map((m: { title: string; canEdit: boolean }) => [m.title, m.canEdit]));
    expect(flags).toEqual({ Planning: false, Mine: true });
  });

  it('refuses to move a meeting into a project the editor cannot access, or to an unknown organizer', async () => {
    const app = await makeTeamApp();
    const id = await projectMeeting(app);
    const organizer = await as('u1');
    expect((await app.inject({ method: 'PUT', url: `/api/v1/meetings/${id}`, headers: organizer, payload: { projectId: 'p2' } })).statusCode).toBe(403);
    const ghost = await app.inject({ method: 'PUT', url: `/api/v1/meetings/${id}`, headers: organizer, payload: { organizerId: 'ceo-who-left' } });
    expect(ghost.statusCode).toBe(400);
    // Handing over to a project member is fine.
    const handover = await app.inject({ method: 'PUT', url: `/api/v1/meetings/${id}`, headers: organizer, payload: { organizerId: 'u2' } });
    expect(handover.statusCode).toBe(200);
    expect(handover.json().data.organizerId).toBe('u2');
  });

  it('only lets an admin schedule a meeting in someone else’s name', async () => {
    const app = await makeTeamApp();
    const onBehalf = { title: 'CEO town hall', organizerId: 'u2', startAt: '2026-10-01T09:00:00Z' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await as('u1'), payload: onBehalf })).statusCode).toBe(403);
    const admin = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await as('boss', ['ADMIN']), payload: onBehalf });
    expect(admin.statusCode).toBe(201);
    expect(admin.json().data.organizerId).toBe('u2');
    const ghost = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await as('boss', ['ADMIN']), payload: { ...onBehalf, organizerId: 'nobody' } });
    expect(ghost.statusCode).toBe(400);
  });

  it('"Organized by me" returns only meetings the caller organizes, not ones they attend (WEB-19)', async () => {
    const app = await makeTeamApp();
    const theirs = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await as('u1'), payload: { title: 'Their sync', startAt: '2026-10-01T09:00:00Z' } })).json().data.id;
    attendeesOf[theirs] = ['u5'];
    await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await as('u5'), payload: { title: 'My sync', startAt: '2026-10-02T09:00:00Z' } });
    const all = await app.inject({ method: 'GET', url: '/api/v1/meetings', headers: await as('u5') });
    expect(all.json().data.map((m: { title: string }) => m.title).sort()).toEqual(['My sync', 'Their sync']);
    const mine = await app.inject({ method: 'GET', url: '/api/v1/meetings?mine=true', headers: await as('u5') });
    expect(mine.json().data.map((m: { title: string }) => m.title)).toEqual(['My sync']);
    const notMine = await app.inject({ method: 'GET', url: '/api/v1/meetings?mine=false', headers: await as('u5') });
    expect(notMine.json().data).toHaveLength(2);
  });

  it('defaults the time zone to the company zone and validates zone + online link (MTG-01/03/08)', async () => {
    const app = await makeTeamApp();
    const headers = await as('u1');
    const created = await app.inject({ method: 'POST', url: '/api/v1/meetings', headers, payload: { title: 'Zoned', startAt: '2026-10-01T09:00:00Z', onlineLink: '  meet.google.com/abc-defg-hij ' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.timeZone).toBe('Asia/Muscat');
    expect(created.json().data.onlineLink).toBe('https://meet.google.com/abc-defg-hij');
    const bad = async (payload: Record<string, unknown>) =>
      (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers, payload: { title: 'x', startAt: '2026-10-01T09:00:00Z', ...payload } })).statusCode;
    expect(await bad({ timeZone: 'Muscat' })).toBe(400);
    expect(await bad({ onlineLink: 'javascript:alert(1)' })).toBe(400);
    expect(await bad({ onlineLink: 'data:text/html,hi' })).toBe(400);
    expect(await bad({ timeZone: 'Europe/London', onlineLink: 'http://zoom.us/j/1' })).toBe(201);
  });
});
