import { describe, it, expect } from 'vitest';
import { dueWindows, dueTimesFor, guestCatchUp, reminderRecipients, reminderSends, REMINDER_GRACE_MS, type ReminderPerson } from './meeting-reminders';
import type { AttendeeRecord } from './attendee-repository';

const NOW = new Date('2026-10-31T04:45:00Z');
const MIN = 60_000;
const TIMES = [
  { minutes: 1440, email: true },
  { minutes: 720, email: false },
  { minutes: 15, email: false },
];

describe('dueWindows / dueTimesFor: which reminders are due now', () => {
  it('a reminder is due from start − its time, for 10 minutes, and never once the meeting has started', () => {
    expect(REMINDER_GRACE_MS).toBe(10 * MIN);
    const w = dueWindows(TIMES, NOW);
    const fifteen = w.find((x) => x.minutes === 15)!;
    // Meetings starting in (now + 5 min, now + 15 min] get their 15-minute reminder now.
    expect(fifteen.from.toISOString()).toBe(new Date(NOW.getTime() + 5 * MIN).toISOString());
    expect(fifteen.to.toISOString()).toBe(new Date(NOW.getTime() + 15 * MIN).toISOString());
    const at = (mins: number) => new Date(NOW.getTime() + mins * MIN);
    expect(dueTimesFor(at(15), w).map((t) => t.minutes)).toEqual([15]); // due this very minute
    expect(dueTimesFor(at(6), w).map((t) => t.minutes)).toEqual([15]); // 9 minutes late: still sent
    expect(dueTimesFor(at(5), w)).toEqual([]); // 10 minutes late: too late
    expect(dueTimesFor(at(16), w)).toEqual([]); // not yet
    expect(dueTimesFor(at(24 * 60), w).map((t) => t.minutes)).toEqual([1440]);
    expect(dueTimesFor(at(12 * 60 - 3), w).map((t) => t.minutes)).toEqual([720]);
  });

  it('a short time never reaches back past the start (a 5-minute reminder is only sent before the meeting)', () => {
    const w = dueWindows([{ minutes: 5, email: false }], NOW);
    expect(w[0]!.from.toISOString()).toBe(NOW.toISOString());
    expect(dueTimesFor(NOW, w)).toEqual([]); // starting right now: nothing
    expect(dueTimesFor(new Date(NOW.getTime() + 1000), w).map((t) => t.minutes)).toEqual([5]);
  });

  it('keeps each time’s email tick', () => {
    expect(dueWindows(TIMES, NOW).map((x) => [x.minutes, x.email])).toEqual([[1440, true], [720, false], [15, false]]);
  });
});

const attendee = (over: Partial<AttendeeRecord>): AttendeeRecord => ({
  id: `a-${Math.random()}`, meetingId: 'm1', userId: null, externalName: null, externalEmail: null, role: 'REQUIRED', attendance: 'INVITED',
  response: 'PENDING', respondedAt: null, invitedAt: null, department: null, createdAt: NOW, ...over,
});
const person = (id: string, over: Partial<ReminderPerson> = {}): ReminderPerson => ({ userId: id, name: id.toUpperCase(), email: `${id}@acme.test`, timeZone: null, muted: false, ...over });

describe('reminderRecipients: who is reminded', () => {
  const people = new Map<string, ReminderPerson>([
    ['org', person('org')],
    ['ann', person('ann')],
    ['bob', person('bob')],
    ['cat', person('cat')],
    ['dan', person('dan')],
  ]);

  it('the organizer and every invited colleague who hasn’t declined (accepted, maybe, no answer); each once', () => {
    const list = reminderRecipients({ organizerId: 'org' }, [
      attendee({ userId: 'ann', response: 'ACCEPTED' }),
      attendee({ userId: 'bob', response: 'TENTATIVE' }),
      attendee({ userId: 'cat', response: 'PENDING' }),
      attendee({ userId: 'dan', response: 'DECLINED' }),
      attendee({ userId: 'ann', response: 'ACCEPTED' }),
      attendee({ userId: 'org', response: 'ACCEPTED' }),
    ], people);
    expect(list.map((r) => r.key)).toEqual(['user:org', 'user:ann', 'user:bob', 'user:cat']);
  });

  it('outside guests by their email address (lower-cased, once), unless they declined or are a colleague already', () => {
    const list = reminderRecipients({ organizerId: 'org' }, [
      attendee({ externalName: 'Guest One', externalEmail: 'Guest@Client.test' }),
      attendee({ externalName: 'Guest again', externalEmail: 'guest@client.test' }),
      attendee({ externalName: 'No thanks', externalEmail: 'no@client.test', response: 'DECLINED' }),
      attendee({ externalName: 'Ann twice', externalEmail: 'ANN@acme.test' }),
      attendee({ externalName: 'No address' }),
      attendee({ userId: 'ann' }),
    ], people);
    expect(list.map((r) => r.key)).toEqual(['user:org', 'user:ann', 'guest:guest@client.test']);
    expect(list[2]).toMatchObject({ kind: 'guest', name: 'Guest One', email: 'Guest@Client.test' });
  });

  it('only people who can still use the app: unknown or deactivated colleagues are left out', () => {
    const list = reminderRecipients({ organizerId: 'gone' }, [attendee({ userId: 'ann' }), attendee({ userId: 'nobody' })], people);
    expect(list.map((r) => r.key)).toEqual(['user:ann']);
  });
});

describe('reminderSends: what goes to each person for one reminder time', () => {
  const recipients = reminderRecipients({ organizerId: 'org' }, [
    attendee({ userId: 'ann' }),
    attendee({ userId: 'mut' }),
    attendee({ userId: 'noe' }),
    attendee({ externalName: 'G', externalEmail: 'g@client.test' }),
  ], new Map([
    ['org', person('org')],
    ['ann', person('ann')],
    ['mut', person('mut', { muted: true })],
    ['noe', person('noe', { email: null })],
  ]));

  it('a colleague: the bell and the phone, and the email when the time is ticked for it', () => {
    expect(reminderSends(recipients, { minutes: 15, email: false }).map((s) => `${s.recipient.key}/${s.channel}`)).toEqual(['user:org/APP', 'user:ann/APP', 'user:noe/APP']);
    expect(reminderSends(recipients, { minutes: 1440, email: true }).map((s) => `${s.recipient.key}/${s.channel}`)).toEqual([
      'user:org/APP', 'user:org/EMAIL', 'user:ann/APP', 'user:ann/EMAIL', 'user:noe/APP', 'guest:g@client.test/EMAIL',
    ]);
  });

  it('someone who switched "Meeting reminders" off gets nothing; a guest only the email-ticked times', () => {
    const keys = (minutes: number, email: boolean) => reminderSends(recipients, { minutes, email }).map((s) => s.recipient.key);
    expect(keys(1440, true)).not.toContain('user:mut');
    expect(keys(15, false)).not.toContain('guest:g@client.test');
  });

  it('a guest who missed their email reminder gets this time by email instead; colleagues are unchanged', () => {
    const sends = reminderSends(recipients, { minutes: 15, email: false }, (key) => key === 'guest:g@client.test');
    expect(sends.map((s) => `${s.recipient.key}/${s.channel}`)).toEqual(['user:org/APP', 'user:ann/APP', 'user:noe/APP', 'guest:g@client.test/EMAIL']);
  });
});

describe('guestCatchUp: a guest invited too late for the email reminder gets the next one by email (owner, 3 Nov 2026)', () => {
  const times = [{ minutes: 1440, email: true }, { minutes: 720, email: false }, { minutes: 15, email: false }];
  const t = (minutes: number, email = false) => ({ minutes, email });

  it('a later time stands in for a missed email-ticked one, until an email went to them for this start', () => {
    expect(guestCatchUp(t(720), times, [t(720)], false)).toBe(true);
    expect(guestCatchUp(t(15), times, [t(15)], false)).toBe(true);
    expect(guestCatchUp(t(15), times, [t(15)], true)).toBe(false);
  });

  it('not for a time that is ticked itself, nor when no earlier time is ticked for email, nor when that one is due now too', () => {
    expect(guestCatchUp(t(1440, true), times, [t(1440, true)], false)).toBe(false);
    expect(guestCatchUp(t(720), [t(720), t(15, true)], [t(720)], false)).toBe(false);
    expect(guestCatchUp(t(15), [t(15)], [t(15)], false)).toBe(false);
    // Both due in the same sweep (a meeting made late): the ticked one goes by email as today.
    expect(guestCatchUp(t(15), [t(20, true), t(15)], [t(20, true), t(15)], false)).toBe(false);
  });
});
