import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';
import { createMeetingService } from './meeting-service';
import { createMeetingAccess } from './meeting-access';
import { createMeetingSeriesService } from './meeting-series-service';
import { memoryAttendees, memoryMeetings } from './meeting-memory.fixture';
import { memoryNamedSeries } from './named-series-memory.fixture';
import { createNamedSeriesService } from './named-series-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

const NOW = new Date('2026-10-16T08:00:00.000Z');
const TZ = 'Asia/Muscat';
const TEAM: Record<string, string[]> = { p1: ['u1', 'u2', 'mgr'], p2: ['u1', 'mgr'] };

const tokenService = createTokenService({
  accessSecret: 'named-series-access',
  refreshSecret: 'named-series-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

/** The meeting routes wired as server.ts wires them, with series: the repeat and change hooks included. */
async function setup() {
  const meetings = memoryMeetings();
  const attendees = memoryAttendees();
  const store = memoryNamedSeries(meetings, attendees);
  const canViewProject = async (u: string, roles: string[], p: string) => roles.includes('ADMIN') || (TEAM[p] ?? []).includes(u);
  const namedSeriesService = createNamedSeriesService({
    store,
    meetings,
    canViewProject,
    canManageProject: async (u, roles) => roles.includes('ADMIN') || u === 'mgr',
    userNames: async (ids) => new Map(ids.map((id) => [id, id])),
    timeZone: TZ,
    now: () => NOW,
  });
  const meetingAccess = createMeetingAccess({
    meetings,
    projectAccess: {
      canViewProject,
      accessibleProjectIds: async (u) => Object.keys(TEAM).filter((p) => TEAM[p]!.includes(u)),
      canManageProject: async (u) => u === 'mgr',
    },
  });
  const follow = async (m: Parameters<typeof namedSeriesService.followPlace>[0], kind: string) => {
    if (kind === 'deleted') await namedSeriesService.afterDeleted(m);
    else await namedSeriesService.followPlace(m);
  };
  const meetingService = createMeetingService({ meetings, access: meetingAccess, defaultTimeZone: TZ, onChanged: follow });
  const meetingSeriesService = createMeetingSeriesService({
    meetings, attendees, defaultTimeZone: TZ, now: () => NOW, onChanged: follow,
    ensureSeries: (m) => namedSeriesService.ensureFamilySeries(m),
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const app = await buildApp({ authService, tokenService, meetingService, meetingAccess, meetingSeriesService, namedSeriesService });
  const callAs = async (userId: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${(await tokenService.issueTokens({ id: userId, roles: ['EMPLOYEE'] })).accessToken}` }, payload: payload as never });
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => callAs('u1', method, url, payload);
  const alive = () => [...meetings.rows.values()].filter((m) => !m.deletedAt).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const one = async (title: string, start: string, projectId = 'p1') => {
    const res = await call('POST', '/meetings', { title, startAt: start, projectId });
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string };
  };
  return { meetings, store, call, callAs, alive, one };
}

describe('meeting series over the API', () => {
  it('"New series…" from a meeting, then the meeting page’s series line and the Series page', async () => {
    const t = await setup();
    const a = await t.one('Monthly 1', '2026-10-06T06:00:00Z');
    const b = await t.one('Monthly 2', '2026-11-03T06:00:00Z');
    const made = await t.call('POST', '/meeting-series', { name: 'Monthly OXY review', meetingId: a.id });
    expect(made.statusCode).toBe(201);
    const series = made.json().data;
    expect(series).toMatchObject({ name: 'Monthly OXY review', projectId: 'p1' });
    expect((await t.call('POST', `/meeting-series/${series.id}/meetings`, { meetingIds: [b.id] })).statusCode).toBe(204);

    const ctx = (await t.call('GET', `/meetings/${b.id}/series`)).json().data;
    expect(ctx).toMatchObject({ series: { id: series.id, name: 'Monthly OXY review' }, position: 2, total: 2, previous: { id: a.id }, next: null });
    const page = (await t.call('GET', `/meeting-series/${series.id}`)).json().data;
    expect(page.meetings.map((m: { id: string }) => m.id)).toEqual([a.id, b.id]);
    // The meetings list names each meeting's series (the cards' chip).
    const list = (await t.call('GET', '/meetings')).json().data as Array<{ id: string; seriesId: string | null; seriesName: string | null }>;
    expect(list.find((m) => m.id === b.id)).toMatchObject({ seriesId: series.id, seriesName: 'Monthly OXY review' });
    // A meeting in no series says so.
    const c = await t.one('Alone', '2026-11-10T06:00:00Z');
    expect((await t.call('GET', `/meetings/${c.id}/series`)).json()).toEqual({ data: null });
  });

  it('answers 404 to someone who can’t open the meeting or see the series', async () => {
    const t = await setup();
    const a = await t.one('Monthly 1', '2026-10-06T06:00:00Z');
    const series = (await t.call('POST', '/meeting-series', { name: 'Board', meetingId: a.id })).json().data;
    expect((await t.callAs('stranger', 'GET', `/meetings/${a.id}/series`)).statusCode).toBe(404);
    expect((await t.callAs('stranger', 'GET', `/meeting-series/${series.id}`)).statusCode).toBe(404);
    expect((await t.callAs('stranger', 'GET', `/meeting-series/${series.id}/prefill`)).statusCode).toBe(404);
    expect((await t.callAs('stranger', 'PATCH', `/meeting-series/${series.id}`, { name: 'Mine' })).statusCode).toBe(404);
  });

  it('"New meeting in this series": a new meeting joins with seriesId — only of the series’ project', async () => {
    const t = await setup();
    const a = await t.one('Monthly 1', '2026-10-06T06:00:00Z');
    const series = (await t.call('POST', '/meeting-series', { name: 'Board', meetingId: a.id })).json().data;
    const joined = await t.call('POST', '/meetings', { title: 'Board', startAt: '2026-11-03T06:00:00Z', projectId: 'p1', seriesId: series.id });
    expect(joined.statusCode).toBe(201);
    expect(t.meetings.rows.get(joined.json().data.id)?.seriesId).toBe(series.id);
    const wrong = await t.call('POST', '/meetings', { title: 'Board', startAt: '2026-11-04T06:00:00Z', projectId: 'p2', seriesId: series.id });
    expect(wrong.statusCode).toBe(400);
    expect(t.alive().filter((m) => m.projectId === 'p2')).toHaveLength(0); // nothing half-made
  });

  it('a new repeating meeting is a series of its own, and every repeat is in it', async () => {
    const t = await setup();
    const res = await t.call('POST', '/meetings', { title: 'Weekly sync', startAt: '2026-10-20T06:00:00Z', projectId: 'p1', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2] } });
    expect(res.statusCode).toBe(201);
    const all = t.alive();
    expect(all.length).toBeGreaterThan(5);
    const seriesId = all[0]!.seriesId;
    expect(seriesId).toBeTruthy();
    expect(all.every((m) => m.seriesId === seriesId)).toBe(true);
    expect(t.store.series.get(seriesId!)).toMatchObject({ name: 'Weekly sync', auto: true, projectId: 'p1' });
  });

  it('a repeating meeting made in a series puts its repeats there', async () => {
    const t = await setup();
    const a = await t.one('Monthly 1', '2026-10-06T06:00:00Z');
    const series = (await t.call('POST', '/meeting-series', { name: 'Board', meetingId: a.id })).json().data;
    const res = await t.call('POST', '/meetings', { title: 'Board', startAt: '2026-10-20T06:00:00Z', projectId: 'p1', seriesId: series.id, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2] } });
    expect(res.statusCode).toBe(201);
    expect(t.alive().every((m) => m.seriesId === series.id)).toBe(true);
    expect(t.store.series.size).toBe(1);
  });

  it('a meeting in a series given a repeat keeps its repeats in that series', async () => {
    const t = await setup();
    const a = await t.one('Monthly 1', '2026-10-20T06:00:00Z');
    const series = (await t.call('POST', '/meeting-series', { name: 'Board', meetingId: a.id })).json().data;
    expect((await t.call('PUT', `/meetings/${a.id}`, { recurrenceRule: { freq: 'DAILY', interval: 1, count: 4 } })).statusCode).toBe(200);
    expect(t.alive()).toHaveLength(4);
    expect(t.alive().every((m) => m.seriesId === series.id)).toBe(true);
  });

  it('moving a meeting to another project takes it out of the series (no new refusal)', async () => {
    const t = await setup();
    const a = await t.one('Monthly 1', '2026-10-20T06:00:00Z');
    const b = await t.one('Monthly 2', '2026-11-20T06:00:00Z');
    const series = (await t.call('POST', '/meeting-series', { name: 'Board', meetingId: a.id })).json().data;
    await t.call('POST', `/meeting-series/${series.id}/meetings`, { meetingIds: [b.id] });
    expect((await t.call('PUT', `/meetings/${b.id}`, { projectId: 'p2' })).statusCode).toBe(200);
    expect(t.meetings.rows.get(b.id)?.seriesId).toBeNull();
    expect(t.meetings.rows.get(a.id)?.seriesId).toBe(series.id);
  });

  it('moving all upcoming repeats to another project gives them one new series there', async () => {
    const t = await setup();
    const res = await t.call('POST', '/meetings', { title: 'Weekly sync', startAt: '2026-10-20T06:00:00Z', projectId: 'p1', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2], count: 4 } });
    const first = res.json().data;
    const before = t.meetings.rows.get(first.id)!.seriesId;
    const second = t.alive()[1]!;
    expect((await t.call('PUT', `/meetings/${second.id}?scope=series`, { projectId: 'p2' })).statusCode).toBe(200);
    const moved = t.alive().filter((m) => m.projectId === 'p2');
    expect(moved.length).toBe(4); // none had started: all of them moved
    const there = moved[0]!.seriesId;
    expect(there).toBeTruthy();
    expect(there).not.toBe(before);
    expect(moved.every((m) => m.seriesId === there)).toBe(true);
    expect(t.store.series.get(there!)).toMatchObject({ projectId: 'p2', auto: true });
    // The automatic series left empty in p1 is gone.
    expect(t.store.series.has(before!)).toBe(false);
  });

  it('rename, merge, take out and delete over the API', async () => {
    const t = await setup();
    const a = await t.one('One', '2026-10-06T06:00:00Z');
    const b = await t.one('Two', '2026-10-13T06:00:00Z');
    const s1 = (await t.callAs('mgr', 'POST', '/meeting-series', { name: 'First', meetingId: a.id })).json().data;
    const s2 = (await t.callAs('mgr', 'POST', '/meeting-series', { name: 'Second', meetingId: b.id })).json().data;
    expect((await t.callAs('mgr', 'PATCH', `/meeting-series/${s1.id}`, { name: 'Renamed' })).json().data.name).toBe('Renamed');
    expect((await t.callAs('u2', 'PATCH', `/meeting-series/${s1.id}`, { name: 'Not mine' })).statusCode).toBe(403);
    expect((await t.callAs('mgr', 'POST', `/meeting-series/${s1.id}/merge`, { seriesId: s2.id })).statusCode).toBe(204);
    expect(t.meetings.rows.get(b.id)?.seriesId).toBe(s1.id);
    expect((await t.callAs('mgr', 'GET', `/meeting-series/${s2.id}`)).statusCode).toBe(404);
    expect((await t.callAs('mgr', 'DELETE', `/meeting-series/${s1.id}/meetings/${b.id}`)).statusCode).toBe(204);
    expect(t.meetings.rows.get(b.id)?.seriesId).toBeNull();
    expect((await t.callAs('mgr', 'GET', `/meeting-series/${s1.id}/candidates`)).json().data.map((m: { id: string }) => m.id)).toEqual([b.id]);
    expect((await t.callAs('mgr', 'DELETE', `/meeting-series/${s1.id}`)).statusCode).toBe(204);
    expect(t.meetings.rows.get(a.id)?.seriesId).toBeNull();
    expect(t.alive()).toHaveLength(2); // the meetings stay
  });

  it('asks before taking a repeating meeting’s whole family ("add all its meetings?")', async () => {
    const t = await setup();
    const a = await t.one('Board', '2026-10-06T06:00:00Z');
    const s = (await t.callAs('mgr', 'POST', '/meeting-series', { name: 'Board', meetingId: a.id })).json().data;
    await t.call('POST', '/meetings', { title: 'Weekly', startAt: '2026-10-20T06:00:00Z', projectId: 'p1', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2], count: 3 } });
    const weekly = t.alive().filter((m) => m.title === 'Weekly');
    const opts = (await t.callAs('mgr', 'GET', `/meetings/${weekly[1]!.id}/series-options`)).json().data;
    expect(opts).toMatchObject({ canChange: true, repeats: true, familySize: 3, series: [{ id: s.id, name: 'Board' }] });
    const asked = await t.callAs('mgr', 'POST', `/meeting-series/${s.id}/meetings`, { meetingIds: [weekly[1]!.id] });
    expect(asked.statusCode).toBe(409);
    expect(asked.json().error).toMatchObject({ code: 'SERIES_REPEATS', details: { count: 3 } });
    expect((await t.callAs('mgr', 'POST', `/meeting-series/${s.id}/meetings`, { meetingIds: [weekly[1]!.id], wholeFamily: true })).statusCode).toBe(204);
    expect(weekly.every((m) => t.meetings.rows.get(m.id)?.seriesId === s.id)).toBe(true);
  });

  it('pre-fills "New meeting in this series"', async () => {
    const t = await setup();
    const res = await t.call('POST', '/meetings', { title: 'Monthly 1', startAt: '2026-10-06T06:00:00Z', endAt: '2026-10-06T07:30:00Z', projectId: 'p1', location: 'Room 4' });
    const s = (await t.call('POST', '/meeting-series', { name: 'Monthly OXY review', meetingId: res.json().data.id })).json().data;
    const pre = (await t.call('GET', `/meeting-series/${s.id}/prefill`)).json().data;
    expect(pre).toMatchObject({ seriesId: s.id, title: 'Monthly OXY review', projectId: 'p1', location: 'Room 4', durationMinutes: 90 });
  });

  // ── Review fixes (5 Nov) ──
  it('moving all upcoming repeats to another project with a new repeat: the new repeats join the moved ones there', async () => {
    const t = await setup();
    const res = await t.call('POST', '/meetings', { title: 'Weekly sync', startAt: '2026-10-20T06:00:00Z', projectId: 'p1', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2] } });
    const first = res.json().data;
    const before = t.meetings.rows.get(first.id)!.seriesId;
    const edit = await t.call('PUT', `/meetings/${first.id}?scope=series`, { projectId: 'p2', recurrenceRule: { freq: 'DAILY', interval: 1 }, startAt: '2026-10-22T06:00:00Z' });
    expect(edit.statusCode).toBe(200);
    const all = t.alive();
    expect(all.length).toBeGreaterThan(13); // daily now: more meetings were made
    expect(all.every((m) => m.projectId === 'p2')).toBe(true);
    const there = new Set(all.map((m) => m.seriesId));
    expect(there.size).toBe(1);
    const id = [...there][0]!;
    expect(id).not.toBe(before);
    expect(t.store.series.get(id!)).toMatchObject({ projectId: 'p2' });
    expect(t.store.series.has(before!)).toBe(false); // the p1 series, left empty, is gone
  });

  it('deleting a repeating meeting and all its upcoming repeats takes its empty automatic series away', async () => {
    const t = await setup();
    const res = await t.call('POST', '/meetings', { title: 'Made by mistake', startAt: '2026-10-20T06:00:00Z', projectId: 'p1', recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2] } });
    const id = t.meetings.rows.get(res.json().data.id)!.seriesId!;
    expect(t.store.series.has(id)).toBe(true);
    expect((await t.call('DELETE', `/meetings/${res.json().data.id}?scope=series`)).statusCode).toBe(204);
    expect(t.alive()).toHaveLength(0);
    expect(t.store.series.has(id)).toBe(false);
  });

  it('a paused repeating meeting is in a series too', async () => {
    const t = await setup();
    const res = await t.call('POST', '/meetings', { title: 'Paused', startAt: '2026-10-20T06:00:00Z', projectId: 'p1', recurrenceRule: { freq: 'WEEKLY', interval: 1, paused: true } });
    expect(res.statusCode).toBe(201);
    expect(t.meetings.rows.get(res.json().data.id)!.seriesId).toBeTruthy();
  });
});
