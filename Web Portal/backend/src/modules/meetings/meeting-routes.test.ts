import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import type { MeetingRepository, MeetingRecord, CreateMeetingData } from './meeting-repository';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createMeetingSeriesService } from './meeting-series-service';
import { memoryAttendees, memoryMeetings } from './meeting-memory.fixture';
import { createAttendeeService } from './attendee-service';
import { createAgendaService } from './agenda-service';
import type { AgendaItemRecord, AgendaRepository } from './agenda-repository';

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

async function makeApp(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const meetings = inMemory();
  const meetingService = createMeetingService({ meetings });
  const meetingAccess = createMeetingAccess({ meetings, projectAccess });
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, ...extra });
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

  it('gives each listed meeting its attendee and open action-item counts', async () => {
    const meetingListCounts = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, { attendeeCount: i + 2, openActionItemCount: i }])));
    const app = await makeApp({ meetingListCounts });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Counted', startAt: '2026-10-01T09:00:00Z' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/meetings', headers: { authorization: auth } });
    const [m] = res.json().data as Array<{ title: string; attendeeCount: number; openActionItemCount: number }>;
    expect(m).toMatchObject({ title: 'Counted', attendeeCount: 2, openActionItemCount: 0 });
    // One lookup for the whole page, not one per meeting.
    expect(meetingListCounts).toHaveBeenCalledTimes(1);
  });

  it('gives each listed meeting its first attendees’ names, minutes state and decisions (for the cards)', async () => {
    const meetingListCounts = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, { attendeeCount: 5, openActionItemCount: 1, attendees: ['Aisha Khan', 'Omar Said'], minutes: 'FINAL' as const, decisionCount: 3 }])),
    );
    const app = await makeApp({ meetingListCounts });
    const auth = `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}`;
    await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: { authorization: auth }, payload: { title: 'Card', startAt: '2026-10-01T09:00:00Z' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/meetings', headers: { authorization: auth } });
    const [m] = res.json().data;
    expect(m).toMatchObject({ title: 'Card', attendeeCount: 5, openActionItemCount: 1, attendees: ['Aisha Khan', 'Omar Said'], minutes: 'FINAL', decisionCount: 3 });
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

describe('Meeting free times', () => {
  const at = (local: string) => new Date(`${local.replace(' ', 'T')}:00+04:00`);
  async function setup() {
    let visibleId = '';
    const busy = {
      async busyBetween() {
        return [
          { meetingId: visibleId, title: 'Pump review', start: at('2026-10-26 10:00'), end: at('2026-10-26 11:00'), userIds: ['u1'] },
          { meetingId: 'secret', title: 'Board pay talks', start: at('2026-10-26 10:30'), end: at('2026-10-26 11:30'), userIds: ['u2'] },
        ];
      },
    };
    const app = await makeApp({
      meetingFreeTimes: {
        busy,
        workingHours: async () => ({ days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }),
        userNames: async (ids: string[]) => new Map(ids.map((i) => [i, i.toUpperCase()])),
        timeZone: 'Asia/Muscat',
      },
    });
    const auth = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    // u1 organizes the first one, so may see its title; "secret" is someone else's.
    visibleId = (await app.inject({ method: 'POST', url: '/api/v1/meetings', headers: auth, payload: { title: 'Pump review', startAt: '2026-10-26T06:00:00Z' } })).json().data.id;
    return { app, auth };
  }
  const ask = (app: Awaited<ReturnType<typeof makeApp>>, auth: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/meetings/free-times', headers: auth, payload });

  it('suggests times and names clashes for the invited people', async () => {
    const { app, auth } = await setup();
    const res = await ask(app, auth, { userIds: ['u1', 'u2'], startAt: at('2026-10-26 10:00').toISOString(), minutes: 60 });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.suggestions).toEqual([at('2026-10-26 08:00'), at('2026-10-26 08:30'), at('2026-10-26 09:00')].map((x) => x.toISOString()));
    expect(d.clashes.map((c: { name: string; date: string }) => `${c.name} ${c.date}`)).toEqual(['U1 2026-10-26', 'U2 2026-10-26']);
    expect(d.workingHours).toEqual({ days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' });
  });

  it('hides titles of meetings the requester can’t see', async () => {
    const { app, auth } = await setup();
    const d = (await ask(app, auth, { userIds: ['u1', 'u2'], startAt: at('2026-10-26 10:00').toISOString(), minutes: 60 })).json().data;
    expect(d.clashes.map((c: { title: string | null }) => c.title)).toEqual(['Pump review', null]);
    expect(d.day).toEqual([
      { userId: 'u1', name: 'U1', blocks: [{ start: at('2026-10-26 10:00').toISOString(), end: at('2026-10-26 11:00').toISOString(), title: 'Pump review' }] },
      { userId: 'u2', name: 'U2', blocks: [{ start: at('2026-10-26 10:30').toISOString(), end: at('2026-10-26 11:30').toISOString(), title: null }] },
    ]);
    expect(JSON.stringify(d)).not.toContain('Board pay talks');
  });

  it('refuses more than 50 people, and needs a signed-in person', async () => {
    const { app, auth } = await setup();
    const many = Array.from({ length: 51 }, (_, i) => `u${i}`);
    expect((await ask(app, auth, { userIds: many, startAt: at('2026-10-26 10:00').toISOString(), minutes: 60 })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/meetings/free-times', payload: { userIds: ['u1'], startAt: '2026-10-26T06:00:00Z', minutes: 60 } })).statusCode).toBe(401);
  });
});

describe('Schedule a meeting with its people and agenda', () => {
  const TZ = 'Asia/Muscat';
  function memoryAgenda(failOn?: string): AgendaRepository & { rows: AgendaItemRecord[] } {
    const rows: AgendaItemRecord[] = [];
    return {
      rows,
      async add(d) {
        if (failOn && d.title === failOn) throw new Error('database went away');
        const rec: AgendaItemRecord = { id: `g${rows.length + 1}`, meetingId: d.meetingId, title: d.title, ownerId: d.ownerId ?? null, expectedMinutes: d.expectedMinutes ?? null, position: d.position, completed: false, linkedPrevActionId: null, createdAt: new Date() };
        rows.push(rec);
        return rec;
      },
      async findById(id) { return rows.find((r) => r.id === id) ?? null; },
      async listByMeeting(meetingId) { return rows.filter((r) => r.meetingId === meetingId).sort((a, b) => a.position - b.position); },
      async update(id, patch) { const r = rows.find((x) => x.id === id)!; Object.assign(r, patch); return r; },
      async remove(id) { rows.splice(rows.findIndex((r) => r.id === id), 1); },
      async setPositions() {},
    };
  }
  async function setup(opts: { failAgendaOn?: string } = {}) {
    const meetings = memoryMeetings();
    const attendees = memoryAttendees();
    const agenda = memoryAgenda(opts.failAgendaOn);
    const active = new Set(['u1', 'u2', 'u3']);
    const isActiveUser = async (id: string) => active.has(id);
    const meetingService = createMeetingService({ meetings, defaultTimeZone: TZ, isActiveUser });
    const meetingAccess = createMeetingAccess({ meetings, projectAccess });
    const meetingSeriesService = createMeetingSeriesService({ meetings, attendees, defaultTimeZone: TZ, now: () => new Date('2026-10-16T08:00:00Z') });
    const attendeeService = createAttendeeService({ attendees, laterMeetings: async (id) => (await meetingSeriesService.laterMeetings(id)).map((m) => m.id) });
    const agendaService = createAgendaService({ agenda });
    const app = await makeApp({ meetingService, meetingAccess, meetingSeriesService, attendeeService, agendaService, isActiveUser });
    const auth = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    const create = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/v1/meetings', headers: auth, payload: { title: 'Pump station review', startAt: '2026-10-20T06:00:00Z', endAt: '2026-10-20T07:00:00Z', timeZone: TZ, status: 'SCHEDULED', ...payload } });
    const alive = () => [...meetings.rows.values()].filter((m) => !m.deletedAt);
    return { create, alive, attendees, agenda };
  }

  it('saves the people and agenda with the meeting, before a repeat copies the people', async () => {
    const t = await setup();
    const res = await t.create({
      recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2] },
      attendees: [{ userId: 'u2' }, { userId: 'u3', role: 'OPTIONAL' }, { externalEmail: 'sami.k@contractor.om' }],
      agendaItems: [{ title: 'Pump test results', ownerId: 'u2', expectedMinutes: 20 }, { title: 'Next steps', ownerId: 'u1' }],
    });
    expect(res.statusCode).toBe(201);
    const d = res.json().data;
    expect(d.attendees.map((a: { userId: string | null; externalName: string | null; role: string }) => `${a.userId ?? a.externalName}:${a.role}`)).toEqual(['u2:REQUIRED', 'u3:OPTIONAL', 'sami.k:REQUIRED']);
    expect(d.attendees[2].externalEmail).toBe('sami.k@contractor.om');
    expect(d.agendaItems.map((g: { title: string; ownerId: string | null; expectedMinutes: number | null }) => [g.title, g.ownerId, g.expectedMinutes])).toEqual([
      ['Pump test results', 'u2', 20],
      ['Next steps', 'u1', null],
    ]);
    // The repeat's later meetings carry the same people; the agenda stays on the first meeting.
    const later = t.alive().filter((m) => m.recurrenceParentId === d.id);
    expect(later.length).toBeGreaterThan(1);
    for (const m of later) expect((await t.attendees.listByMeeting(m.id)).map((a) => a.userId ?? a.externalName)).toEqual(['u2', 'u3', 'sami.k']);
    expect(t.agenda.rows.every((g) => g.meetingId === d.id)).toBe(true);
  });

  it('creates nothing when a person can’t be added', async () => {
    const t = await setup();
    const res = await t.create({ attendees: [{ userId: 'u2' }, { userId: 'gone' }], agendaItems: [{ title: 'Budget' }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/active/i);
    expect(t.alive()).toEqual([]);
    expect(t.attendees.rows.size).toBe(0);
    expect(t.agenda.rows).toEqual([]);
  });

  it('an agenda lead must be one of the meeting’s people or the organizer', async () => {
    const t = await setup();
    const res = await t.create({ attendees: [{ userId: 'u2' }], agendaItems: [{ title: 'Budget', ownerId: 'u3' }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/lead/i);
    expect(t.alive()).toEqual([]);
    expect((await t.create({ attendees: [{ userId: 'u2' }], agendaItems: [{ title: 'Budget', ownerId: 'u1' }] })).statusCode).toBe(201);
  });

  it('a guest needs a valid email', async () => {
    const t = await setup();
    expect((await t.create({ attendees: [{ externalName: 'Sami' }] })).statusCode).toBe(400);
    expect((await t.create({ attendees: [{ externalName: 'Sami', externalEmail: 'not-an-email' }] })).statusCode).toBe(400);
    expect(t.alive()).toEqual([]);
    const ok = await t.create({ attendees: [{ externalName: 'Sami Al Harthy', externalEmail: 'sami@contractor.om' }] });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.attendees[0].externalName).toBe('Sami Al Harthy');
  });

  it('takes the meeting back out when saving its agenda fails part way', async () => {
    const t = await setup({ failAgendaOn: 'Second point' });
    const res = await t.create({ attendees: [{ userId: 'u2' }], agendaItems: [{ title: 'First point' }, { title: 'Second point' }] });
    expect(res.statusCode).toBe(500);
    expect(t.alive()).toEqual([]);
  });

  it('keeps each list bounded', async () => {
    const t = await setup();
    expect((await t.create({ agendaItems: Array.from({ length: 51 }, (_, i) => ({ title: `Point ${i}` })) })).statusCode).toBe(400);
    expect((await t.create({ agendaItems: [{ title: 'x'.repeat(301) }] })).statusCode).toBe(400);
    expect((await t.create({ agendaItems: [{ title: 'Long one', expectedMinutes: 601 }] })).statusCode).toBe(400);
    expect(t.alive()).toEqual([]);
  });
});
