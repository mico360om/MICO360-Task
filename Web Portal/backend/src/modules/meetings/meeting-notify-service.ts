import { ConflictError, HttpError, NotFoundError } from '../../lib/http-errors';
import { buildIcs, type IcsMethod, type IcsPerson } from '../../lib/ics';
import type { Logger } from '../../lib/logger';
import { EmailNotConfiguredError } from '../email/delivery-error';
import type { EmailAttachment } from '../email/mailer';
import type { MeetingEmailParams } from '../email/email-templates';
import type { MeetingRecord, MeetingRepository, RecurrenceRule } from './meeting-repository';
import type { AttendeeRecord } from './attendee-repository';
import { isValidTimeZone } from './meeting-validation';

export interface NotifyPerson {
  name: string;
  email: string;
}

/** The email surface this service needs (a subset of EmailService). Sends throw when delivery fails. */
export interface MeetingMailer {
  sendMeetingInvite(email: string, params: MeetingEmailParams, ics: EmailAttachment): Promise<void>;
  sendMeetingReminder(email: string, params: MeetingEmailParams & { startsInLabel: string }): Promise<void>;
  sendMeetingCancelled(email: string, params: MeetingEmailParams, ics: EmailAttachment): Promise<void>;
  sendMeetingMinutes(email: string, params: MeetingEmailParams, pdf: EmailAttachment): Promise<void>;
}

export interface MeetingNotifyDeps {
  meetings: Pick<MeetingRepository, 'findById' | 'markInvitesSent' | 'markReminderSent' | 'listUpcomingWithoutReminder'>;
  attendees: { listByMeeting(meetingId: string): Promise<AttendeeRecord[]> };
  email: MeetingMailer;
  /** Resolve an internal user id to a name + email (null if unknown / no email). */
  resolveUser: (userId: string) => Promise<NotifyPerson | null>;
  /** Resolve a project id to its name (for the "Project" row). */
  resolveProjectName?: (projectId: string) => Promise<string | null>;
  /** Web app base URL for the "Open in app" link. */
  appUrl: string;
  /** Company time zone — used to show times for meetings stored without one. */
  defaultTimeZone?: string;
  /** Where per-recipient failures and sweep errors are reported. */
  logger?: Pick<Logger, 'error' | 'warn'>;
  now?: () => Date;
}

/** Per-recipient outcome of a send: how many emails were delivered and how many failed. */
export interface DeliveryReport {
  sent: number;
  failed: number;
}

export interface MeetingNotifyService {
  sendInvites(meetingId: string): Promise<DeliveryReport>;
  /** Cancel the event in invitees' calendars. Pass the record when the meeting is already deleted. */
  sendCancellation(meetingId: string, opts?: { meeting?: MeetingRecord }): Promise<DeliveryReport>;
  /** Remove the event from one attendee's calendar after they were taken off an invited meeting. */
  sendAttendeeRemoved(meetingId: string, attendee: AttendeeRecord): Promise<DeliveryReport>;
  sendMinutes(meetingId: string, pdf: Buffer): Promise<DeliveryReport>;
  runReminderSweep(leadMs: number): Promise<{ meetings: number; sent: number; failed: number }>;
}

function slugify(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
}

/** SEQUENCE that increases as a meeting is edited (calendar clients require monotonic sequences). */
function sequenceOf(m: MeetingRecord): number {
  return Math.max(0, Math.round((m.updatedAt.getTime() - m.createdAt.getTime()) / 1000));
}

function startsInLabel(m: MeetingRecord, now: Date): string {
  const mins = Math.round((m.startAt.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return 'is starting now';
  if (mins < 60) return `starts in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  return `starts in about ${hours} hour${hours === 1 ? '' : 's'}`;
}

export function createMeetingNotifyService(deps: MeetingNotifyDeps): MeetingNotifyService {
  const { meetings, attendees, email } = deps;
  const now = deps.now ?? (() => new Date());
  const fallbackZone = deps.defaultTimeZone && isValidTimeZone(deps.defaultTimeZone) ? deps.defaultTimeZone : 'UTC';

  /** The meeting's own zone when valid, else the company zone — never a zone that makes formatting throw. */
  const zoneOf = (m: MeetingRecord): string => (m.timeZone && isValidTimeZone(m.timeZone) ? m.timeZone : fallbackZone);

  function formatWhen(m: MeetingRecord): string {
    const tz = zoneOf(m);
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }).format(m.startAt);
    const t = (d: Date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
    const zone = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: tz, timeZoneName: 'short' }).formatToParts(m.startAt).find((p) => p.type === 'timeZoneName')?.value ?? tz;
    const time = m.endAt ? `${t(m.startAt)} – ${t(m.endAt)}` : t(m.startAt);
    return `${day}, ${time} (${zone})`;
  }

  async function requireMeeting(id: string): Promise<MeetingRecord> {
    const m = await meetings.findById(id);
    if (!m) throw new NotFoundError('Meeting not found.');
    return m;
  }

  async function personFor(a: AttendeeRecord): Promise<NotifyPerson | null> {
    if (a.userId) return deps.resolveUser(a.userId);
    if (a.externalEmail) return { name: a.externalName ?? a.externalEmail, email: a.externalEmail };
    return null;
  }

  /** Organizer + attendees, resolved to {name,email}, deduped by lowercased email. */
  async function recipientsFor(m: MeetingRecord): Promise<{ people: NotifyPerson[]; icsAttendees: IcsPerson[]; organizer: NotifyPerson | null }> {
    const byEmail = new Map<string, NotifyPerson>();
    const icsAttendees: IcsPerson[] = [];
    const organizer = await deps.resolveUser(m.organizerId);
    if (organizer?.email) byEmail.set(organizer.email.toLowerCase(), organizer);

    for (const a of await attendees.listByMeeting(m.id)) {
      const person = await personFor(a);
      if (!person?.email) continue;
      byEmail.set(person.email.toLowerCase(), person);
      icsAttendees.push({ name: person.name, email: person.email, role: a.role });
    }
    return { people: [...byEmail.values()], icsAttendees, organizer };
  }

  async function emailParams(m: MeetingRecord, organizer: NotifyPerson | null): Promise<MeetingEmailParams> {
    const projectName = m.projectId && deps.resolveProjectName ? await deps.resolveProjectName(m.projectId) : null;
    return {
      title: m.title,
      whenLabel: formatWhen(m),
      location: m.location,
      onlineLink: m.onlineLink,
      organizerName: organizer?.name ?? null,
      projectName,
      description: m.description,
      link: `${deps.appUrl.replace(/\/$/, '')}/meetings/${m.id}`,
    };
  }

  function icsFor(m: MeetingRecord, method: IcsMethod, organizer: NotifyPerson, icsAttendees: IcsPerson[]): EmailAttachment {
    const rule = (m.recurrenceRule as RecurrenceRule | null) ?? null;
    const ics = buildIcs({
      method,
      uid: `meeting-${m.id}@mico360`,
      sequence: method === 'CANCEL' ? sequenceOf(m) + 1 : sequenceOf(m),
      start: m.startAt,
      end: m.endAt,
      timeZone: zoneOf(m),
      summary: m.title,
      description: m.description,
      location: m.location,
      url: `${deps.appUrl.replace(/\/$/, '')}/meetings/${m.id}`,
      organizer,
      attendees: icsAttendees,
      // A paused series is announced as a single occurrence.
      recurrence: rule && !rule.paused ? rule : null,
      stamp: now(),
    });
    return {
      filename: `${slugify(m.title)}.ics`,
      contentType: `text/calendar; method=${method}; charset=utf-8`,
      content: Buffer.from(ics, 'utf8'),
    };
  }

  const organizerOf = (m: MeetingRecord, organizer: NotifyPerson | null): NotifyPerson =>
    organizer ?? { name: m.organizerId, email: `${m.organizerId}@invalid.local` };

  /** Send to each recipient on its own, so one bad address never stops (or hides) the rest. */
  async function deliver(
    m: MeetingRecord,
    kind: string,
    people: NotifyPerson[],
    send: (p: NotifyPerson) => Promise<void>,
  ): Promise<DeliveryReport & { notConfigured: boolean }> {
    let sent = 0;
    let failed = 0;
    let notConfigured = 0;
    for (const p of people) {
      try {
        await send(p);
        sent++;
      } catch (err) {
        failed++;
        if (err instanceof EmailNotConfiguredError) notConfigured++;
        deps.logger?.error(`meeting ${kind} email failed`, { err, meetingId: m.id });
      }
    }
    return { sent, failed, notConfigured: failed > 0 && notConfigured === failed };
  }

  /** An explicit send that reached nobody because email isn't set up is an error, not "sent to 0". */
  function assertConfigured(r: DeliveryReport & { notConfigured: boolean }): DeliveryReport {
    if (r.sent === 0 && r.notConfigured) {
      throw new HttpError('Email sending is not configured, so nothing was sent.', 'EMAIL_NOT_CONFIGURED', 503);
    }
    return { sent: r.sent, failed: r.failed };
  }

  async function cancelFor(m: MeetingRecord, only?: AttendeeRecord): Promise<DeliveryReport> {
    const all = await recipientsFor(m);
    let people = all.people;
    let icsAttendees = all.icsAttendees;
    if (only) {
      const person = await personFor(only);
      if (!person?.email) return { sent: 0, failed: 0 };
      people = [person];
      icsAttendees = [{ name: person.name, email: person.email, role: only.role }];
    }
    const params = await emailParams(m, all.organizer);
    const ics = icsFor(m, 'CANCEL', organizerOf(m, all.organizer), icsAttendees);
    const r = await deliver(m, 'cancellation', people, (p) => email.sendMeetingCancelled(p.email, params, ics));
    return { sent: r.sent, failed: r.failed };
  }

  return {
    async sendInvites(meetingId) {
      const m = await requireMeeting(meetingId);
      if (m.status === 'CANCELLED') throw new ConflictError('This meeting is cancelled — invitations cannot be sent.');
      const { people, icsAttendees, organizer } = await recipientsFor(m);
      const params = await emailParams(m, organizer);
      const ics = icsFor(m, 'REQUEST', organizerOf(m, organizer), icsAttendees);
      const r = await deliver(m, 'invitation', people, (p) => email.sendMeetingInvite(p.email, params, ics));
      // Only a delivered invitation counts as "invites sent" (it later drives cancellation notices).
      if (r.sent > 0) await meetings.markInvitesSent(m.id, now());
      return assertConfigured(r);
    },

    async sendCancellation(meetingId, opts) {
      const m = opts?.meeting ?? (await requireMeeting(meetingId));
      return cancelFor(m);
    },

    async sendAttendeeRemoved(meetingId, attendee) {
      const m = await meetings.findById(meetingId);
      // Nothing to retract if the meeting never reached calendars (or its cancellation already did).
      if (!m || !m.invitesSentAt || m.status === 'CANCELLED') return { sent: 0, failed: 0 };
      return cancelFor(m, attendee);
    },

    async sendMinutes(meetingId, pdf) {
      const m = await requireMeeting(meetingId);
      const { people, organizer } = await recipientsFor(m);
      const params = await emailParams(m, organizer);
      const attachment: EmailAttachment = { filename: `minutes-${slugify(m.title)}.pdf`, contentType: 'application/pdf', content: pdf };
      return assertConfigured(await deliver(m, 'minutes', people, (p) => email.sendMeetingMinutes(p.email, params, attachment)));
    },

    async runReminderSweep(leadMs) {
      const due = await meetings.listUpcomingWithoutReminder(now(), leadMs);
      let sent = 0;
      let failed = 0;
      for (const m of due) {
        // One bad meeting (unreachable directory, broken data) must not stop the others' reminders.
        try {
          const { people, organizer } = await recipientsFor(m);
          const base = await emailParams(m, organizer);
          const params = { ...base, startsInLabel: startsInLabel(m, now()) };
          const r = await deliver(m, 'reminder', people, (p) => email.sendMeetingReminder(p.email, params));
          sent += r.sent;
          failed += r.failed;
          // Leave the marker unset when every send failed, so the next sweep retries.
          if (r.sent > 0 || r.failed === 0) await meetings.markReminderSent(m.id, now());
        } catch (err) {
          deps.logger?.error('meeting reminder failed', { err, meetingId: m.id });
        }
      }
      return { meetings: due.length, sent, failed };
    },
  };
}
