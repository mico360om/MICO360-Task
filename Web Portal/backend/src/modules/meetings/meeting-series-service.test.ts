import { describe, it, expect, vi } from 'vitest';
import { createMeetingSeriesService } from './meeting-series-service';
import { memoryAttendees, memoryMeetings } from './meeting-memory.fixture';
import type { CreateMeetingData, MeetingRecord, RecurrenceRule } from './meeting-repository';

const TZ = 'Asia/Muscat';
// Friday 16 Oct 2026, 12:00 in Muscat. The series' first meeting is Tuesday 20 Oct, 10:00–11:00.
const NOW = new Date('2026-10-16T08:00:00.000Z');
const TUE = new Date('2026-10-20T06:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEKLY: RecurrenceRule = { freq: 'WEEKLY', interval: 1 };

function setup(rule: RecurrenceRule = WEEKLY, extra: Partial<CreateMeetingData> = {}) {
  const meetings = memoryMeetings();
  const attendees = memoryAttendees();
  const clock = { now: NOW };
  const onChanged = vi.fn();
  const series = createMeetingSeriesService({ meetings, attendees, now: () => clock.now, defaultTimeZone: TZ, onChanged });
  async function begin() {
    const root = await meetings.create({
      title: 'Weekly sync', organizerId: 'u1', createdById: 'u1', status: 'SCHEDULED', startAt: TUE, endAt: new Date(TUE.getTime() + HOUR),
      timeZone: TZ, location: 'Room 2', recurrenceRule: rule, projectId: 'p1', ...extra,
    });
    await attendees.add({ meetingId: root.id, userId: 'u2' });
    await attendees.add({ meetingId: root.id, externalName: 'Sara', externalEmail: 'sara@example.com' });
    await series.start(root);
    return root;
  }
  const alive = (rootId: string) => [...meetings.rows.values()].filter((m) => !m.deletedAt && (m.id === rootId || m.recurrenceParentId === rootId)).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return { meetings, attendees, clock, onChanged, series, begin, alive };
}

const starts = (list: MeetingRecord[]) => list.map((m) => m.startAt.toISOString());

describe('meeting series: creating the meetings', () => {
  it('creates the next three months of a weekly series, each a full copy', async () => {
    const t = setup();
    const root = await t.begin();
    const list = t.alive(root.id);
    expect(list).toHaveLength(13); // 20 Oct … 12 Jan
    expect(list.at(-1)!.startAt.toISOString()).toBe('2027-01-12T06:00:00.000Z');
    const second = list[1]!;
    expect(second).toMatchObject({ title: 'Weekly sync', location: 'Room 2', projectId: 'p1', status: 'SCHEDULED', recurrenceParentId: root.id, timeZone: TZ, recurrenceRule: null });
    expect(second.recurrenceStart?.toISOString()).toBe('2026-10-27T06:00:00.000Z');
    expect(second.endAt!.getTime() - second.startAt.getTime()).toBe(HOUR);
    const roster = await t.attendees.listByMeeting(second.id);
    expect(roster.map((a) => a.userId ?? a.externalEmail)).toEqual(['u2', 'sara@example.com']);
    expect(t.meetings.rows.get(root.id)!.recurrenceStart?.toISOString()).toBe(TUE.toISOString());
    expect(t.onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: second.id }), 'created');
  });

  it('keeps at most 26 upcoming meetings of a daily series', async () => {
    const t = setup({ freq: 'DAILY', interval: 1 });
    const root = await t.begin();
    const list = t.alive(root.id);
    expect(list).toHaveLength(26);
    expect(list.at(-1)!.startAt.toISOString()).toBe('2026-11-14T06:00:00.000Z');
  });

  it('stops at the end date or after the number of meetings asked for', async () => {
    const until = setup({ ...WEEKLY, until: '2026-11-03' });
    expect(starts(until.alive((await until.begin()).id))).toEqual(['2026-10-20T06:00:00.000Z', '2026-10-27T06:00:00.000Z', '2026-11-03T06:00:00.000Z']);
    const count = setup({ freq: 'DAILY', interval: 1, count: 4 });
    const root = await count.begin();
    expect(count.alive(root.id)).toHaveLength(4);
    count.clock.now = new Date(NOW.getTime() + 30 * DAY);
    expect(await count.series.extend(root.id)).toEqual([]);
  });

  it('tops a series up as time passes, without creating any meeting twice', async () => {
    const t = setup();
    const root = await t.begin();
    expect(await t.series.extend(root.id)).toEqual([]);
    t.clock.now = new Date(NOW.getTime() + 7 * DAY);
    const added = await t.series.extend(root.id);
    expect(starts(added)).toEqual(['2027-01-19T06:00:00.000Z']);
    const result = await t.series.extendAll();
    expect(result).toEqual({ series: 1, created: 0 });
  });

  it('never brings back a meeting cancelled or deleted on its own', async () => {
    const t = setup({ freq: 'DAILY', interval: 1 });
    const root = await t.begin();
    const list = t.alive(root.id);
    await t.meetings.update(list[25]!.id, { status: 'CANCELLED' });
    await t.meetings.softDelete(list[24]!.id);
    t.clock.now = new Date(NOW.getTime() + DAY);
    const added = await t.series.extend(root.id);
    expect(starts(added)).toEqual(['2026-11-15T06:00:00.000Z']);
  });

  it('carries invitations over to new meetings of an invited series', async () => {
    const t = setup();
    const root = await t.begin();
    const sent = new Date('2026-10-16T09:00:00.000Z');
    for (const m of t.alive(root.id)) {
      await t.meetings.markInvitesSent(m.id, sent);
      await t.attendees.markInvited!((await t.attendees.listByMeeting(m.id)).map((a) => a.id), sent);
    }
    t.clock.now = new Date(NOW.getTime() + 7 * DAY);
    const [added] = await t.series.extend(root.id);
    expect(added!.invitesSentAt).toEqual(sent);
    expect((await t.attendees.listByMeeting(added!.id)).every((a) => a.invitedAt?.getTime() === sent.getTime())).toBe(true);
  });

  it('does nothing for a one-off meeting or a paused series', async () => {
    const t = setup({ ...WEEKLY, paused: true });
    const root = await t.begin();
    expect(t.alive(root.id)).toHaveLength(1);
    const one = await t.meetings.create({ title: 'One-off', organizerId: 'u1', createdById: 'u1', startAt: TUE });
    expect(await t.series.extend(one.id)).toEqual([]);
  });
});

describe('meeting series: changing every upcoming meeting', () => {
  it('applies new details to the upcoming meetings, not past or cancelled ones', async () => {
    const t = setup();
    const root = await t.begin();
    const [, second, third] = t.alive(root.id);
    await t.meetings.update(third!.id, { status: 'CANCELLED' });
    t.clock.now = new Date(TUE.getTime() + 2 * HOUR); // the first meeting is over
    const result = await t.series.updateSeries(second!.id, { title: 'Project sync', location: 'Room 5', startAt: second!.startAt, endAt: second!.endAt });
    const after = t.alive(root.id);
    expect(after[0]!.title).toBe('Weekly sync');
    expect(after[1]!.title).toBe('Project sync');
    expect(after[2]!.title).toBe('Weekly sync'); // cancelled
    expect(after[3]!).toMatchObject({ title: 'Project sync', location: 'Room 5' });
    expect(result.rootId).toBe(root.id);
    expect(result.meeting?.title).toBe('Project sync');
  });

  it('moves every upcoming meeting to a new time, keeping each meeting', async () => {
    const t = setup();
    const root = await t.begin();
    const before = t.alive(root.id);
    await t.meetings.markReminderSent(before[0]!.id, NOW);
    const eleven = new Date(TUE.getTime() + HOUR);
    await t.series.updateSeries(root.id, { startAt: eleven, endAt: new Date(eleven.getTime() + 90 * 60_000) });
    const after = t.alive(root.id);
    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
    expect(after[0]!.startAt.toISOString()).toBe('2026-10-20T07:00:00.000Z');
    expect(after[5]!.startAt.toISOString()).toBe('2026-11-24T07:00:00.000Z');
    expect(after[5]!.recurrenceStart?.toISOString()).toBe('2026-11-24T07:00:00.000Z');
    expect(after[5]!.endAt!.getTime() - after[5]!.startAt.getTime()).toBe(90 * 60_000);
    expect(t.meetings.rows.get(root.id)!.reminderSentAt).toBeNull();
    expect(t.meetings.rows.get(root.id)!.recurrenceStart?.toISOString()).toBe('2026-10-20T07:00:00.000Z');
  });

  it('rebuilds a series given a new repeat, in place while none has happened yet', async () => {
    const t = setup();
    const root = await t.begin();
    const before = t.alive(root.id).map((m) => m.id);
    const result = await t.series.updateSeries(before[3]!, { startAt: new Date('2026-11-10T06:00:00.000Z'), recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [2, 4] } });
    const after = t.alive(root.id);
    expect(result.rootId).toBe(root.id);
    expect(after[0]!.id).toBe(root.id);
    expect(starts(after.slice(0, 4))).toEqual(['2026-10-20T06:00:00.000Z', '2026-10-22T06:00:00.000Z', '2026-10-27T06:00:00.000Z', '2026-10-29T06:00:00.000Z']);
    expect(after).toHaveLength(26); // twice a week reaches the 26-meeting cap first
    expect(after.slice(0, before.length).map((m) => m.id)).toEqual(before);
    expect(t.meetings.rows.get(root.id)!.recurrenceRule).toMatchObject({ weekdays: [2, 4] });
  });

  it('splits a series that has started: past meetings keep the old repeat', async () => {
    const t = setup();
    const root = await t.begin();
    const before = t.alive(root.id);
    t.clock.now = new Date('2026-10-28T08:00:00.000Z'); // two meetings are over
    const third = before[2]!;
    const result = await t.series.updateSeries(third.id, { startAt: new Date('2026-11-04T06:00:00.000Z'), endAt: new Date('2026-11-04T07:00:00.000Z'), recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [3] } });
    expect(result).toMatchObject({ rootId: third.id, endedRootId: root.id });
    const old = t.meetings.rows.get(root.id)!;
    expect(old.recurrenceRule).toMatchObject({ until: '2026-11-02' });
    expect(t.alive(root.id).map((m) => m.id)).toEqual([before[0]!.id, before[1]!.id]);
    const fresh = t.alive(third.id);
    expect(fresh[0]!).toMatchObject({ id: third.id, recurrenceParentId: null, recurrenceRule: expect.objectContaining({ weekdays: [3] }) });
    expect(starts(fresh.slice(0, 3))).toEqual(['2026-11-04T06:00:00.000Z', '2026-11-11T06:00:00.000Z', '2026-11-18T06:00:00.000Z']);
    expect(fresh.every((m, i) => i === 0 || m.recurrenceParentId === third.id)).toBe(true);
  });

  it('ends the series after this meeting when it stops repeating', async () => {
    const t = setup();
    const root = await t.begin();
    const list = t.alive(root.id);
    await t.series.updateSeries(list[2]!.id, { recurrenceRule: null });
    expect(t.alive(root.id).map((m) => m.id)).toEqual(list.slice(0, 3).map((m) => m.id));
    expect(t.meetings.rows.get(root.id)!.recurrenceRule).toMatchObject({ until: '2026-11-03' });
    t.clock.now = new Date(NOW.getTime() + 30 * DAY);
    expect(await t.series.extend(root.id)).toEqual([]);
  });

  it('refuses to change a meeting that is not in a series', async () => {
    const t = setup();
    const one = await t.meetings.create({ title: 'One-off', organizerId: 'u1', createdById: 'u1', startAt: TUE });
    await expect(t.series.updateSeries(one.id, { title: 'x' })).rejects.toThrow(/not part of a series/i);
  });
});

describe('meeting series: cancelling or deleting every upcoming meeting', () => {
  it('cancels the upcoming meetings and stops the series', async () => {
    const t = setup();
    const root = await t.begin();
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    const third = t.alive(root.id)[2]!;
    const result = await t.series.cancelSeries(third.id);
    const list = t.alive(root.id);
    expect(list.slice(0, 2).every((m) => m.status === 'SCHEDULED')).toBe(true);
    expect(list.slice(2).every((m) => m.status === 'CANCELLED')).toBe(true);
    expect(result.changed).toHaveLength(list.length - 2);
    expect(result.history).toBe(true);
    expect(t.meetings.rows.get(root.id)!.recurrenceRule).toMatchObject({ until: '2026-11-02' });
    t.clock.now = new Date('2026-12-01T08:00:00.000Z');
    expect(await t.series.extend(root.id)).toEqual([]);
  });

  it('cancels a series that has not started, first meeting included', async () => {
    const t = setup();
    const root = await t.begin();
    const result = await t.series.cancelSeries(root.id);
    expect(result.history).toBe(false);
    expect(t.alive(root.id).every((m) => m.status === 'CANCELLED')).toBe(true);
    t.clock.now = new Date('2026-12-01T08:00:00.000Z');
    expect(await t.series.extend(root.id)).toEqual([]);
  });

  it('deletes the upcoming meetings', async () => {
    const t = setup();
    const root = await t.begin();
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    const third = t.alive(root.id)[2]!;
    await t.series.deleteSeries(third.id);
    expect(t.alive(root.id)).toHaveLength(2);
    t.clock.now = new Date('2026-12-01T08:00:00.000Z');
    expect(await t.series.extend(root.id)).toEqual([]);
  });
});

describe('meeting series: the meetings after one', () => {
  it('lists the upcoming meetings later in the series', async () => {
    const t = setup();
    const root = await t.begin();
    const list = t.alive(root.id);
    await t.meetings.update(list[4]!.id, { status: 'CANCELLED' });
    const later = await t.series.laterMeetings(list[2]!.id);
    expect(later.map((m) => m.id)).toEqual([list[3]!.id, ...list.slice(5).map((m) => m.id)]);
    expect(await t.series.laterMeetings(list.at(-1)!.id)).toEqual([]);
  });

  it('names a meeting’s series', async () => {
    const t = setup();
    const root = await t.begin();
    const second = t.alive(root.id)[1]!;
    expect(t.series.seriesIdOf(second)).toBe(root.id);
    expect(t.series.seriesIdOf(t.meetings.rows.get(root.id)!)).toBe(root.id);
    const one = await t.meetings.create({ title: 'One-off', organizerId: 'u1', createdById: 'u1', startAt: TUE });
    expect(t.series.seriesIdOf(one)).toBeNull();
  });
});
