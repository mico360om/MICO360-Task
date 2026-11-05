import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { startFakeMicrosoft, type FakeMicrosoft } from './fake-microsoft';
import { createMicrosoftClient } from './microsoft-client';
import { createMemoryConnectionStore } from './connection-store';
import { createMicrosoftConnections, type MicrosoftConnections } from './microsoft-connections';
import { memoryTeamsLinkStore } from './teams-link-store';
import { createTeamsMeetings, TEAMS_FAILED_MESSAGE, type TeamsMeetings } from './teams-meetings';
import type { MicrosoftConfig } from './microsoft-config';
import { memoryAttendees, memoryMeetings, type MemoryMeetings } from '../../meetings/meeting-memory.fixture';
import { createMeetingService, type MeetingService } from '../../meetings/meeting-service';
import { createMeetingSeriesService, type MeetingSeriesService } from '../../meetings/meeting-series-service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = 'Asia/Muscat';

let ms: FakeMicrosoft;
let meetings: MemoryMeetings;
let store: ReturnType<typeof memoryTeamsLinkStore>;
let connections: MicrosoftConnections;
let teams: TeamsMeetings;
let meetingService: MeetingService;
let series: MeetingSeriesService;
let logs: string[];
let client: ReturnType<typeof createMicrosoftClient>;
let logger: { warn: (m: string, c?: Record<string, unknown>) => void; info: (m: string, c?: Record<string, unknown>) => void; error: (m: string, c?: Record<string, unknown>) => void };

/** Whole hours from now, so the stand-in, the services and "upcoming" agree. */
const at = (hours: number) => new Date(Math.ceil(Date.now() / HOUR) * HOUR + hours * HOUR);

async function connect(userId: string) {
  const begun = connections.begin(userId);
  const back = new URL((await fetch(begun.authorizeUrl, { redirect: 'manual' })).headers.get('location')!);
  const done = await connections.complete({ code: back.searchParams.get('code')!, state: back.searchParams.get('state')! }, begun.cookie.value);
  expect(done.result).toBe('connected');
}

function row(id: string) {
  return meetings.rows.get(id)!;
}

beforeAll(async () => {
  ms = await startFakeMicrosoft();
});
afterAll(async () => {
  await ms.close();
});

beforeEach(async () => {
  ms.meetings.clear();
  meetings = memoryMeetings();
  store = memoryTeamsLinkStore(meetings.rows);
  logs = [];
  logger = {
    warn: (m: string, c?: Record<string, unknown>) => logs.push(`${m} ${JSON.stringify(c ?? {})}`),
    info: (m: string, c?: Record<string, unknown>) => logs.push(`${m} ${JSON.stringify(c ?? {})}`),
    error: (m: string, c?: Record<string, unknown>) => logs.push(`${m} ${JSON.stringify(c ?? {}, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v))}`),
  };
  const cfg: MicrosoftConfig = {
    clientId: ms.clientId, clientSecret: ms.clientSecret, tenant: { mode: 'single', tenantId: ms.tenantId }, authority: ms.tenantId,
    tokenKey: randomBytes(32), redirectUri: 'http://localhost:4780/api/v1/integrations/microsoft/callback', loginBase: ms.loginBase, graphBase: ms.graphBase,
  };
  client = createMicrosoftClient({ ...cfg, timeoutMs: 300, retryDelayMs: 1 });
  connections = createMicrosoftConnections({ config: cfg, client, store: createMemoryConnectionStore(), isActiveUser: async () => true, logger });
  teams = createTeamsMeetings({ connections, client, store, logger, delayMs: 0, retryDelaysMs: [5, 5, 5] });
  const onChanged = (m: Parameters<TeamsMeetings['onMeetingChanged']>[0], kind: Parameters<TeamsMeetings['onMeetingChanged']>[1]) => teams.onMeetingChanged(m, kind);
  meetingService = createMeetingService({ meetings, onChanged, defaultTimeZone: TZ });
  series = createMeetingSeriesService({ meetings, attendees: memoryAttendees(), defaultTimeZone: TZ, onChanged });
  await connect('org');
});

async function oneOff(title = 'OXY review', start = at(24), organizerId = 'org') {
  return meetingService.createMeeting({ title, organizerId, createdById: organizerId, status: 'SCHEDULED', startAt: start, endAt: new Date(start.getTime() + HOUR), timeZone: TZ });
}

async function weekly(title = 'Weekly sync') {
  const root = await meetingService.createMeeting({
    title, organizerId: 'org', createdById: 'org', status: 'SCHEDULED', startAt: at(48), endAt: at(49), timeZone: TZ, recurrenceRule: { freq: 'WEEKLY', interval: 1, count: 4 },
  });
  await series.start(root);
  return root;
}

const family = (rootId: string) => [...meetings.rows.values()].filter((m) => !m.deletedAt && (m.id === rootId || m.recurrenceParentId === rootId)).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

describe('making a Teams link', () => {
  it('as the organizer: a Teams meeting (subject, start, end) and its join link in the online link', async () => {
    const m = await oneOff();
    const out = await teams.makeLink(m.id, { id: 'org' });
    expect(out).toEqual({ made: true, notice: null });
    const [made] = [...ms.meetings.values()];
    expect(made).toMatchObject({ subject: 'OXY review', startDateTime: m.startAt.toISOString(), endDateTime: m.endAt!.toISOString(), ownerOid: ms.user.id });
    expect(row(m.id)).toMatchObject({ onlineLink: made!.joinWebUrl, onlineMeetingProvider: 'TEAMS', teamsLinkPending: false });
    expect(store.ids.get(m.id)).toEqual({ teamsId: made!.id, ownerId: 'org' });
  });

  it('a meeting without an end gets an hour in Teams', async () => {
    const start = at(30);
    const m = await meetingService.createMeeting({ title: 'No end', organizerId: 'org', createdById: 'org', startAt: start, timeZone: TZ });
    await teams.makeLink(m.id, { id: 'org' });
    expect([...ms.meetings.values()][0]!.endDateTime).toBe(new Date(start.getTime() + HOUR).toISOString());
  });

  it('only the organizer, with their own account: anyone else gets a plain notice and nothing is made', async () => {
    const m = await oneOff();
    const out = await teams.makeLink(m.id, { id: 'admin' });
    expect(out.made).toBe(false);
    expect(out.notice?.code).toBe('TEAMS_NOT_ORGANIZER');
    expect(ms.meetings.size).toBe(0);
    expect(row(m.id).onlineMeetingProvider ?? null).toBeNull();
  });

  it('not connected: saved anyway, the link waits ("Make Teams link" later)', async () => {
    const m = await oneOff('Other organizer', at(24), 'other');
    const out = await teams.makeLink(m.id, { id: 'other' });
    expect(out.notice?.code).toBe('TEAMS_NOT_CONNECTED');
    expect(row(m.id)).toMatchObject({ onlineMeetingProvider: 'TEAMS', teamsLinkPending: true, onlineLink: null });
  });

  it.each([[403], [500], ['hang' as const], ['drop' as const]])('Microsoft refuses or is unreachable (%s): the meeting keeps going, the plain notice, then Make Teams link works', async (how) => {
    const m = await oneOff();
    ms.failNext('create', how);
    const out = await teams.makeLink(m.id, { id: 'org' });
    expect(out).toEqual({ made: false, notice: { code: 'TEAMS_FAILED', message: TEAMS_FAILED_MESSAGE } });
    expect(TEAMS_FAILED_MESSAGE).toBe('The Teams link couldn’t be made — try again.');
    expect(row(m.id)).toMatchObject({ onlineMeetingProvider: 'TEAMS', teamsLinkPending: true });
    const again = await teams.makeLink(m.id, { id: 'org' });
    expect(again.made).toBe(true);
    expect(row(m.id).teamsLinkPending).toBe(false);
  });

  it('an expired access token is refreshed and the call tried once more', async () => {
    const m = await oneOff();
    ms.expireAccess();
    expect((await teams.makeLink(m.id, { id: 'org' })).made).toBe(true);
  });

  it('a link already made is kept (no second Teams meeting)', async () => {
    const m = await oneOff();
    await teams.makeLink(m.id, { id: 'org' });
    expect(await teams.makeLink(m.id, { id: 'org' })).toEqual({ made: false, notice: null });
    expect(ms.meetings.size).toBe(1);
  });

  it('a repeating family gets ONE Teams meeting for all its upcoming meetings, spanning them', async () => {
    const root = await weekly();
    const list = family(root.id);
    expect(list).toHaveLength(4);
    expect((await teams.makeLink(list[1]!.id, { id: 'org' })).made).toBe(true);
    expect(ms.meetings.size).toBe(1);
    const [made] = [...ms.meetings.values()];
    for (const m of family(root.id)) expect(row(m.id)).toMatchObject({ onlineLink: made!.joinWebUrl, onlineMeetingProvider: 'TEAMS' });
    expect(made!.startDateTime).toBe(list[0]!.startAt.toISOString());
    expect(made!.endDateTime).toBe(list[3]!.endAt!.toISOString());
  });
});

describe('keeping the Teams meeting in step', () => {
  it('a new time or title updates the Teams meeting', async () => {
    const m = await oneOff();
    await teams.makeLink(m.id, { id: 'org' });
    await meetingService.updateMeeting(m.id, { title: 'OXY review (moved)', startAt: at(50), endAt: at(52) });
    await teams.idle();
    expect([...ms.meetings.values()][0]).toMatchObject({ subject: 'OXY review (moved)', startDateTime: at(50).toISOString(), endDateTime: at(52).toISOString() });
  });

  it('a change that isn’t a time or a title doesn’t call Microsoft again', async () => {
    const m = await oneOff();
    await teams.makeLink(m.id, { id: 'org' });
    const calls = ms.graphRequests.length;
    await meetingService.updateMeeting(m.id, { location: 'Room 4' });
    await teams.idle();
    expect(ms.graphRequests.length).toBe(calls);
  });

  it('the daily top-up links new repeats to the family’s Teams meeting and stretches its end', async () => {
    const root = await meetingService.createMeeting({
      title: 'Daily', organizerId: 'org', createdById: 'org', status: 'SCHEDULED', startAt: at(24), endAt: at(25), timeZone: TZ, recurrenceRule: { freq: 'WEEKLY', interval: 1 },
    });
    await series.start(root);
    await teams.makeLink(root.id, { id: 'org' });
    const [made] = [...ms.meetings.values()];
    const lastBefore = family(root.id).at(-1)!;
    // A week later the top-up makes one more meeting.
    const later = createMeetingSeriesService({ meetings, attendees: memoryAttendees(), defaultTimeZone: TZ, now: () => new Date(Date.now() + 8 * DAY), onChanged: (mm, k) => teams.onMeetingChanged(mm, k) });
    const created = await later.extend(root.id);
    expect(created.length).toBeGreaterThan(0);
    await teams.idle();
    for (const c of created) {
      expect(row(c.id)).toMatchObject({ onlineLink: made!.joinWebUrl, onlineMeetingProvider: 'TEAMS', teamsLinkPending: false });
      expect(store.ids.get(c.id)?.teamsId).toBe(made!.id);
    }
    expect(new Date(made!.endDateTime).getTime()).toBeGreaterThan(lastBefore.endAt!.getTime());
  });

  it('cancelling or deleting a one-off deletes its Teams meeting', async () => {
    const a = await oneOff('A');
    await teams.makeLink(a.id, { id: 'org' });
    await meetingService.cancelMeeting(a.id);
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
    expect(row(a.id).onlineMeetingProvider ?? null).toBeNull();
    const b = await oneOff('B');
    await teams.makeLink(b.id, { id: 'org' });
    await meetingService.deleteMeeting(b.id);
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
  });

  it('one cancelled repeat keeps the family’s link; cancelling all of a series not yet held deletes it', async () => {
    const root = await weekly();
    await teams.makeLink(root.id, { id: 'org' });
    const list = family(root.id);
    await meetingService.cancelMeeting(list[2]!.id);
    await teams.idle();
    expect(ms.meetings.size).toBe(1);
    await series.cancelSeries(root.id);
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
  });

  it('a series with a meeting already held keeps its Teams meeting when the rest is cancelled; finishing a meeting never deletes it', async () => {
    const m = await oneOff('Held', at(24));
    await teams.makeLink(m.id, { id: 'org' });
    await meetingService.updateMeeting(m.id, { status: 'COMPLETED' });
    await teams.idle();
    expect(ms.meetings.size).toBe(1);
    const root = await weekly();
    await teams.makeLink(root.id, { id: 'org' });
    const list = family(root.id);
    await meetingService.updateMeeting(list[0]!.id, { status: 'COMPLETED' }); // held
    await series.cancelSeries(list[1]!.id);
    await teams.idle();
    expect(ms.meetings.size).toBe(2);
  });

  it('a failure in the background is logged without a token, and the meeting is unchanged', async () => {
    const m = await oneOff();
    await teams.makeLink(m.id, { id: 'org' });
    ms.failNext('update', 500, 2);
    await meetingService.updateMeeting(m.id, { title: 'New title' });
    await teams.idle();
    expect(row(m.id).onlineMeetingProvider).toBe('TEAMS');
    expect(logs.join('\n')).toMatch(/Teams/);
    for (const t of ms.issuedTokens) expect(logs.join('\n')).not.toContain(t);
  });

  it('after a handover the old organizer’s account is never used: the link stays as it is', async () => {
    const m = await oneOff();
    await teams.makeLink(m.id, { id: 'org' });
    const calls = ms.graphRequests.length;
    await meetingService.updateMeeting(m.id, { organizerId: 'someone-else' });
    await meetingService.updateMeeting(m.id, { title: 'Changed by the new organizer' });
    await meetingService.cancelMeeting(m.id);
    await teams.idle();
    expect(ms.graphRequests.length).toBe(calls);
    expect(ms.meetings.size).toBe(1);
  });
});

describe('taking the Teams link away', () => {
  it('unticking: the family’s upcoming meetings lose the link and the Teams meeting is deleted', async () => {
    const root = await weekly();
    await teams.makeLink(root.id, { id: 'org' });
    const join = row(root.id).onlineLink;
    await teams.removeLink(root.id, join);
    await teams.idle();
    for (const m of family(root.id)) expect(row(m.id)).toMatchObject({ onlineLink: null, onlineMeetingProvider: null });
    expect(ms.meetings.size).toBe(0);
  });

  it('unticking a link that was never made only clears the wait', async () => {
    const m = await oneOff();
    ms.failNext('create', 403);
    await teams.makeLink(m.id, { id: 'org' });
    await teams.removeLink(m.id, null);
    expect(row(m.id)).toMatchObject({ onlineMeetingProvider: null, teamsLinkPending: false });
  });

  it('a hand-pasted link replacing a Teams link makes it a plain link (on that meeting only)', async () => {
    const root = await weekly();
    await teams.makeLink(root.id, { id: 'org' });
    const join = row(root.id).onlineLink!;
    const one = family(root.id)[2]!;
    await meetingService.updateMeeting(one.id, { onlineLink: 'https://meet.example.com/own' });
    await teams.plainLinkGiven(one.id, join);
    await teams.idle();
    expect(row(one.id)).toMatchObject({ onlineLink: 'https://meet.example.com/own', onlineMeetingProvider: null });
    expect(row(root.id).onlineMeetingProvider).toBe('TEAMS');
    expect(ms.meetings.size).toBe(1);
    // A one-off: nothing else uses it — the Teams meeting goes.
    const m = await oneOff('Solo');
    await teams.makeLink(m.id, { id: 'org' });
    const solo = row(m.id).onlineLink!;
    await meetingService.updateMeeting(m.id, { onlineLink: 'https://meet.example.com/solo' });
    await teams.plainLinkGiven(m.id, solo);
    await teams.idle();
    expect(ms.meetings.size).toBe(1);
  });
});

describe('review fixes', () => {
  it('when the link can’t be saved after Microsoft made the meeting, that Teams meeting is deleted again (no leftover)', async () => {
    const m = await oneOff();
    const failing = { ...store, write: async (ids: string[], f: Parameters<typeof store.write>[1]) => {
      if (f.teamsId) throw new Error('Data too long for column onlineLink');
      return store.write(ids, f);
    } };
    const t = createTeamsMeetings({ connections, client, store: failing, logger, delayMs: 0 });
    expect((await t.makeLink(m.id, { id: 'org' })).notice?.code).toBe('TEAMS_FAILED');
    expect(ms.meetings.size).toBe(0);
    expect(row(m.id)).toMatchObject({ onlineMeetingProvider: 'TEAMS', teamsLinkPending: true });
  });

  it('a delete Microsoft refuses for a moment is tried again later', async () => {
    const m = await oneOff();
    await teams.makeLink(m.id, { id: 'org' });
    ms.failNext('delete', 500, 2); // the first try (and its quick retry)
    await meetingService.cancelMeeting(m.id);
    await teams.idle();
    expect(ms.meetings.size).toBe(0);
  });

  it('a Teams meeting left behind (every try failed) is deleted by the daily sweep', async () => {
    const m = await oneOff();
    await teams.makeLink(m.id, { id: 'org' });
    ms.failNext('delete', 500, 8); // two calls per try, four tries
    await meetingService.deleteMeeting(m.id);
    await teams.idle();
    expect(ms.meetings.size).toBe(1);
    expect(await teams.sweepLeftovers()).toBe(1);
    expect(ms.meetings.size).toBe(0);
    expect(await teams.sweepLeftovers()).toBe(0); // nothing left to sweep
  });

  it('a cancelled or finished meeting doesn’t get a Teams link', async () => {
    const a = await oneOff('Cancelled');
    await meetingService.cancelMeeting(a.id);
    expect((await teams.makeLink(a.id, { id: 'org' })).notice?.code).toBe('TEAMS_NOT_OPEN');
    const b = await oneOff('Held');
    await meetingService.updateMeeting(b.id, { status: 'COMPLETED' });
    expect((await teams.makeLink(b.id, { id: 'org' })).notice?.code).toBe('TEAMS_NOT_OPEN');
    expect(ms.meetings.size).toBe(0);
  });

  it('two presses at once make one Teams meeting', async () => {
    const m = await oneOff();
    const [x, y] = await Promise.all([teams.makeLink(m.id, { id: 'org' }), teams.makeLink(m.id, { id: 'org' })]);
    expect([x.made, y.made].filter(Boolean)).toHaveLength(1);
    expect(ms.meetings.size).toBe(1);
  });

  it('a repeat that has its own pasted link keeps it when the family gets its Teams link', async () => {
    const root = await weekly();
    const own = family(root.id)[2]!;
    await meetingService.updateMeeting(own.id, { onlineLink: 'https://meet.example.com/own-room' });
    await teams.makeLink(root.id, { id: 'org' });
    expect(row(own.id)).toMatchObject({ onlineLink: 'https://meet.example.com/own-room' });
    expect(row(own.id).onlineMeetingProvider ?? null).toBeNull();
    expect(row(family(root.id)[1]!.id).onlineMeetingProvider).toBe('TEAMS');
  });

  it('after a save, the Teams step never fails the request: a store failure becomes the plain notice', async () => {
    const m = await oneOff();
    const broken = { ...store, get: async () => { throw new Error('database down'); } };
    const t = createTeamsMeetings({ connections, client, store: broken, logger, delayMs: 0 });
    const out = await t.afterSave({ meetingId: m.id, actor: { id: 'org' }, wanted: true });
    expect(out.notice?.code).toBe('TEAMS_FAILED');
  });
});

// Security review (1.23): a repeat handed over to someone else is theirs — but making (or taking away)
// a Teams link on it reached the whole family, so their Microsoft account hosted, or stripped, the
// links of meetings someone else organizes. Only the organizer's own meetings of the family follow.
describe('a family with more than one organizer', () => {
  async function handedOver() {
    const root = await weekly();
    const list = family(root.id);
    await meetingService.updateMeeting(list[2]!.id, { organizerId: 'bea' });
    return { root, list, theirs: list[2]!, mine: [list[0]!, list[1]!, list[3]!] };
  }

  it('the new organizer’s Teams link is only on the meetings they organize', async () => {
    await connect('bea');
    const { theirs, mine } = await handedOver();
    expect((await teams.makeLink(theirs.id, { id: 'bea' })).made).toBe(true);
    await teams.idle();
    expect(row(theirs.id).onlineMeetingProvider).toBe('TEAMS');
    for (const m of mine) expect(row(m.id), m.id).toMatchObject({ onlineLink: null, onlineMeetingProvider: null });
    const [made] = [...ms.meetings.values()];
    expect(made!.startDateTime).toBe(theirs.startAt.toISOString());
  });

  it('unticking on the handed-over repeat takes the link off that one only; the family’s Teams meeting stays', async () => {
    const { root, theirs, mine } = await handedOver();
    // The family's link was made by its organizer before the handover.
    await meetingService.updateMeeting(theirs.id, { organizerId: 'org' });
    await teams.makeLink(root.id, { id: 'org' });
    await meetingService.updateMeeting(theirs.id, { organizerId: 'bea' });
    const join = row(root.id).onlineLink;
    await teams.removeLink(theirs.id, join);
    await teams.idle();
    expect(row(theirs.id)).toMatchObject({ onlineLink: null, onlineMeetingProvider: null });
    for (const m of mine) expect(row(m.id), m.id).toMatchObject({ onlineLink: join, onlineMeetingProvider: 'TEAMS' });
    expect(ms.meetings.size).toBe(1);
  });
});
