import { describe, it, expect, vi } from 'vitest';
import { createMeetingReminderService, reminderKey, type DueMeeting, type MeetingReminderStore, type ReminderSendKey } from './meeting-reminder-service';
import { DEFAULT_MEETING_REMINDERS, type MeetingReminderSettings } from '../settings/settings-service';
import { EmailDeliveryError, EmailNotConfiguredError } from '../email/delivery-error';
import type { AttendeeRecord } from './attendee-repository';
import type { ReminderPerson } from './meeting-reminders';
import type { CreateNotificationData } from '../notifications/notification-repository';
import type { NotifyOptions } from '../notifications/notification-service';
import type { MeetingEmailParams } from '../email/email-templates';

const MIN = 60_000;
// Sat 31 Oct 2026, 09:00–10:00 Muscat.
const START = new Date('2026-10-31T05:00:00Z');

const attendee = (over: Partial<AttendeeRecord>): AttendeeRecord => ({
  id: `a-${over.userId ?? over.externalEmail}`, meetingId: 'm1', userId: null, externalName: null, externalEmail: null, role: 'REQUIRED', attendance: 'INVITED',
  response: 'ACCEPTED', respondedAt: null, invitedAt: null, department: null, createdAt: START, ...over,
});

function meeting(over: Partial<DueMeeting> = {}): DueMeeting {
  return {
    id: 'm1', title: 'Core switch go-live review', description: null, status: 'SCHEDULED', projectId: 'p1', projectName: 'Core switch', organizerId: 'org',
    location: 'OXY HQ – Meeting room 2', onlineLink: 'https://meet.example.com/abc', startAt: START, endAt: new Date(START.getTime() + 60 * MIN), timeZone: 'Asia/Muscat',
    attendees: [attendee({ userId: 'ann' }), attendee({ externalName: 'Guest', externalEmail: 'guest@client.test' })],
    ...over,
  };
}

const person = (id: string, over: Partial<ReminderPerson> = {}): ReminderPerson => ({ userId: id, name: id.toUpperCase(), email: `${id}@oxy.test`, timeZone: null, muted: false, ...over });

/** A store with the unique key the database has: a key is taken once. */
function memoryStore(): MeetingReminderStore & { rows: Map<string, { status: string; key: ReminderSendKey }> } {
  const rows = new Map<string, { status: string; key: ReminderSendKey }>();
  let seq = 0;
  const ids = new Map<string, string>();
  return {
    rows,
    async takenFor(meetingIds) {
      return new Set([...rows.values()].filter((r) => meetingIds.includes(r.key.meetingId)).map((r) => reminderKey(r.key)));
    },
    async reserve(key) {
      const k = reminderKey(key);
      if ([...rows.values()].some((r) => reminderKey(r.key) === k)) return null;
      const id = `r${seq++}`;
      rows.set(id, { status: 'SENDING', key });
      ids.set(k, id);
      return id;
    },
    async finish(id, status) {
      rows.get(id)!.status = status;
    },
    async release(id) {
      rows.delete(id);
    },
    async prune() {
      return 0;
    },
  };
}

function setup(opts: { meetings?: DueMeeting[]; settings?: MeetingReminderSettings; people?: ReminderPerson[]; now?: Date; email?: (to: string) => Promise<void>; emailOptions?: (meetingId: string) => Promise<never> } = {}) {
  let now = opts.now ?? new Date(START.getTime() - 15 * MIN);
  let list = opts.meetings ?? [meeting()];
  const people = new Map((opts.people ?? [person('org'), person('ann')]).map((p) => [p.userId, p] as const));
  const store = memoryStore();
  const dueMeetings = vi.fn(async (windows: Array<{ from: Date; to: Date }>) =>
    list.filter((m) => m.status === 'SCHEDULED' && windows.some((w) => m.startAt > w.from && m.startAt <= w.to)),
  );
  const notify = vi.fn(async (input: CreateNotificationData, _opts?: NotifyOptions) => ({ id: `n-${input.userId}`, ...input }) as never);
  const sendMeetingReminder = vi.fn(async (to: string, _params: MeetingEmailParams & { startsInLabel: string }) => {
    if (opts.email) await opts.email(to);
  });
  const logger = { error: vi.fn(), warn: vi.fn() };
  const svc = createMeetingReminderService({
    settings: async () => opts.settings ?? DEFAULT_MEETING_REMINDERS,
    source: { dueMeetings, people: async (ids) => new Map([...people].filter(([id]) => ids.includes(id))) },
    store,
    notify,
    email: { sendMeetingReminder },
    appUrl: 'https://task.mico360.com/',
    defaultTimeZone: 'Asia/Muscat',
    logger,
    now: () => now,
    ...(opts.emailOptions ? { emailOptions: opts.emailOptions } : {}),
  });
  return {
    svc, store, notify, sendMeetingReminder, logger, dueMeetings,
    setNow: (d: Date) => { now = d; },
    setMeetings: (m: DueMeeting[]) => { list = m; },
  };
}

/** The guest's 24-hour email went the day before (the usual case: the meeting was booked in good time). */
async function guestEmailedTheDayBefore(store: MeetingReminderStore, startAt: Date = START, meetingId = 'm1'): Promise<void> {
  const id = await store.reserve({ meetingId, recipientKey: 'guest:guest@client.test', offsetMinutes: 1440, startAt, channel: 'EMAIL', userId: null, email: 'guest@client.test' });
  await store.finish(id!, 'SENT', new Date(startAt.getTime() - 1440 * MIN));
}

describe('the meeting reminder sweep', () => {
  it('15 minutes before: the organizer and invited colleagues get the bell and a phone push; nobody an email (not ticked)', async () => {
    const t = setup();
    await guestEmailedTheDayBefore(t.store);
    const r = await t.svc.runSweep();
    expect(r).toMatchObject({ meetings: 1, sent: 2, failed: 0 });
    expect(t.notify.mock.calls.map((c) => c[0].userId)).toEqual(['org', 'ann']);
    expect(t.notify.mock.calls[0]![0]).toEqual({
      userId: 'org', type: 'MEETING_REMINDER', title: 'Meeting in 15 minutes: Core switch go-live review',
      body: '09:00–10:00 · OXY HQ – Meeting room 2 · Join online', entityType: 'meeting', entityId: 'm1',
    });
    // Its own Android channel, gone once the meeting has started, and it replaces the meeting's earlier one.
    // Notification & Scheduling: held by quiet hours or Pause past the start, it is dropped (expiresAt).
    expect(t.notify.mock.calls[0]![1]).toEqual({ push: { channelId: 'meetings', ttlSeconds: 900, tag: 'meeting-m1' }, expiresAt: START });
    expect(t.sendMeetingReminder).not.toHaveBeenCalled();
  });

  it('24 hours before (ticked "also by email"): the bell, the push and an email — and the outside guest only the email', async () => {
    const t = setup({ now: new Date(START.getTime() - 24 * 60 * MIN) });
    await t.svc.runSweep();
    expect(t.notify.mock.calls.map((c) => [c[0].userId, c[0].title])).toEqual([
      ['org', 'Meeting tomorrow at 09:00: Core switch go-live review'],
      ['ann', 'Meeting tomorrow at 09:00: Core switch go-live review'],
    ]);
    expect(t.sendMeetingReminder.mock.calls.map((c) => c[0])).toEqual(['org@oxy.test', 'ann@oxy.test', 'guest@client.test']);
    expect(t.sendMeetingReminder.mock.calls[2]![1]).toMatchObject({
      title: 'Core switch go-live review',
      startsInLabel: 'starts tomorrow at 09:00',
      whenLabel: 'Sat 31 Oct 2026, 09:00–10:00 (GMT+4)',
      location: 'OXY HQ – Meeting room 2',
      onlineLink: 'https://meet.example.com/abc',
      organizerName: 'ORG',
      projectName: 'Core switch',
      link: 'https://task.mico360.com/meetings/m1',
    });
  });

  it('a second sweep (or a second server) sends nothing again', async () => {
    const t = setup();
    await t.svc.runSweep();
    t.setNow(new Date(START.getTime() - 14 * MIN));
    const again = await t.svc.runSweep();
    expect(again.sent).toBe(0);
    expect(t.notify).toHaveBeenCalledTimes(2);
    // Two servers at the same moment: each send is taken once.
    const u = setup();
    await guestEmailedTheDayBefore(u.store);
    const [a, b] = await Promise.all([u.svc.runSweep(), u.svc.runSweep()]);
    expect(a.sent + b.sent).toBe(2);
    expect(u.notify).toHaveBeenCalledTimes(2);
  });

  it('nothing while the switch is off, and only the times an administrator set', async () => {
    const off = setup({ settings: { ...DEFAULT_MEETING_REMINDERS, enabled: false } });
    expect(await off.svc.runSweep()).toMatchObject({ meetings: 0, sent: 0 });
    expect(off.dueMeetings).not.toHaveBeenCalled();
    const custom = setup({ settings: { enabled: true, times: [{ minutes: 30, email: false }] } });
    expect((await custom.svc.runSweep()).sent).toBe(0); // 15 minutes before: no 15-minute reminder any more
    custom.setNow(new Date(START.getTime() - 30 * MIN));
    expect((await custom.svc.runSweep()).sent).toBe(2);
    expect(custom.notify.mock.calls[0]![0].title).toBe('Meeting in 30 minutes: Core switch go-live review');
  });

  it('a moved meeting is reminded at its new time (what was sent for the old time doesn’t block it)', async () => {
    const t = setup();
    await guestEmailedTheDayBefore(t.store);
    await t.svc.runSweep();
    const later = new Date(START.getTime() + 60 * MIN);
    await guestEmailedTheDayBefore(t.store, later); // moved the day before: the guest had the new time's email too
    t.setMeetings([meeting({ startAt: later, endAt: new Date(later.getTime() + 60 * MIN) })]);
    t.setNow(new Date(later.getTime() - 15 * MIN));
    expect((await t.svc.runSweep()).sent).toBe(2);
    expect(t.notify.mock.calls.at(-1)![0].body).toBe('10:00–11:00 · OXY HQ – Meeting room 2 · Join online');
  });

  it('a cancelled meeting, or one whose start has passed, gets nothing', async () => {
    const t = setup({ meetings: [meeting({ status: 'CANCELLED' })] });
    expect((await t.svc.runSweep()).sent).toBe(0);
    // A store that returned it anyway (a moment's race): still nothing once it has started.
    const u = setup({ now: START });
    u.dueMeetings.mockResolvedValueOnce([meeting()]);
    expect((await u.svc.runSweep()).sent).toBe(0);
    expect(u.notify).not.toHaveBeenCalled();
  });

  it('people who declined, were taken off, or switched meeting reminders off get none', async () => {
    const t = setup({
      meetings: [meeting({ attendees: [attendee({ userId: 'ann', response: 'DECLINED' }), attendee({ userId: 'mut' }), attendee({ externalEmail: 'no@client.test', response: 'DECLINED' })] })],
      people: [person('org'), person('ann'), person('mut', { muted: true })],
      now: new Date(START.getTime() - 24 * 60 * MIN),
    });
    await t.svc.runSweep();
    expect(t.notify.mock.calls.map((c) => c[0].userId)).toEqual(['org']);
    expect(t.sendMeetingReminder.mock.calls.map((c) => c[0])).toEqual(['org@oxy.test']);
  });

  it('times in the meeting’s zone; someone in another zone also gets theirs', async () => {
    const t = setup({ people: [person('org', { timeZone: 'Europe/London' }), person('ann')] });
    await t.svc.runSweep();
    expect(t.notify.mock.calls[0]![0].body).toBe('09:00–10:00 GMT+4 (05:00–06:00 your time) · OXY HQ – Meeting room 2 · Join online');
    expect(t.notify.mock.calls[1]![0].body).toBe('09:00–10:00 · OXY HQ – Meeting room 2 · Join online');
    // A meeting stored without a zone (or a broken one) is said in the company's.
    const u = setup({ meetings: [meeting({ timeZone: 'Not/AZone' })] });
    await u.svc.runSweep();
    expect(u.notify.mock.calls[0]![0].body).toBe('09:00–10:00 · OXY HQ – Meeting room 2 · Join online');
  });

  it('an email that fails is tried again by the next sweep, while the reminder is still due — the bell is not sent twice', async () => {
    let fail = true;
    const t = setup({
      now: new Date(START.getTime() - 24 * 60 * MIN),
      email: async (to) => {
        if (fail && to === 'ann@oxy.test') throw new EmailDeliveryError(to, 503, 'down');
      },
    });
    const first = await t.svc.runSweep();
    expect(first.failed).toBe(1);
    expect(t.logger.error).toHaveBeenCalledWith('meeting reminder failed', expect.objectContaining({ meetingId: 'm1', channel: 'EMAIL' }));
    fail = false;
    t.setNow(new Date(START.getTime() - 24 * 60 * MIN + MIN));
    const second = await t.svc.runSweep();
    expect(second.sent).toBe(1);
    expect(t.sendMeetingReminder.mock.calls.filter((c) => c[0] === 'ann@oxy.test')).toHaveLength(2);
    expect(t.sendMeetingReminder.mock.calls.filter((c) => c[0] === 'org@oxy.test')).toHaveLength(1);
    expect(t.notify).toHaveBeenCalledTimes(2);
  });

  it('email not set up on this server: the bell and the push still go, the emails are skipped (not retried)', async () => {
    const t = setup({ now: new Date(START.getTime() - 24 * 60 * MIN), email: async (to) => { throw new EmailNotConfiguredError(to); } });
    const r = await t.svc.runSweep();
    expect(r).toMatchObject({ sent: 2, skipped: 3, failed: 0 });
    await t.svc.runSweep();
    expect(t.sendMeetingReminder).toHaveBeenCalledTimes(3);
    expect([...t.store.rows.values()].filter((x) => x.key.channel === 'EMAIL').every((x) => x.status === 'SKIPPED')).toBe(true);
  });

  it('one broken meeting doesn’t stop the others’ reminders', async () => {
    const t = setup({ meetings: [meeting({ id: 'bad', attendees: null as never }), meeting({ id: 'good' })] });
    await guestEmailedTheDayBefore(t.store, START, 'good');
    const r = await t.svc.runSweep();
    expect(r.sent).toBe(2);
    expect(t.notify.mock.calls.every((c) => c[0].entityType === 'meeting' && c[0].entityId === 'good')).toBe(true);
    expect(t.logger.error).toHaveBeenCalledWith('meeting reminders failed', expect.objectContaining({ meetingId: 'bad' }));
  });

  it('records each send under (meeting, person, time, start, way) — what makes a duplicate impossible', async () => {
    const t = setup({ now: new Date(START.getTime() - 24 * 60 * MIN) });
    await t.svc.runSweep();
    const keys = [...t.store.rows.values()].map((r) => reminderKey(r.key)).sort();
    expect(keys).toEqual([
      `m1|guest:guest@client.test|1440|${START.toISOString()}|EMAIL`,
      `m1|user:ann|1440|${START.toISOString()}|APP`,
      `m1|user:ann|1440|${START.toISOString()}|EMAIL`,
      `m1|user:org|1440|${START.toISOString()}|APP`,
      `m1|user:org|1440|${START.toISOString()}|EMAIL`,
    ]);
    expect([...t.store.rows.values()].every((r) => r.status === 'SENT')).toBe(true);
  });

  it('a send that went but couldn’t be written down is never sent again (it is not given back)', async () => {
    const t = setup();
    const finish = t.store.finish.bind(t.store);
    let broken = true;
    t.store.finish = async (id, status, at) => {
      if (broken) throw new Error('database gone for a moment');
      return finish(id, status, at);
    };
    await t.svc.runSweep();
    expect(t.notify).toHaveBeenCalledTimes(2);
    broken = false;
    t.setNow(new Date(START.getTime() - 14 * MIN));
    await t.svc.runSweep();
    expect(t.notify).toHaveBeenCalledTimes(2);
    expect(t.logger.error).toHaveBeenCalledWith('meeting reminder sent but not recorded', expect.objectContaining({ meetingId: 'm1' }));
  });

  it('two reminder times due at once (a meeting made late): only the nearer one goes; the other is written down as skipped', async () => {
    const t = setup({ settings: { enabled: true, times: [{ minutes: 20, email: true }, { minutes: 15, email: false }] }, now: new Date(START.getTime() - 14 * MIN) });
    await t.svc.runSweep();
    expect(t.notify.mock.calls.map((c) => [c[0].userId, c[0].title])).toEqual([
      ['org', 'Meeting in 14 minutes: Core switch go-live review'],
      ['ann', 'Meeting in 14 minutes: Core switch go-live review'],
    ]);
    // The 20-minute one is ticked for email (the 15-minute one isn't): the email still goes, once.
    expect(t.sendMeetingReminder.mock.calls.map((c) => c[0])).toEqual(['org@oxy.test', 'ann@oxy.test', 'guest@client.test']);
    const skipped = [...t.store.rows.values()].filter((r) => r.status === 'SKIPPED').map((r) => `${r.key.recipientKey}/${r.key.offsetMinutes}/${r.key.channel}`);
    expect(skipped.sort()).toEqual(['user:ann/20/APP', 'user:org/20/APP']);
    t.setNow(new Date(START.getTime() - 13 * MIN));
    await t.svc.runSweep();
    expect(t.notify).toHaveBeenCalledTimes(2);
    expect(t.sendMeetingReminder).toHaveBeenCalledTimes(3);
  });

  it('an address the mail provider refuses outright is not tried again (it is written down as failed)', async () => {
    const t = setup({ now: new Date(START.getTime() - 24 * 60 * MIN), email: async (to) => { if (to === 'guest@client.test') throw new EmailDeliveryError(to, 400, 'bad address'); } });
    const r = await t.svc.runSweep();
    expect(r.failed).toBe(1);
    t.setNow(new Date(START.getTime() - 24 * 60 * MIN + MIN));
    await t.svc.runSweep();
    expect(t.sendMeetingReminder.mock.calls.filter((c) => c[0] === 'guest@client.test')).toHaveLength(1);
    expect([...t.store.rows.values()].find((x) => x.key.recipientKey === 'guest:guest@client.test')!.status).toBe('FAILED');
    // A busy provider (429) is tried again.
    const u = setup({ now: new Date(START.getTime() - 24 * 60 * MIN), email: async (to) => { if (to === 'guest@client.test') throw new EmailDeliveryError(to, 429, 'slow down'); } });
    await u.svc.runSweep();
    u.setNow(new Date(START.getTime() - 24 * 60 * MIN + MIN));
    await u.svc.runSweep();
    expect(u.sendMeetingReminder.mock.calls.filter((c) => c[0] === 'guest@client.test')).toHaveLength(2);
  });

  it('a sweep still running when the next one starts on the same server: the next one waits its turn', async () => {
    const t = setup();
    await Promise.all([t.svc.runSweep(), t.svc.runSweep()]);
    expect(t.dueMeetings).toHaveBeenCalledTimes(1);
    await t.svc.runSweep();
    expect(t.dueMeetings).toHaveBeenCalledTimes(2);
  });
});

describe('meeting reminder emails carry the meeting’s company brand (companies)', () => {
  it('each email of the meeting gets it (read once); without one they go as before', async () => {
    const asked: string[] = [];
    const brand = { brand: { companyName: 'Alpha LLC' }, fromName: 'Alpha Team' };
    const t = setup({ now: new Date(START.getTime() - 24 * 60 * MIN), emailOptions: (async (id: string) => { asked.push(id); return brand; }) as never });
    await t.svc.runSweep();
    expect(t.sendMeetingReminder.mock.calls.length).toBeGreaterThan(1);
    for (const call of t.sendMeetingReminder.mock.calls) expect((call as unknown[])[2]).toEqual(brand);
    expect(asked).toEqual(['m1']);
    const plain = setup({ now: new Date(START.getTime() - 24 * 60 * MIN) });
    await plain.svc.runSweep();
    expect(plain.sendMeetingReminder.mock.calls.every((c) => c.length === 2)).toBe(true);
  });
});

describe('an outside guest invited too late for the email reminder (owner, 3 Nov 2026)', () => {
  const guestEmails = (t: ReturnType<typeof setup>) => t.sendMeetingReminder.mock.calls.filter((c) => c[0] === 'guest@client.test');

  it('booked 5 hours ahead: the 15-minute reminder reaches the guest by email — once; colleagues get no email', async () => {
    const t = setup();
    await t.svc.runSweep();
    expect(t.sendMeetingReminder.mock.calls.map((c) => c[0])).toEqual(['guest@client.test']);
    expect(guestEmails(t)[0]![1]).toMatchObject({ title: 'Core switch go-live review', link: 'https://task.mico360.com/meetings/m1' });
    expect(t.notify.mock.calls.map((c) => c[0].userId)).toEqual(['org', 'ann']);
    t.setNow(new Date(START.getTime() - 14 * MIN));
    await t.svc.runSweep();
    expect(guestEmails(t)).toHaveLength(1);
  });

  it('booked 13 hours ahead: the 12-hour reminder goes to the guest by email, the 15-minute one does not', async () => {
    const t = setup({ now: new Date(START.getTime() - 12 * 60 * MIN) });
    await t.svc.runSweep();
    expect(guestEmails(t)).toHaveLength(1);
    t.setNow(new Date(START.getTime() - 15 * MIN));
    await t.svc.runSweep();
    expect(guestEmails(t)).toHaveLength(1);
    expect(t.notify).toHaveBeenCalledTimes(4); // the colleagues' bells at 12 h and 15 min, as before
  });

  it('a guest who got the 24-hour email gets no other email', async () => {
    const t = setup({ now: new Date(START.getTime() - 24 * 60 * MIN) });
    await t.svc.runSweep();
    t.setNow(new Date(START.getTime() - 12 * 60 * MIN));
    await t.svc.runSweep();
    t.setNow(new Date(START.getTime() - 15 * MIN));
    await t.svc.runSweep();
    expect(guestEmails(t)).toHaveLength(1);
  });

  it('when no reminder time is ticked "also by email", guests get none (the administrator’s choice)', async () => {
    const t = setup({ settings: { enabled: true, times: [{ minutes: 12 * 60, email: false }, { minutes: 15, email: false }] } });
    await t.svc.runSweep();
    expect(t.sendMeetingReminder).not.toHaveBeenCalled();
  });

  it('moved to later in the day after the 24-hour email: the guest gets the next reminder for the new time', async () => {
    const t = setup();
    await guestEmailedTheDayBefore(t.store);
    const later = new Date(START.getTime() + 3 * 60 * MIN);
    t.setMeetings([meeting({ startAt: later, endAt: new Date(later.getTime() + 60 * MIN) })]);
    t.setNow(new Date(later.getTime() - 15 * MIN));
    await t.svc.runSweep();
    expect(guestEmails(t)).toHaveLength(1);
  });
});
