import type { Logger } from '../../lib/logger';
import { EmailNotConfiguredError } from '../email/delivery-error';
import type { MeetingEmailParams } from '../email/email-templates';
import { MEETING_PUSH_CHANNEL } from '../device-tokens/fcm-transport';
import type { CreateNotificationData, NotificationRecord } from '../notifications/notification-repository';
import type { NotifyOptions } from '../notifications/notification-service';
import type { MeetingReminderSettings } from '../settings/settings-service';
import type { AttendeeRecord } from './attendee-repository';
import type { MeetingRecord } from './meeting-repository';
import { isValidTimeZone } from './meeting-validation';
import { reminderWording } from './meeting-reminder-text';
import { dueTimesFor, dueWindows, reminderRecipients, reminderSends, REMINDER_GRACE_MS, type ReminderChannel, type ReminderPerson } from './meeting-reminders';

/** The notification type of a meeting reminder (Settings → Notifications → "Meeting reminders"). */
export const MEETING_REMINDER_TYPE = 'MEETING_REMINDER';

/** A meeting whose reminder may be due, with its attendees and its project's name. */
export interface DueMeeting
  extends Pick<MeetingRecord, 'id' | 'title' | 'description' | 'status' | 'projectId' | 'organizerId' | 'location' | 'onlineLink' | 'startAt' | 'endAt' | 'timeZone'> {
  projectName: string | null;
  attendees: AttendeeRecord[];
}

export interface MeetingReminderSource {
  /** Scheduled meetings (not deleted, not drafts or cancelled) starting in any window: (from, to]. */
  dueMeetings(windows: Array<{ from: Date; to: Date }>): Promise<DueMeeting[]>;
  /** The active colleagues among these ids, with their email, own time zone and meeting-reminder switch. */
  people(userIds: string[]): Promise<Map<string, ReminderPerson>>;
}

/** One send of one reminder: a meeting (or one meeting of a series), a person, a reminder time, the start it was for, a way. */
export interface ReminderSendKey {
  meetingId: string;
  /** 'user:<id>' or 'guest:<lower-cased email>'. */
  recipientKey: string;
  offsetMinutes: number;
  startAt: Date;
  channel: ReminderChannel;
}

export type ReminderSendStatus = 'SENT' | 'SKIPPED';

/**
 * Where each send is written down, under a UNIQUE (meeting, person, time, start, way): taken once,
 * so retries, overlapping sweeps and several servers can never send the same reminder twice.
 */
export interface MeetingReminderStore {
  /** The keys (see reminderKey) already taken for these meetings: sent, being sent or skipped. */
  takenFor(meetingIds: string[]): Promise<Set<string>>;
  /** Take one send: the row's id, or null when it was taken already (by another sweep or server). */
  reserve(key: ReminderSendKey & { userId: string | null; email: string | null }): Promise<string | null>;
  /** It went (SENT), or there was nothing to send (SKIPPED: switched off meanwhile, email not set up). */
  finish(id: string, status: ReminderSendStatus, at: Date): Promise<void>;
  /** It failed before anything was sent: give it back, so a later sweep tries again while it is still due. */
  release(id: string): Promise<void>;
  /** Forget the sends for meetings that started before `before`; returns how many. */
  prune(before: Date): Promise<number>;
}

/** A send's key as one string (the store's unique key, in the same parts). */
export function reminderKey(k: ReminderSendKey): string {
  return `${k.meetingId}|${k.recipientKey}|${k.offsetMinutes}|${k.startAt.toISOString()}|${k.channel}`;
}

export interface MeetingReminderServiceDeps {
  /** System Settings → Meeting reminders, read at every sweep. */
  settings: () => Promise<MeetingReminderSettings>;
  source: MeetingReminderSource;
  store: MeetingReminderStore;
  /** The notification service's notify: the bell, the phone push, and the website's live pop-up. */
  notify: (input: CreateNotificationData, opts?: NotifyOptions) => Promise<NotificationRecord | null>;
  email: { sendMeetingReminder(email: string, params: MeetingEmailParams & { startsInLabel: string }): Promise<void> };
  /** The website's address, for the email's "Open" link. */
  appUrl: string;
  /** The company's time zone: for meetings stored without one and people who chose none. */
  defaultTimeZone: string;
  logger?: Pick<Logger, 'error' | 'warn'>;
  now?: () => Date;
  graceMs?: number;
}

export interface ReminderSweepResult {
  /** Meetings with a reminder due. */
  meetings: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** The sends of meetings that started this long ago are forgotten (they can never be due again). */
const KEEP_SENDS_MS = 30 * 24 * 60 * 60_000;
const PRUNE_EVERY_MS = 60 * 60_000;

/**
 * Automatic meeting reminders (owner, 31 Oct 2026). A sweep every minute finds the reminders due —
 * at start − each System Settings time, sent within the next 10 minutes, never once the meeting
 * has started — and sends each person their bell notification (with the phone push, on its own
 * Android channel) and, for times ticked "also by email", the email. Each send is taken in the
 * store first (reserve-then-send), so it goes once; one that fails before anything was sent is
 * given back and tried again by the next sweep while it is still due.
 *
 * Changes follow on their own: a moved meeting's sends carry its new start, so its reminders come
 * at the new time; cancelled, deleted and draft meetings are never due; someone who declined or was
 * taken off is no longer among its people; each meeting of a repeating series is a meeting of its own.
 */
export function createMeetingReminderService(deps: MeetingReminderServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const graceMs = deps.graceMs ?? REMINDER_GRACE_MS;
  const companyZone = isValidTimeZone(deps.defaultTimeZone) ? deps.defaultTimeZone : 'UTC';
  const zoneOr = (zone: string | null | undefined, fallback: string) => (zone && isValidTimeZone(zone) ? zone : fallback);
  let lastPrune = 0;

  async function runSweep(): Promise<ReminderSweepResult> {
    const result: ReminderSweepResult = { meetings: 0, sent: 0, skipped: 0, failed: 0 };
    const settings = await deps.settings();
    if (!settings.enabled || settings.times.length === 0) return result;
    const at = now();
    await pruneNow(at);

    const windows = dueWindows(settings.times, at, graceMs);
    const due = (await deps.source.dueMeetings(windows)).filter((m) => m.status === 'SCHEDULED' && m.startAt.getTime() > at.getTime());
    if (due.length === 0) return result;
    const taken = await deps.store.takenFor(due.map((m) => m.id));
    const userIds = new Set<string>();
    for (const m of due) {
      userIds.add(m.organizerId);
      for (const a of m.attendees ?? []) if (a.userId) userIds.add(a.userId);
    }
    const people = await deps.source.people([...userIds]);

    for (const m of due) {
      const times = dueTimesFor(m.startAt, windows);
      if (times.length === 0) continue;
      result.meetings++;
      // One broken meeting (bad data, a database hiccup) must not stop the others' reminders.
      try {
        await remindOf(m, times, people, taken, at, result);
      } catch (err) {
        deps.logger?.error('meeting reminders failed', { err, meetingId: m.id });
      }
    }
    return result;
  }

  async function remindOf(
    m: DueMeeting,
    times: Array<{ minutes: number; email: boolean }>,
    people: Map<string, ReminderPerson>,
    taken: Set<string>,
    at: Date,
    result: ReminderSweepResult,
  ): Promise<void> {
    const meetingZone = zoneOr(m.timeZone, companyZone);
    const recipients = reminderRecipients(m, m.attendees, people);
    const organizerName = people.get(m.organizerId)?.name ?? null;
    // Out of date once the meeting has started: a phone that was off doesn't show it afterwards.
    const ttlSeconds = Math.max(60, Math.ceil((m.startAt.getTime() - at.getTime()) / 1000));

    for (const time of times) {
      for (const send of reminderSends(recipients, time)) {
        const { recipient, channel } = send;
        const key: ReminderSendKey = { meetingId: m.id, recipientKey: recipient.key, offsetMinutes: time.minutes, startAt: m.startAt, channel };
        if (taken.has(reminderKey(key))) continue;
        const id = await deps.store.reserve({ ...key, userId: recipient.kind === 'user' ? recipient.userId : null, email: channel === 'EMAIL' ? recipient.email : null });
        if (!id) continue; // another sweep or server has it
        taken.add(reminderKey(key));

        const personZone = recipient.kind === 'user' ? zoneOr(recipient.timeZone, companyZone) : null;
        const words = reminderWording({ meeting: m, meetingZone, personZone, offsetMinutes: time.minutes, now: at });
        let outcome: ReminderSendStatus;
        try {
          if (channel === 'APP' && recipient.kind === 'user') {
            const stored = await deps.notify(
              { userId: recipient.userId, type: MEETING_REMINDER_TYPE, title: words.title, body: words.body, entityType: 'meeting', entityId: m.id },
              { push: { channelId: MEETING_PUSH_CHANNEL, ttlSeconds, tag: `meeting-${m.id}` } },
            );
            // Null: they switched meeting reminders off a moment ago.
            outcome = stored ? 'SENT' : 'SKIPPED';
          } else if (recipient.email) {
            await deps.email.sendMeetingReminder(recipient.email, {
              title: m.title,
              whenLabel: words.when,
              startsInLabel: words.startsIn,
              location: m.location,
              onlineLink: m.onlineLink,
              organizerName,
              projectName: m.projectName,
              description: m.description,
              link: `${deps.appUrl.replace(/\/+$/, '')}/meetings/${m.id}`,
            });
            outcome = 'SENT';
          } else {
            outcome = 'SKIPPED';
          }
        } catch (err) {
          if (err instanceof EmailNotConfiguredError) {
            // Email is off on this server: nothing to try again (the bell and the push still went).
            outcome = 'SKIPPED';
          } else {
            result.failed++;
            deps.logger?.error('meeting reminder failed', { err, meetingId: m.id, channel, offsetMinutes: time.minutes });
            // Nothing went out: the next sweep tries again while the reminder is still due.
            await deps.store.release(id).catch((e) => deps.logger?.error('meeting reminder could not be given back', { err: e, meetingId: m.id }));
            taken.delete(reminderKey(key));
            continue;
          }
        }
        if (outcome === 'SENT') result.sent++;
        else result.skipped++;
        // It went: whatever happens now, the row stays taken, so it is never sent twice.
        await deps.store.finish(id, outcome, now()).catch((err) => deps.logger?.error('meeting reminder sent but not recorded', { err, meetingId: m.id, channel }));
      }
    }
  }

  /** Keep the sends table small: at most once an hour, forget those of meetings long past. */
  async function pruneNow(at: Date): Promise<void> {
    if (at.getTime() - lastPrune < PRUNE_EVERY_MS) return;
    lastPrune = at.getTime();
    await deps.store.prune(new Date(at.getTime() - KEEP_SENDS_MS)).catch((err) => deps.logger?.warn('meeting reminder log could not be pruned', { err }));
  }

  return { runSweep };
}

export type MeetingReminderService = ReturnType<typeof createMeetingReminderService>;
