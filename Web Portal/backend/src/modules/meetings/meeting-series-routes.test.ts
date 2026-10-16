import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createMeetingSeriesService } from './meeting-series-service';
import { memoryAttendees, memoryMeetings } from './meeting-memory.fixture';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

const NOW = new Date('2026-10-16T08:00:00.000Z');
const TZ = 'Asia/Muscat';

const tokenService = createTokenService({
  accessSecret: 'series-access',
  refreshSecret: 'series-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function setup() {
  const meetings = memoryMeetings();
  const attendees = memoryAttendees();
  const clock = { now: NOW };
  const meetingService = createMeetingService({ meetings, defaultTimeZone: TZ });
  // u1 is a member of project p1 only.
  const meetingAccess = createMeetingAccess({
    meetings,
    projectAccess: { canViewProject: async (_u, _r, p) => p === 'p1', accessibleProjectIds: async () => ['p1'] },
  });
  const meetingSeriesService = createMeetingSeriesService({ meetings, attendees, defaultTimeZone: TZ, now: () => clock.now });
  const notify = {
    sendInvites: vi.fn(async () => ({ sent: 1, failed: 0, recipients: [], skipped: [] })),
    sendCancellation: vi.fn(async () => ({ sent: 1, failed: 0 })),
  };
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const projectMeetings = {
    timeZone: TZ,
    load: vi.fn(async () => ({
      meetings: [...meetings.rows.values()].filter((m) => !m.deletedAt),
      seriesRoots: [], attendees: [], decisions: [], noteCounts: {}, minutes: [], actionItems: [],
    })),
  };
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, meetingSeriesService, meetingNotifyService: notify as never, projectMeetings });
  const auth = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] })).accessToken}` };
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url: `/api/v1${url}`, headers: auth, payload: payload as never });
  const callAs = async (userId: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${(await tokenService.issueTokens({ id: userId, roles: ['EMPLOYEE'] })).accessToken}` }, payload: payload as never });
  const alive = () => [...meetings.rows.values()].filter((m) => !m.deletedAt).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  async function weekly() {
    const res = await call('POST', '/meetings', {
      title: 'Weekly sync', startAt: '2026-10-20T06:00:00Z', endAt: '2026-10-20T07:00:00Z', timeZone: TZ, status: 'SCHEDULED',
      recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2] },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string };
  }
  return { meetings, clock, notify, call, callAs, alive, weekly };
}

describe('repeating meetings over the API', () => {
  it('creates the series’ meetings with the first one', async () => {
    const t = await setup();
    const root = await t.weekly();
    const list = t.alive();
    expect(list).toHaveLength(13);
    expect(list.slice(1).every((m) => m.recurrenceParentId === root.id)).toBe(true);
    const got = (await t.call('GET', `/meetings/${list[3]!.id}`)).json().data;
    expect(got.series).toMatchObject({ id: root.id, rule: { freq: 'WEEKLY', weekdays: [2] } });
  });

  it('gives a one-off meeting a repeat when it is edited', async () => {
    const t = await setup();
    const one = (await t.call('POST', '/meetings', { title: 'Retro', startAt: '2026-10-20T06:00:00Z' })).json().data;
    expect(t.alive()).toHaveLength(1);
    await t.call('PUT', `/meetings/${one.id}`, { recurrenceRule: { freq: 'DAILY', interval: 1, count: 5 } });
    expect(t.alive()).toHaveLength(5);
  });

  it('changes just one meeting by default — and ignores a new repeat for it', async () => {
    const t = await setup();
    await t.weekly();
    const second = t.alive()[1]!;
    await t.meetings.markInvitesSent(second.id, NOW);
    const res = await t.call('PUT', `/meetings/${second.id}`, { title: 'Special sync', recurrenceRule: { freq: 'DAILY', interval: 1 } });
    expect(res.statusCode).toBe(200);
    expect(t.alive().map((m) => m.title).filter((x) => x === 'Special sync')).toHaveLength(1);
    expect(t.alive()).toHaveLength(13);
    expect(t.notify.sendInvites).toHaveBeenCalledWith(second.id, { scope: 'one' });
  });

  it('changes every upcoming meeting with scope=series and sends the series update', async () => {
    const t = await setup();
    const root = await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    const third = t.alive()[2]!;
    const res = await t.call('PUT', `/meetings/${third.id}?scope=series`, { title: 'Project sync' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe('Project sync');
    expect(t.alive().every((m) => m.title === 'Project sync')).toBe(true);
    expect(t.notify.sendInvites).toHaveBeenCalledWith(third.id, { scope: 'series' });
    expect(root.id).toBeTruthy();
  });

  it('tells calendars when a series that has started moves to a new schedule', async () => {
    const t = await setup();
    const root = await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    const third = t.alive()[2]!;
    const res = await t.call('PUT', `/meetings/${third.id}?scope=series`, { startAt: '2026-11-04T06:00:00Z', endAt: '2026-11-04T07:00:00Z', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [3] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.series).toMatchObject({ id: third.id });
    expect(t.notify.sendCancellation).toHaveBeenCalledWith(t.alive()[1]!.id, expect.objectContaining({ scope: 'series', note: 'moved' }));
    expect(t.notify.sendInvites).toHaveBeenCalledWith(third.id, { scope: 'series' });
    expect(t.meetings.rows.get(root.id)!.recurrenceRule).toMatchObject({ until: '2026-11-02' });
  });

  it('cancels one meeting, or every upcoming one with scope=series', async () => {
    const t = await setup();
    await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    const [, second, third] = t.alive();
    expect((await t.call('POST', `/meetings/${second!.id}/cancel`)).statusCode).toBe(200);
    expect(t.alive().filter((m) => m.status === 'CANCELLED')).toHaveLength(1);
    expect(t.notify.sendCancellation).toHaveBeenLastCalledWith(second!.id);
    expect((await t.call('POST', `/meetings/${third!.id}/cancel?scope=series`)).statusCode).toBe(200);
    expect(t.alive().filter((m) => m.status === 'CANCELLED')).toHaveLength(13);
    expect(t.notify.sendCancellation).toHaveBeenLastCalledWith(third!.id, { scope: 'series' });
  });

  it('deletes every upcoming meeting with scope=series', async () => {
    const t = await setup();
    await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    const second = t.alive()[1]!;
    expect((await t.call('DELETE', `/meetings/${second.id}?scope=series`)).statusCode).toBe(204);
    expect(t.alive()).toHaveLength(0);
    expect(t.notify.sendCancellation).toHaveBeenCalledWith(second.id, expect.objectContaining({ scope: 'series', meeting: expect.objectContaining({ id: second.id }) }));
  });

  it('refuses scope=series for a one-off meeting, and an unknown scope', async () => {
    const t = await setup();
    const one = (await t.call('POST', '/meetings', { title: 'Retro', startAt: '2026-10-20T06:00:00Z' })).json().data;
    expect((await t.call('PUT', `/meetings/${one.id}?scope=series`, { title: 'x' })).statusCode).toBe(400);
    expect((await t.call('PUT', `/meetings/${one.id}?scope=all`, { title: 'x' })).statusCode).toBe(400);
  });

  it('gives a project dashboard its meetings, each series once', async () => {
    const t = await setup();
    const root = await t.weekly();
    const res = await t.call('GET', '/projects/p1/meetings-overview');
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.meetings).toHaveLength(13);
    expect(body.series).toEqual([expect.objectContaining({ id: root.id, title: 'Weekly sync' })]);
    expect(body.stats.upcoming).toBeGreaterThan(0);
    expect((await t.call('GET', '/projects/p2/meetings-overview')).statusCode).toBe(403);
  });

  it('sends no invitations for a series change calendars don’t show', async () => {
    const t = await setup();
    await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    const second = t.alive()[1]!;
    expect((await t.call('PUT', `/meetings/${second.id}?scope=series`, { category: 'Weekly' })).statusCode).toBe(200);
    expect((await t.call('PUT', `/meetings/${second.id}?scope=series`, {})).statusCode).toBe(200);
    expect(t.notify.sendInvites).not.toHaveBeenCalled();
  });

  it('lets only someone who can change the series’ first meeting change all of it', async () => {
    const t = await setup();
    await t.weekly();
    const third = t.alive()[2]!;
    await t.meetings.update(third.id, { organizerId: 'u9' }); // u9 runs just this meeting
    const all = await t.callAs('u9', 'PUT', `/meetings/${third.id}?scope=series`, { title: 'Taken over' });
    expect(all.statusCode).toBe(403);
    expect(t.alive().filter((m) => m.title === 'Taken over')).toHaveLength(0);
    expect((await t.callAs('u9', 'POST', `/meetings/${third.id}/cancel?scope=series`)).statusCode).toBe(403);
    expect((await t.callAs('u9', 'DELETE', `/meetings/${third.id}?scope=series`)).statusCode).toBe(403);
    expect((await t.callAs('u9', 'PUT', `/meetings/${third.id}`, { title: 'My own' })).statusCode).toBe(200);
  });

  it('answers with the series’ next meeting when the edited one has no place in the new schedule', async () => {
    const t = await setup();
    const root = await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    const ninth = t.alive()[8]!;
    const res = await t.call('PUT', `/meetings/${ninth.id}?scope=series`, { recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2], count: 4 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(root.id);
    expect(t.notify.sendInvites).toHaveBeenCalledWith(root.id, { scope: 'series' });
  });

  it('removes the old series from calendars when a series whose first meeting was deleted gets a new time', async () => {
    const t = await setup();
    const root = await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    const second = t.alive()[1]!;
    await t.call('DELETE', `/meetings/${root.id}`);
    t.notify.sendCancellation.mockClear();
    await t.call('PUT', `/meetings/${second.id}?scope=series`, { startAt: '2026-10-27T07:00:00Z', endAt: '2026-10-27T08:00:00Z' });
    expect(t.notify.sendCancellation).toHaveBeenCalledWith(root.id, expect.objectContaining({ scope: 'series', note: 'moved' }));
    expect(t.notify.sendInvites).toHaveBeenCalledWith(second.id, { scope: 'series' });
  });

  it('lists the meetings in a calendar range', async () => {
    const t = await setup();
    await t.weekly();
    const res = await t.call('GET', '/meetings?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z');
    expect(res.json().data.map((m: { startAt: string }) => m.startAt)).toEqual([
      '2026-11-03T06:00:00.000Z', '2026-11-10T06:00:00.000Z', '2026-11-17T06:00:00.000Z', '2026-11-24T06:00:00.000Z',
    ]);
  });
});

describe('repeating meetings over the API: second review fixes', () => {
  it('lets the people running a series’ upcoming meetings change all of it after it started', async () => {
    const t = await setup();
    await t.weekly();
    t.clock.now = new Date('2026-10-28T08:00:00.000Z'); // two meetings held
    // The series was handed to u9: every upcoming meeting is theirs; the held ones stay u1's.
    for (const m of t.alive()) if (m.startAt >= t.clock.now) await t.meetings.update(m.id, { organizerId: 'u9' });
    const third = t.alive()[2]!;
    expect((await t.callAs('u9', 'PUT', `/meetings/${third.id}?scope=series`, { title: 'Run by u9' })).statusCode).toBe(200);
    expect(t.alive().filter((m) => m.title === 'Run by u9')).toHaveLength(t.alive().length - 2);
    expect((await t.callAs('u7', 'PUT', `/meetings/${third.id}?scope=series`, { title: 'Not mine' })).statusCode).toBe(403);
    expect((await t.callAs('u9', 'POST', `/meetings/${third.id}/cancel?scope=series`)).statusCode).toBe(200);
  });

  it('sends the series update, not a cancellation, when a cancelled meeting’s details change for the series', async () => {
    const t = await setup();
    await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    const third = t.alive()[2]!;
    await t.call('POST', `/meetings/${third.id}/cancel`);
    t.notify.sendCancellation.mockClear();
    const res = await t.call('PUT', `/meetings/${third.id}?scope=series`, { title: 'Project sync' });
    expect(res.statusCode).toBe(200);
    expect(t.notify.sendCancellation).not.toHaveBeenCalled();
    const live = t.alive().find((m) => m.status !== 'CANCELLED')!;
    expect(t.notify.sendInvites).toHaveBeenCalledWith(live.id, { scope: 'series' });
  });

  it('tells everyone with the old series that it ended, people added later included', async () => {
    const t = await setup();
    await t.weekly();
    for (const m of t.alive()) await t.meetings.markInvitesSent(m.id, NOW);
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    const third = t.alive()[2]!;
    await t.call('PUT', `/meetings/${third.id}?scope=series`, { startAt: '2026-11-04T06:00:00Z', endAt: '2026-11-04T07:00:00Z', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [3] } });
    expect(t.notify.sendCancellation).toHaveBeenCalledWith(
      t.alive()[1]!.id,
      expect.objectContaining({ scope: 'series', note: 'moved', alsoTo: expect.arrayContaining([expect.objectContaining({ id: third.id })]) }),
    );
  });
});
