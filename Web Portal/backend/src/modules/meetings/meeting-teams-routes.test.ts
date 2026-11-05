import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createMeetingService } from './meeting-service';
import { createMeetingSeriesService } from './meeting-series-service';
import { memoryAttendees, memoryMeetings, type MemoryMeetings } from './meeting-memory.fixture';
import { startFakeMicrosoft, type FakeMicrosoft } from '../integrations/microsoft/fake-microsoft';
import { createMicrosoftClient } from '../integrations/microsoft/microsoft-client';
import { createMemoryConnectionStore } from '../integrations/microsoft/connection-store';
import { createMicrosoftConnections, type MicrosoftConnections } from '../integrations/microsoft/microsoft-connections';
import { memoryTeamsLinkStore } from '../integrations/microsoft/teams-link-store';
import { createTeamsMeetings, type TeamsMeetings } from '../integrations/microsoft/teams-meetings';
import type { MicrosoftConfig } from '../integrations/microsoft/microsoft-config';

/** 1.23 Teams links through the meeting routes: the form's "Create a Teams link" tick on create and edit. */
const tokenService = createTokenService({
  accessSecret: 'teams-access',
  refreshSecret: 'teams-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const auth = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });
const HOUR = 3_600_000;
const at = (h: number) => new Date(Math.ceil(Date.now() / HOUR) * HOUR + h * HOUR).toISOString();

let ms: FakeMicrosoft;
let app: FastifyInstance;
let meetings: MemoryMeetings;
let teams: TeamsMeetings;
let connections: MicrosoftConnections;
let invites: Array<{ id: string; scope?: string }>;

beforeAll(async () => {
  ms = await startFakeMicrosoft();
});
afterAll(async () => {
  await ms.close();
});

beforeEach(async () => {
  ms.meetings.clear();
  invites = [];
  meetings = memoryMeetings();
  const cfg: MicrosoftConfig = {
    clientId: ms.clientId, clientSecret: ms.clientSecret, tenant: { mode: 'single', tenantId: ms.tenantId }, authority: ms.tenantId,
    tokenKey: randomBytes(32), redirectUri: 'http://localhost:4780/api/v1/integrations/microsoft/callback', loginBase: ms.loginBase, graphBase: ms.graphBase,
  };
  const client = createMicrosoftClient({ ...cfg, timeoutMs: 300, retryDelayMs: 1 });
  connections = createMicrosoftConnections({ config: cfg, client, store: createMemoryConnectionStore(), isActiveUser: async () => true });
  teams = createTeamsMeetings({ connections, client, store: memoryTeamsLinkStore(meetings.rows), delayMs: 0 });
  const onChanged = (m: { id: string; onlineMeetingProvider?: 'TEAMS' | null }, kind: 'created' | 'updated' | 'cancelled' | 'deleted') => teams.onMeetingChanged(m, kind);
  const meetingService = createMeetingService({ meetings, onChanged, defaultTimeZone: 'Asia/Muscat' });
  const series = createMeetingSeriesService({ meetings, attendees: memoryAttendees(), defaultTimeZone: 'Asia/Muscat', onChanged });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  app = await buildApp({
    authService,
    tokenService,
    meetingService,
    meetingSeriesService: series,
    meetingTeams: teams,
    meetingNotifyService: {
      sendInvites: async (id: string, opts?: { scope?: string }) => {
        invites.push({ id, scope: opts?.scope });
        return { sent: 1, failed: 0, recipients: [], skipped: [] };
      },
      sendCancellation: async () => ({ sent: 0, failed: 0, recipients: [], skipped: [] }),
    } as never,
  });
  // The organizer's own Microsoft account is connected.
  const begun = connections.begin('org');
  const back = new URL((await fetch(begun.authorizeUrl, { redirect: 'manual' })).headers.get('location')!);
  await connections.complete({ code: back.searchParams.get('code')!, state: back.searchParams.get('state')! }, begun.cookie.value);
});

async function create(payload: Record<string, unknown>, who = 'org', roles?: string[]) {
  return app.inject({ method: 'POST', url: '/api/v1/meetings', headers: await auth(who, roles), payload: { title: 'OXY review', startAt: at(24), endAt: at(25), status: 'SCHEDULED', ...payload } });
}

describe('New meeting with "Create a Teams link"', () => {
  it('the Teams join link fills the online link (a pasted one is ignored); no Graph id in the answer', async () => {
    const res = await create({ teamsLink: true, onlineLink: 'https://meet.example.com/pasted' });
    expect(res.statusCode).toBe(201);
    const m = res.json().data;
    const [made] = [...ms.meetings.values()];
    expect(m).toMatchObject({ onlineLink: made!.joinWebUrl, onlineMeetingProvider: 'TEAMS', teamsLinkPending: false });
    expect(m.teamsNotice).toBeUndefined();
    expect(made).toMatchObject({ subject: 'OXY review', startDateTime: at(24), endDateTime: at(25) });
    expect(res.body).not.toMatch(/onlineMeetingId|onlineMeetingOwnerId/);
    expect(res.body).not.toContain(made!.id);
  });

  it('without the tick: a plain meeting, nothing at Microsoft', async () => {
    const res = await create({ onlineLink: 'https://meet.example.com/pasted' });
    expect(res.json().data).toMatchObject({ onlineLink: 'https://meet.example.com/pasted', onlineMeetingProvider: null });
    expect(ms.meetings.size).toBe(0);
  });

  it('Microsoft unreachable: the meeting is saved anyway, with the plain notice and the link waiting', async () => {
    ms.failNext('create', 'drop');
    const res = await create({ teamsLink: true });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ onlineLink: null, onlineMeetingProvider: 'TEAMS', teamsLinkPending: true, teamsNotice: { code: 'TEAMS_FAILED', message: 'The Teams link couldn’t be made — try again.' } });
  });

  it('a repeating meeting: one Teams link for all its meetings', async () => {
    const res = await create({ teamsLink: true, recurrenceRule: { freq: 'WEEKLY', interval: 1, count: 3 } });
    expect(res.statusCode).toBe(201);
    expect(ms.meetings.size).toBe(1);
    const join = [...ms.meetings.values()][0]!.joinWebUrl;
    const family = [...meetings.rows.values()].filter((r) => !r.deletedAt);
    expect(family).toHaveLength(3);
    for (const r of family) expect(r).toMatchObject({ onlineLink: join, onlineMeetingProvider: 'TEAMS' });
  });

  it('an administrator scheduling for someone else: saved with their pasted link, "only the organizer" notice, nothing made', async () => {
    const res = await create({ teamsLink: true, organizerId: 'org', onlineLink: 'https://meet.example.com/kept' }, 'admin', ['ADMIN']);
    expect(res.json().data.onlineLink).toBe('https://meet.example.com/kept');
    expect(res.statusCode).toBe(201);
    expect(res.json().data.teamsNotice.code).toBe('TEAMS_NOT_ORGANIZER');
    expect(ms.meetings.size).toBe(0);
  });
});

describe('Editing a meeting', () => {
  async function teamsMeeting(extra: Record<string, unknown> = {}) {
    return (await create({ teamsLink: true, ...extra })).json().data as { id: string; onlineLink: string };
  }
  const put = async (id: string, payload: Record<string, unknown>, scope = 'one') =>
    app.inject({ method: 'PUT', url: `/api/v1/meetings/${id}?scope=${scope}`, headers: await auth('org'), payload });

  it('ticking it on an existing meeting makes the link; invitations already sent get an update with it', async () => {
    const m = (await create({ onlineLink: 'https://meet.example.com/old' })).json().data;
    meetings.rows.set(m.id, { ...meetings.rows.get(m.id)!, invitesSentAt: new Date() });
    const res = await put(m.id, { teamsLink: true, onlineLink: 'https://meet.example.com/ignored' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ onlineMeetingProvider: 'TEAMS', onlineLink: [...ms.meetings.values()][0]!.joinWebUrl });
    expect(invites.map((i) => i.id)).toEqual([m.id]);
  });

  it('a new time or title updates the Teams meeting', async () => {
    const m = await teamsMeeting();
    await put(m.id, { title: 'OXY review (moved)', startAt: at(48), endAt: at(50), teamsLink: true });
    await teams.idle();
    expect([...ms.meetings.values()][0]).toMatchObject({ subject: 'OXY review (moved)', startDateTime: at(48), endDateTime: at(50) });
  });

  it('unticking takes the link away and deletes the Teams meeting', async () => {
    const m = await teamsMeeting();
    const res = await put(m.id, { teamsLink: false, onlineLink: null });
    expect(res.json().data).toMatchObject({ onlineLink: null, onlineMeetingProvider: null });
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
  });

  it('an app that knows nothing of Teams pasting another link: the meeting gets a plain link, the Teams meeting goes', async () => {
    const m = await teamsMeeting();
    const res = await put(m.id, { onlineLink: 'https://meet.example.com/new' });
    expect(res.json().data).toMatchObject({ onlineLink: 'https://meet.example.com/new', onlineMeetingProvider: null });
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
  });

  it('an edit that leaves the link alone keeps it (older apps don’t send the tick)', async () => {
    const m = await teamsMeeting();
    const res = await put(m.id, { location: 'Room 4' });
    expect(res.json().data).toMatchObject({ onlineLink: m.onlineLink, onlineMeetingProvider: 'TEAMS' });
    await teams.idle();
    expect(ms.meetings.size).toBe(1);
  });

  it('cancelling or deleting the meeting deletes its Teams meeting', async () => {
    const a = await teamsMeeting();
    await app.inject({ method: 'POST', url: `/api/v1/meetings/${a.id}/cancel`, headers: await auth('org') });
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
    const b = await teamsMeeting();
    await app.inject({ method: 'DELETE', url: `/api/v1/meetings/${b.id}`, headers: await auth('org') });
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
  });
});
