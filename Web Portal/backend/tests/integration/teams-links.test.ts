import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createPrismaAttendeeRepository } from '../../src/modules/meetings/prisma-attendee-repository';
import { createMeetingService } from '../../src/modules/meetings/meeting-service';
import { createMeetingSeriesService } from '../../src/modules/meetings/meeting-series-service';
import { startFakeMicrosoft, type FakeMicrosoft } from '../../src/modules/integrations/microsoft/fake-microsoft';
import { createMicrosoftClient } from '../../src/modules/integrations/microsoft/microsoft-client';
import { createPrismaConnectionStore } from '../../src/modules/integrations/microsoft/connection-store';
import { createMicrosoftConnections, type MicrosoftConnections } from '../../src/modules/integrations/microsoft/microsoft-connections';
import { createPrismaTeamsLinkStore } from '../../src/modules/integrations/microsoft/teams-link-store';
import { createTeamsMeetings, type TeamsMeetings } from '../../src/modules/integrations/microsoft/teams-meetings';
import type { MicrosoftConfig } from '../../src/modules/integrations/microsoft/microsoft-config';
import type { MeetingRecord } from '../../src/modules/meetings/meeting-repository';
import type { MeetingChangeKind } from '../../src/modules/meetings/meeting-service';

// 1.23 Teams links against MySQL: the connection row (sealed token), the meetings' Teams columns, a
// repeating family's one link, the API answers never carrying the Graph id. Requires TEST_DATABASE_URL.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
const HOUR = 3_600_000;
const at = (h: number) => new Date(Math.ceil(Date.now() / HOUR) * HOUR + h * HOUR);

let ms: FakeMicrosoft;
let connections: MicrosoftConnections;
let teams: TeamsMeetings;
let meetings: ReturnType<typeof createMeetingService>;
let series: ReturnType<typeof createMeetingSeriesService>;
let userId: string;

beforeAll(async () => {
  await prisma.$connect();
  ms = await startFakeMicrosoft();
});
afterAll(async () => {
  await prisma.meeting.deleteMany();
  await prisma.microsoftConnection.deleteMany();
  await prisma.user.deleteMany({ where: { email: { endsWith: '@teams-links.test' } } });
  await ms.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.meetingAttendee.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.microsoftConnection.deleteMany();
  ms.meetings.clear();
  const tag = randomBytes(4).toString('hex');
  userId = (await prisma.user.create({ data: { email: `org-${tag}@teams-links.test`, username: `org-${tag}`, passwordHash: 'x', firstName: 'Org', lastName: 'Anizer' } })).id;
  const cfg: MicrosoftConfig = {
    clientId: ms.clientId, clientSecret: ms.clientSecret, tenant: { mode: 'single', tenantId: ms.tenantId }, authority: ms.tenantId,
    tokenKey: randomBytes(32), redirectUri: 'http://localhost:4780/api/v1/integrations/microsoft/callback', loginBase: ms.loginBase, graphBase: ms.graphBase,
  };
  const client = createMicrosoftClient({ ...cfg, timeoutMs: 400, retryDelayMs: 1 });
  connections = createMicrosoftConnections({
    config: cfg, client, store: createPrismaConnectionStore(prisma),
    isActiveUser: async (id) => (await prisma.user.count({ where: { id, deletedAt: null, status: 'ACTIVE' } })) > 0,
  });
  teams = createTeamsMeetings({ connections, client, store: createPrismaTeamsLinkStore(prisma), delayMs: 0 });
  const repo = createPrismaMeetingRepository(prisma);
  const onChanged = (m: MeetingRecord, k: MeetingChangeKind) => teams.onMeetingChanged(m, k);
  meetings = createMeetingService({ meetings: repo, onChanged, defaultTimeZone: 'Asia/Muscat' });
  series = createMeetingSeriesService({ meetings: repo, attendees: createPrismaAttendeeRepository(prisma), defaultTimeZone: 'Asia/Muscat', onChanged });
  const begun = connections.begin(userId);
  const back = new URL((await fetch(begun.authorizeUrl, { redirect: 'manual' })).headers.get('location')!);
  expect((await connections.complete({ code: back.searchParams.get('code')!, state: back.searchParams.get('state')! }, begun.cookie.value)).result).toBe('connected');
});

describe('Teams links in the database', () => {
  it('the connection row keeps the refresh token sealed (never as given)', async () => {
    const row = await prisma.microsoftConnection.findUniqueOrThrow({ where: { userId } });
    expect(row.refreshTokenEnc).toBeTruthy();
    for (const t of ms.issuedTokens) expect(row.refreshTokenEnc).not.toContain(t);
    expect(row).toMatchObject({ tenantId: ms.tenantId, email: ms.user.mail });
  });

  it('a one-off: the columns are set, the meeting answer shows the marker but never the Graph id', async () => {
    const m = await meetings.createMeeting({ title: 'Site review', organizerId: userId, createdById: userId, status: 'SCHEDULED', startAt: at(24), endAt: at(25) });
    expect((await teams.makeLink(m.id, { id: userId })).made).toBe(true);
    const row = await prisma.meeting.findUniqueOrThrow({ where: { id: m.id } });
    const [made] = [...ms.meetings.values()];
    // A real join link is about 250 characters: kept whole.
    expect(made!.joinWebUrl.length).toBeGreaterThan(191);
    expect(row).toMatchObject({ onlineLink: made!.joinWebUrl, onlineMeetingProvider: 'TEAMS', onlineMeetingId: made!.id, onlineMeetingOwnerId: userId });
    const record = await meetings.getMeeting(m.id);
    expect(record).toMatchObject({ onlineMeetingProvider: 'TEAMS', teamsLinkPending: false });
    expect(JSON.stringify(record)).not.toContain(made!.id);
    expect(record).not.toHaveProperty('onlineMeetingId');
  });

  it('a repeating family: one Teams meeting on every meeting; a top-up repeat is linked to it; cancelling all of it deletes it', async () => {
    const root = await meetings.createMeeting({
      title: 'Weekly', organizerId: userId, createdById: userId, status: 'SCHEDULED', startAt: at(24), endAt: at(25), timeZone: 'Asia/Muscat',
      recurrenceRule: { freq: 'WEEKLY', interval: 1 },
    });
    await series.start(root);
    expect((await teams.makeLink(root.id, { id: userId })).made).toBe(true);
    const family = await prisma.meeting.findMany({ where: { OR: [{ id: root.id }, { recurrenceParentId: root.id }], deletedAt: null } });
    expect(family.length).toBeGreaterThan(5);
    expect(new Set(family.map((f) => f.onlineMeetingId)).size).toBe(1);
    expect(ms.meetings.size).toBe(1);
    // The daily top-up a week later.
    const later = createMeetingSeriesService({
      meetings: createPrismaMeetingRepository(prisma), attendees: createPrismaAttendeeRepository(prisma), defaultTimeZone: 'Asia/Muscat',
      now: () => new Date(Date.now() + 8 * 24 * HOUR), onChanged: (m, k) => teams.onMeetingChanged(m, k),
    });
    const created = await later.extend(root.id);
    expect(created.length).toBeGreaterThan(0);
    await teams.idle();
    const fresh = await prisma.meeting.findUniqueOrThrow({ where: { id: created[0]!.id } });
    expect(fresh).toMatchObject({ onlineMeetingProvider: 'TEAMS', onlineMeetingId: family[0]!.onlineMeetingId, onlineMeetingOwnerId: userId });
    await series.cancelSeries(root.id);
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
  });

  it('Microsoft down: the meeting is kept, waiting for its link (teamsLinkPending)', async () => {
    const m = await meetings.createMeeting({ title: 'Down', organizerId: userId, createdById: userId, startAt: at(30) });
    ms.failNext('create', 503, 2);
    expect((await teams.makeLink(m.id, { id: userId })).notice?.code).toBe('TEAMS_FAILED');
    expect(await meetings.getMeeting(m.id)).toMatchObject({ onlineMeetingProvider: 'TEAMS', teamsLinkPending: true, onlineLink: null });
  });

  it('Disconnect deletes the row', async () => {
    await connections.disconnect(userId);
    expect(await prisma.microsoftConnection.count({ where: { userId } })).toBe(0);
  });
});
