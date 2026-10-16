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

describe('meeting series: review fixes', () => {
  const series = (t: ReturnType<typeof setup>, rootId: string) =>
    [...t.meetings.rows.values()].filter((m) => !m.deletedAt && (m.id === rootId || m.recurrenceParentId === rootId)).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  it('moves a series that has not started to every other week without clashing with its own meetings', async () => {
    const t = setup();
    const root = await t.begin();
    const change = await t.series.updateSeries(root.id, { recurrenceRule: { freq: 'WEEKLY', interval: 2 } });
    expect(change.scheduleChanged).toBe(true);
    const list = series(t, root.id);
    expect(starts(list).slice(0, 4)).toEqual(['2026-10-20T06:00:00.000Z', '2026-11-03T06:00:00.000Z', '2026-11-17T06:00:00.000Z', '2026-12-01T06:00:00.000Z']);
    expect(list).toHaveLength(7); // 20 Oct … 12 Jan, every other week
  });

  it('moves a series bound to a weekday to the new day, keeping every meeting', async () => {
    const t = setup({ freq: 'WEEKLY', interval: 1, weekdays: [2], count: 5 });
    const root = await t.begin();
    const third = series(t, root.id)[2]!;
    // The 3rd meeting (Tue 3 Nov) moves to Thursday 5 Nov, for all upcoming meetings.
    await t.series.updateSeries(third.id, { startAt: new Date('2026-11-05T06:00:00.000Z'), endAt: new Date('2026-11-05T07:00:00.000Z') });
    const list = series(t, root.id);
    expect(starts(list)).toEqual(['2026-10-22T06:00:00.000Z', '2026-10-29T06:00:00.000Z', '2026-11-05T06:00:00.000Z', '2026-11-12T06:00:00.000Z', '2026-11-19T06:00:00.000Z']);
    expect(t.meetings.rows.get(root.id)!.recurrenceRule).toMatchObject({ weekdays: [4] });
    expect(list.find((m) => m.id === third.id)!.startAt.toISOString()).toBe('2026-11-05T06:00:00.000Z');
  });

  it('keeps a meeting deleted on its own as a gap when the series moves to a new time', async () => {
    const t = setup();
    const root = await t.begin();
    const before = series(t, root.id);
    await t.meetings.softDelete(before[3]!.id); // 10 Nov
    await t.series.updateSeries(root.id, { startAt: new Date('2026-10-20T07:00:00.000Z'), endAt: new Date('2026-10-20T08:00:00.000Z') });
    const days = series(t, root.id).map((m) => m.startAt.toISOString());
    expect(days).not.toContain('2026-11-10T07:00:00.000Z');
    expect(days.slice(0, 4)).toEqual(['2026-10-20T07:00:00.000Z', '2026-10-27T07:00:00.000Z', '2026-11-03T07:00:00.000Z', '2026-11-17T07:00:00.000Z']);
  });

  it('changes only the length of a series with a deleted meeting, without a clash', async () => {
    const t = setup();
    const root = await t.begin();
    await t.meetings.softDelete(series(t, root.id)[2]!.id);
    await expect(t.series.updateSeries(root.id, { endAt: new Date('2026-10-20T08:00:00.000Z') })).resolves.toMatchObject({ scheduleChanged: true });
    expect(series(t, root.id).every((m) => m.endAt!.getTime() - m.startAt.getTime() === 2 * HOUR)).toBe(true);
  });

  it('never revives a series that was cancelled or deleted before meetings were created for it', async () => {
    const t = setup();
    const cancelled = await t.meetings.create({ title: 'Old weekly', organizerId: 'u1', createdById: 'u1', status: 'CANCELLED', startAt: TUE, timeZone: TZ, recurrenceRule: WEEKLY });
    const deleted = await t.meetings.create({ title: 'Old daily', organizerId: 'u1', createdById: 'u1', status: 'SCHEDULED', startAt: TUE, timeZone: TZ, recurrenceRule: { freq: 'DAILY', interval: 1 } });
    await t.meetings.softDelete(deleted.id);
    expect(await t.series.extend(cancelled.id)).toEqual([]);
    expect(await t.series.extend(deleted.id)).toEqual([]);
  });

  it('leaves the series as it was when a new schedule is refused', async () => {
    const t = setup();
    const root = await t.begin();
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    const third = series(t, root.id)[2]!;
    await expect(t.series.updateSeries(third.id, { recurrenceRule: { freq: 'WEEKLY', interval: 1, until: '2026-10-29' } })).rejects.toThrow(/no upcoming meetings/i);
    expect(t.meetings.rows.get(root.id)!.recurrenceRule).toEqual({ freq: 'WEEKLY', interval: 1 });
    expect(series(t, root.id)).toHaveLength(13);
  });

  it('postpones a series by more than three months', async () => {
    const t = setup();
    const root = await t.begin();
    const later = new Date('2027-02-02T06:00:00.000Z'); // 15 weeks on
    const change = await t.series.updateSeries(root.id, { startAt: later, endAt: new Date(later.getTime() + HOUR) });
    expect(starts(series(t, change.rootId)).slice(0, 2)).toEqual(['2027-02-02T06:00:00.000Z', '2027-02-09T06:00:00.000Z']);
  });

  it('ends the old series in calendars when its first meeting had been deleted on its own', async () => {
    const t = setup();
    const root = await t.begin();
    const second = series(t, root.id)[1]!;
    await t.meetings.softDelete(root.id);
    const change = await t.series.updateSeries(second.id, { startAt: new Date('2026-10-27T07:00:00.000Z'), endAt: new Date('2026-10-27T08:00:00.000Z') });
    expect(change.endedRootId).toBe(root.id);
    expect(change.endedMeeting?.id).toBe(root.id);
  });

  it('puts the first meeting on the repeat’s first day when it falls outside the chosen days', async () => {
    const t = setup({ freq: 'WEEKLY', interval: 1, weekdays: [1, 3], count: 3 }); // Mon, Wed; first meeting on a Tuesday
    const root = await t.begin();
    const first = t.meetings.rows.get(root.id)!;
    expect(first.startAt.toISOString()).toBe('2026-10-21T06:00:00.000Z'); // Wednesday
    expect(first.endAt!.toISOString()).toBe('2026-10-21T07:00:00.000Z');
    expect(starts(series(t, root.id))).toEqual(['2026-10-21T06:00:00.000Z', '2026-10-26T06:00:00.000Z', '2026-10-28T06:00:00.000Z']);
  });

  it('does not carry attendee changes from a meeting already held', async () => {
    const t = setup();
    const root = await t.begin();
    t.clock.now = new Date('2026-10-21T08:00:00.000Z');
    expect(await t.series.laterMeetings(root.id)).toEqual([]);
  });

  it('reports a meeting still in the series when the edited one is no longer part of it', async () => {
    const t = setup();
    const root = await t.begin();
    const ninth = series(t, root.id)[8]!;
    const change = await t.series.updateSeries(ninth.id, { recurrenceRule: { freq: 'WEEKLY', interval: 1, count: 4 } });
    expect(t.meetings.rows.get(ninth.id)!.deletedAt).toBeTruthy();
    expect(change.meeting).not.toBeNull();
    expect(change.meeting!.deletedAt ?? null).toBeNull();
  });

  it('says whether the schedule changed', async () => {
    const t = setup();
    const root = await t.begin();
    expect((await t.series.updateSeries(root.id, { category: 'Weekly' })).scheduleChanged).toBe(false);
  });
});

describe('meeting series: second review fixes', () => {
  const series = (t: ReturnType<typeof setup>, rootId: string) =>
    [...t.meetings.rows.values()].filter((m) => !m.deletedAt && (m.id === rootId || m.recurrenceParentId === rootId)).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  it('keeps every meeting on its day when today’s meeting’s new time has already passed', async () => {
    const t = setup();
    const root = await t.begin();
    const before = series(t, root.id);
    t.clock.now = new Date('2026-10-20T05:30:00.000Z'); // Tue 09:30; today's meeting is at 10:00
    const second = before[1]!;
    // From next week's meeting: every upcoming meeting at 09:00.
    await t.series.updateSeries(second.id, { startAt: new Date('2026-10-27T05:00:00.000Z'), endAt: new Date('2026-10-27T06:00:00.000Z') });
    const after = series(t, root.id);
    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
    expect(after[0]!.startAt.toISOString()).toBe('2026-10-20T06:00:00.000Z'); // 09:00 has passed: it keeps 10:00
    expect(starts(after.slice(1, 3))).toEqual(['2026-10-27T05:00:00.000Z', '2026-11-03T05:00:00.000Z']);
    expect(after.at(-1)!.startAt.toISOString()).toBe('2027-01-12T05:00:00.000Z');
    expect(t.meetings.rows.get(root.id)!.recurrenceStart?.toISOString()).toBe('2026-10-20T05:00:00.000Z');
    t.clock.now = new Date('2026-10-27T08:00:00.000Z');
    expect(starts(await t.series.extend(root.id))).toEqual(['2027-01-19T05:00:00.000Z']); // the new time
  });

  it('keeps a meeting postponed on its own on its new date when only the length changes', async () => {
    const t = setup();
    const root = await t.begin();
    const before = series(t, root.id);
    const second = before[1]!; // Tue 27 Oct, postponed on its own to Thu 29 Oct
    await t.meetings.update(second.id, { startAt: new Date('2026-10-29T06:00:00.000Z'), endAt: new Date('2026-10-29T07:00:00.000Z') });
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    const third = before[2]!; // Tue 3 Nov: 90 minutes from now on
    await t.series.updateSeries(third.id, { endAt: new Date('2026-11-03T07:30:00.000Z') });
    const row = (id: string) => t.meetings.rows.get(id)!;
    expect(row(second.id).startAt.toISOString()).toBe('2026-10-29T06:00:00.000Z');
    expect(row(second.id).endAt!.toISOString()).toBe('2026-10-29T07:30:00.000Z');
    expect(row(third.id).startAt.toISOString()).toBe('2026-11-03T06:00:00.000Z');
    expect(row(before[3]!.id).startAt.toISOString()).toBe('2026-11-10T06:00:00.000Z');
  });

  it('keeps the date typed for the edited meeting when only the time of a meeting moved on its own changes', async () => {
    const t = setup({ freq: 'WEEKLY', interval: 1, weekdays: [2] });
    const root = await t.begin();
    const third = series(t, root.id)[2]!; // Tue 3 Nov, moved on its own to Wed 4 Nov
    await t.meetings.update(third.id, { startAt: new Date('2026-11-04T06:00:00.000Z'), endAt: new Date('2026-11-04T07:00:00.000Z') });
    await t.series.updateSeries(third.id, { startAt: new Date('2026-11-04T07:00:00.000Z'), endAt: new Date('2026-11-04T08:00:00.000Z') });
    expect(t.meetings.rows.get(third.id)!.startAt.toISOString()).toBe('2026-11-04T07:00:00.000Z');
    expect(t.meetings.rows.get(root.id)!.recurrenceRule).toMatchObject({ weekdays: [2] });
    expect(series(t, root.id)[3]!.startAt.toISOString()).toBe('2026-11-10T07:00:00.000Z');
  });

  it('moves the series from a meeting’s place when that meeting had been moved on its own', async () => {
    const t = setup({ freq: 'WEEKLY', interval: 1, weekdays: [2] });
    const root = await t.begin();
    const third = series(t, root.id)[2]!; // Tue 3 Nov, moved on its own to Wed 4 Nov
    await t.meetings.update(third.id, { startAt: new Date('2026-11-04T06:00:00.000Z'), endAt: new Date('2026-11-04T07:00:00.000Z') });
    // Now moved to Thursday 5 Nov for all upcoming meetings: the series repeats on Thursdays.
    await t.series.updateSeries(third.id, { startAt: new Date('2026-11-05T06:00:00.000Z'), endAt: new Date('2026-11-05T07:00:00.000Z') });
    expect(t.meetings.rows.get(root.id)!.recurrenceRule).toMatchObject({ weekdays: [4] });
    expect(starts(series(t, root.id).slice(0, 3))).toEqual(['2026-10-22T06:00:00.000Z', '2026-10-29T06:00:00.000Z', '2026-11-05T06:00:00.000Z']);
  });

  it('never makes a meeting deleted on its own the first meeting of the new series', async () => {
    const t = setup();
    const root = await t.begin();
    const [, second, third] = series(t, root.id);
    await t.meetings.softDelete(second!.id); // 27 Oct deleted on its own
    t.clock.now = new Date('2026-10-21T08:00:00.000Z'); // the first meeting was held
    const change = await t.series.updateSeries(third!.id, { startAt: new Date('2026-11-03T07:00:00.000Z'), endAt: new Date('2026-11-03T08:00:00.000Z') });
    expect(change.rootId).toBe(third!.id);
    expect(t.meetings.rows.get(third!.id)!).toMatchObject({ recurrenceParentId: null, recurrenceRule: expect.objectContaining({ freq: 'WEEKLY' }) });
    expect(t.meetings.rows.get(second!.id)!).toMatchObject({ recurrenceRule: null });
    expect(t.meetings.rows.get(second!.id)!.deletedAt).toBeTruthy();
    expect(starts(series(t, third!.id).slice(0, 2))).toEqual(['2026-11-03T07:00:00.000Z', '2026-11-10T07:00:00.000Z']);
  });

  it('goes on with a yearly series whose only meeting so far was cancelled on its own', async () => {
    const t = setup({ freq: 'YEARLY', interval: 1 });
    const root = await t.begin();
    expect(series(t, root.id)).toHaveLength(1);
    await t.meetings.update(root.id, { status: 'CANCELLED' });
    t.clock.now = new Date('2027-08-01T08:00:00.000Z');
    expect(starts(await t.series.extend(root.id))).toEqual(['2027-10-20T06:00:00.000Z']);
  });

  it('tells the apps when the first meeting moves onto the repeat’s days, and resets its reminder', async () => {
    const t = setup();
    const root = await t.meetings.create({
      title: 'Wednesday sync', organizerId: 'u1', createdById: 'u1', status: 'SCHEDULED', startAt: TUE, endAt: new Date(TUE.getTime() + HOUR),
      timeZone: TZ, recurrenceRule: { freq: 'WEEKLY', interval: 1, weekdays: [3] },
    });
    await t.meetings.markReminderSent(root.id, NOW);
    await t.series.start(t.meetings.rows.get(root.id)!);
    expect(t.meetings.rows.get(root.id)!.reminderSentAt).toBeNull();
    expect(t.onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: root.id, startAt: new Date('2026-10-21T06:00:00.000Z') }), 'updated');
  });

  it('names the meetings whose people may change the series: those still to come', async () => {
    const t = setup();
    const root = await t.begin();
    const list = series(t, root.id);
    await t.meetings.update(list[3]!.id, { status: 'CANCELLED' });
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    const facts = await t.series.seriesEditFacts(list[5]!);
    expect(facts.root.id).toBe(root.id);
    expect(facts.upcoming[0]!.startAt.toISOString()).toBe('2026-11-03T06:00:00.000Z');
    expect(facts.upcoming.map((m) => m.id)).not.toContain(list[3]!.id);
    expect(facts.upcoming).toHaveLength(list.length - 3);
  });
});
