import type { MeetingReminderTime } from '../settings/settings-service';
import type { AttendeeRecord } from './attendee-repository';

/**
 * Automatic meeting reminders, the pure part: which reminders are due now, who gets them and by
 * which way. A reminder is due at start − its time and is sent within the next 10 minutes (a
 * sweep runs every minute), never once the meeting has started — so a meeting made late skips the
 * reminders already past, and one moved gets its reminders at the new time.
 */

/** How long after its moment a reminder may still go out (a busy or restarted server catches up). */
export const REMINDER_GRACE_MS = 10 * 60_000;

/** A reminder time with the meetings it is due for now: those starting in (from, to]. */
export interface DueWindow extends MeetingReminderTime {
  from: Date;
  to: Date;
}

/** For each reminder time, the starts it is due for at `now`: (now + time − grace, now + time], never before now. */
export function dueWindows(times: readonly MeetingReminderTime[], now: Date, graceMs: number = REMINDER_GRACE_MS): DueWindow[] {
  return times.map((t) => {
    const to = now.getTime() + t.minutes * 60_000;
    return { ...t, from: new Date(Math.max(now.getTime(), to - graceMs)), to: new Date(to) };
  });
}

/** The reminder times due now for a meeting starting at `startAt`. */
export function dueTimesFor(startAt: Date, windows: readonly DueWindow[]): MeetingReminderTime[] {
  const at = startAt.getTime();
  return windows.filter((w) => at > w.from.getTime() && at <= w.to.getTime()).map(({ minutes, email }) => ({ minutes, email }));
}

/** A colleague as the reminders need them (only active people are looked up). */
export interface ReminderPerson {
  userId: string;
  name: string;
  email: string | null;
  /** Their own time zone; null = the company's. */
  timeZone: string | null;
  /** They switched "Meeting reminders" off (Settings → Notifications). */
  muted: boolean;
}

export type ReminderRecipient =
  | ({ kind: 'user'; key: string } & ReminderPerson)
  | { kind: 'guest'; key: string; name: string; email: string };

/**
 * Who is reminded of a meeting: its organizer and every invited colleague who hasn't declined
 * (accepted, maybe or no answer yet), then its outside guests who haven't declined — each once (a
 * guest whose address is a colleague's is that colleague). `people` holds the active colleagues
 * only, so anyone deactivated or unknown is left out. Organizer and attendees can always see the
 * meeting, so nobody is reminded of one they can't open.
 */
export function reminderRecipients(
  meeting: { organizerId: string },
  attendees: readonly AttendeeRecord[],
  people: ReadonlyMap<string, ReminderPerson>,
): ReminderRecipient[] {
  const users: ReminderRecipient[] = [];
  const seenUsers = new Set<string>();
  const addUser = (userId: string) => {
    const p = people.get(userId);
    if (!p || seenUsers.has(userId)) return;
    seenUsers.add(userId);
    users.push({ kind: 'user', key: `user:${userId}`, ...p });
  };
  addUser(meeting.organizerId);
  for (const a of attendees) if (a.userId && a.response !== 'DECLINED') addUser(a.userId);

  const colleagueEmails = new Set(users.map((u) => u.email?.trim().toLowerCase()).filter((e): e is string => !!e));
  const guests: ReminderRecipient[] = [];
  const seenGuests = new Set<string>();
  for (const a of attendees) {
    const email = a.externalEmail?.trim();
    if (a.userId || !email || a.response === 'DECLINED') continue;
    const key = email.toLowerCase();
    if (seenGuests.has(key) || colleagueEmails.has(key)) continue;
    seenGuests.add(key);
    guests.push({ kind: 'guest', key: `guest:${key}`, name: a.externalName?.trim() || email, email });
  }
  return [...users, ...guests];
}

/** The two ways a reminder goes: the bell with the phone push, and email. */
export type ReminderChannel = 'APP' | 'EMAIL';

export interface ReminderSend {
  recipient: ReminderRecipient;
  channel: ReminderChannel;
}

/**
 * What one reminder time sends to each person: a colleague gets the bell and the phone push, and
 * the email too when the time is ticked "also by email"; someone who switched meeting reminders off
 * gets nothing; an outside guest gets only the email-ticked times, by email.
 */
export function reminderSends(recipients: readonly ReminderRecipient[], time: MeetingReminderTime): ReminderSend[] {
  const sends: ReminderSend[] = [];
  for (const r of recipients) {
    if (r.kind === 'user') {
      if (r.muted) continue;
      sends.push({ recipient: r, channel: 'APP' });
      if (time.email && r.email) sends.push({ recipient: r, channel: 'EMAIL' });
    } else if (time.email) {
      sends.push({ recipient: r, channel: 'EMAIL' });
    }
  }
  return sends;
}
