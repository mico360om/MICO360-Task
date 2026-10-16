import { describe, it, expect, vi } from 'vitest';
import { createMeetingNotifyService } from './meeting-notify-service';
import { createMeetingSeriesService } from './meeting-series-service';
import { memoryAttendees, memoryMeetings } from './meeting-memory.fixture';
import type { RecurrenceRule } from './meeting-repository';

const TZ = 'Asia/Muscat';
const NOW = new Date('2026-10-16T08:00:00.000Z');
const TUE = new Date('2026-10-20T06:00:00.000Z'); // 10:00 Muscat
const HOUR = 3_600_000;

const directory: Record<string, { name: string; email: string }> = {
  u1: { name: 'Aisha Khan', email: 'aisha@mico360.test' },
  u2: { name: 'Khurram Admin', email: 'khurram@mico360.test' },
};

/** Unfold RFC-5545 folded lines so assertions can match logical lines. */
const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '');

async function setup(rule: RecurrenceRule = { freq: 'WEEKLY', interval: 1 }) {
  const meetings = memoryMeetings();
  const attendees = memoryAttendees();
  const clock = { now: NOW };
  const series = createMeetingSeriesService({ meetings, attendees, now: () => clock.now, defaultTimeZone: TZ });
  const email = {
    sendMeetingInvite: vi.fn(async (_to: string, _params: unknown, _ics: unknown) => {}),
    sendMeetingReminder: vi.fn(async () => {}),
    sendMeetingCancelled: vi.fn(async (_to: string, _params: unknown, _ics: unknown) => {}),
    sendMeetingMinutes: vi.fn(async () => {}),
  };
  const notify = createMeetingNotifyService({
    meetings,
    attendees,
    email,
    resolveUser: async (uid) => directory[uid] ?? null,
    appUrl: 'https://app.mico360.test',
    defaultTimeZone: TZ,
    now: () => clock.now,
  });
  const root = await meetings.create({
    title: 'Weekly sync', organizerId: 'u1', createdById: 'u1', status: 'SCHEDULED', startAt: TUE, endAt: new Date(TUE.getTime() + HOUR),
    timeZone: TZ, location: 'Room 2', recurrenceRule: rule,
  });
  await attendees.add({ meetingId: root.id, userId: 'u2' });
  await attendees.add({ meetingId: root.id, externalName: 'Sara', externalEmail: 'sara@example.com' });
  await series.start(root);
  const list = () => [...meetings.rows.values()].filter((m) => !m.deletedAt).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const icsOf = (call: unknown[] | undefined) => unfold((call![2] as { content: Buffer }).content.toString('utf8'));
  return { meetings, attendees, clock, series, email, notify, root, list, icsOf };
}

describe('series invitations', () => {
  it('invites to the whole series from any of its meetings, and records it on every meeting', async () => {
    const t = await setup({ freq: 'WEEKLY', interval: 1, weekdays: [2] });
    const third = t.list()[2]!;
    const report = await t.notify.sendInvites(third.id);
    expect(report.sent).toBe(3);
    const ics = t.icsOf(t.email.sendMeetingInvite.mock.calls[0]);
    expect(ics).toContain(`UID:meeting-${t.root.id}@mico360`);
    expect(ics).toContain('DTSTART;TZID=Asia/Muscat:20261020T100000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    const params = t.email.sendMeetingInvite.mock.calls[0]![1] as { whenLabel: string };
    expect(params.whenLabel).toContain('Repeats every week on Tue');
    for (const m of t.list()) {
      expect(m.invitesSentAt).toEqual(NOW);
      expect((await t.attendees.listByMeeting(m.id)).every((a) => a.invitedAt?.getTime() === NOW.getTime())).toBe(true);
    }
  });

  it('lists a meeting moved on its own as a change, and a cancelled one as a skipped date', async () => {
    const t = await setup();
    const [, second, third] = t.list();
    await t.meetings.update(second!.id, { startAt: new Date(second!.startAt.getTime() + 2 * HOUR), endAt: new Date(second!.startAt.getTime() + 3 * HOUR) });
    await t.meetings.update(third!.id, { status: 'CANCELLED' });
    await t.notify.sendInvites(t.root.id);
    const ics = t.icsOf(t.email.sendMeetingInvite.mock.calls[0]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('RECURRENCE-ID;TZID=Asia/Muscat:20261027T100000');
    expect(ics).toContain('DTSTART;TZID=Asia/Muscat:20261027T120000');
    expect(ics).toContain('EXDATE;TZID=Asia/Muscat:20261103T100000');
  });

  it('updates just one meeting of the series', async () => {
    const t = await setup();
    const second = t.list()[1]!;
    await t.meetings.update(second.id, { location: 'Room 9' });
    await t.notify.sendInvites(second.id, { scope: 'one' });
    const ics = t.icsOf(t.email.sendMeetingInvite.mock.calls[0]);
    expect(ics).toContain(`UID:meeting-${t.root.id}@mico360`);
    expect(ics).toContain('RECURRENCE-ID;TZID=Asia/Muscat:20261027T100000');
    expect(ics).toContain('LOCATION:Room 9');
    expect(ics).not.toContain('RRULE');
    expect(t.meetings.rows.get(t.root.id)!.invitesSentAt).toBeNull(); // only this meeting was sent
  });
});

describe('series invitations: review fixes', () => {
  it('describes the series with its own details, not those of a meeting changed on its own', async () => {
    const t = await setup();
    const third = t.list()[2]!;
    await t.meetings.update(third.id, { title: 'Special review', location: 'Room 9' });
    await t.notify.sendInvites(third.id);
    const ics = t.icsOf(t.email.sendMeetingInvite.mock.calls[0]);
    const [master, ...overrides] = ics.split('BEGIN:VEVENT').slice(1);
    expect(master).toContain('SUMMARY:Weekly sync');
    expect(master).toContain('LOCATION:Room 2');
    expect(master).toContain('RRULE:');
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toContain('SUMMARY:Special review');
    expect(overrides[0]).toContain('RECURRENCE-ID;TZID=Asia/Muscat:20261103T100000');
  });

  it('sends an update for one meeting only to people who already have the series', async () => {
    const t = await setup();
    await t.notify.sendInvites(t.root.id);
    const second = t.list()[1]!;
    const guest = await t.attendees.add({ meetingId: second.id, externalName: 'Late guest', externalEmail: 'late@example.com' });
    t.email.sendMeetingInvite.mockClear();
    await t.notify.sendInvites(second.id, { scope: 'one' });
    const to = t.email.sendMeetingInvite.mock.calls.map((c) => c[0]);
    expect(to).not.toContain('late@example.com');
    expect(to).toContain('khurram@mico360.test');
    expect((await t.attendees.findById(guest.id))!.invitedAt).toBeNull();
  });

  it('numbers each calendar update higher than the last, a cancellation included', async () => {
    const t = await setup();
    for (const m of t.list()) await t.meetings.markInvitesSent(m.id, NOW);
    let removed = null;
    for (const m of t.list()) {
      const a = (await t.attendees.listByMeeting(m.id)).find((x) => x.userId === 'u2')!;
      await t.attendees.remove(a.id);
      removed ??= a;
    }
    await t.notify.sendAttendeeRemoved(t.root.id, removed!);
    const cancelSeq = Number(/SEQUENCE:(\d+)/.exec(t.icsOf(t.email.sendMeetingCancelled.mock.calls[0]))![1]);
    t.clock.now = new Date(NOW.getTime() + 60_000);
    await t.attendees.add({ meetingId: t.root.id, userId: 'u2' });
    await t.notify.sendInvites(t.root.id, { onlyNew: true });
    const inviteSeq = Number(/SEQUENCE:(\d+)/.exec(t.icsOf(t.email.sendMeetingInvite.mock.calls.at(-1)))![1]);
    expect(inviteSeq).toBeGreaterThan(cancelSeq);
  });

  it('tells someone taken off a series that they are off it — not that it is cancelled', async () => {
    const t = await setup();
    for (const m of t.list()) await t.meetings.markInvitesSent(m.id, NOW);
    let removed = null;
    for (const m of t.list()) {
      const a = (await t.attendees.listByMeeting(m.id)).find((x) => x.userId === 'u2')!;
      await t.attendees.remove(a.id);
      removed ??= a;
    }
    await t.notify.sendAttendeeRemoved(t.root.id, removed!);
    const label = (t.email.sendMeetingCancelled.mock.calls[0]![1] as { whenLabel: string }).whenLabel;
    expect(label).toMatch(/no longer on/i);
    expect(label).not.toMatch(/cancelled/i);
  });
});

describe('series cancellations', () => {
  it('cancels one meeting of the series', async () => {
    const t = await setup();
    const second = t.list()[1]!;
    await t.notify.sendCancellation(second.id);
    const ics = t.icsOf(t.email.sendMeetingCancelled.mock.calls[0]);
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain(`UID:meeting-${t.root.id}@mico360`);
    expect(ics).toContain('RECURRENCE-ID;TZID=Asia/Muscat:20261027T100000');
  });

  it('cancels a whole series that has not started', async () => {
    const t = await setup();
    await t.series.cancelSeries(t.root.id);
    await t.notify.sendCancellation(t.root.id, { scope: 'series' });
    const ics = t.icsOf(t.email.sendMeetingCancelled.mock.calls[0]);
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain(`UID:meeting-${t.root.id}@mico360`);
    expect(ics).not.toContain('RECURRENCE-ID');
  });

  it('ends a series that has started at its last held meeting, keeping the past in calendars', async () => {
    const t = await setup();
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    const third = t.list()[2]!;
    await t.series.cancelSeries(third.id);
    await t.notify.sendCancellation(third.id, { scope: 'series' });
    const call = t.email.sendMeetingCancelled.mock.calls[0];
    const ics = t.icsOf(call);
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=20261102T195959Z');
    expect((call![1] as { whenLabel: string }).whenLabel).toMatch(/upcoming meetings are cancelled/i);
  });
});

describe('people taken off a series', () => {
  it('removes the series from the calendar of someone on none of its upcoming meetings', async () => {
    const t = await setup();
    for (const m of t.list()) await t.meetings.markInvitesSent(m.id, NOW);
    let removed = null;
    for (const m of t.list()) {
      const a = (await t.attendees.listByMeeting(m.id)).find((x) => x.userId === 'u2')!;
      await t.attendees.remove(a.id);
      removed ??= a;
    }
    await t.notify.sendAttendeeRemoved(t.root.id, removed!);
    const call = t.email.sendMeetingCancelled.mock.calls[0];
    expect(call![0]).toBe('khurram@mico360.test');
    expect(t.icsOf(call)).not.toContain('RECURRENCE-ID');
  });

  it('removes just that meeting for someone still on others', async () => {
    const t = await setup();
    for (const m of t.list()) await t.meetings.markInvitesSent(m.id, NOW);
    const second = t.list()[1]!;
    const a = (await t.attendees.listByMeeting(second.id)).find((x) => x.userId === 'u2')!;
    await t.attendees.remove(a.id);
    await t.notify.sendAttendeeRemoved(second.id, a);
    expect(t.icsOf(t.email.sendMeetingCancelled.mock.calls[0])).toContain('RECURRENCE-ID;TZID=Asia/Muscat:20261027T100000');
  });
});

describe('series notices: second review fixes', () => {
  it('sends the "series ended" notice to people added to its later meetings too, if they had the series', async () => {
    const t = await setup();
    await t.notify.sendInvites(t.root.id);
    const third = t.list()[2]!;
    const omar = await t.attendees.add({ meetingId: third.id, externalName: 'Omar', externalEmail: 'omar@example.com' });
    await t.attendees.markInvited!([omar.id], NOW);
    await t.attendees.add({ meetingId: third.id, externalName: 'Lina', externalEmail: 'lina@example.com' }); // never invited
    t.clock.now = new Date('2026-10-28T08:00:00.000Z');
    t.email.sendMeetingCancelled.mockClear();
    await t.notify.sendCancellation(t.root.id, { scope: 'series', note: 'moved', alsoTo: [third] });
    const to = t.email.sendMeetingCancelled.mock.calls.map((c) => c[0]);
    expect(to).toEqual(expect.arrayContaining(['aisha@mico360.test', 'khurram@mico360.test', 'sara@example.com', 'omar@example.com']));
    expect(to).not.toContain('lina@example.com');
    expect(new Set(to).size).toBe(to.length);
  });
});
