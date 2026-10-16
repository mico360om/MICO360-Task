import { ConflictError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { buildIcs, type IcsMethod, type IcsPerson } from '../../lib/ics';
import type { Logger } from '../../lib/logger';
import { EmailNotConfiguredError } from '../email/delivery-error';
import type { EmailAttachment } from '../email/mailer';
import { meetingMinutesEmail, type MeetingEmailParams } from '../email/email-templates';
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
  attendees: {
    listByMeeting(meetingId: string): Promise<AttendeeRecord[]>;
    /** Stamp attendees whose own invitation was delivered (enables "invite only new people"). */
    markInvited?(ids: string[], at: Date): Promise<void>;
  };
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

export type RecipientKind = 'organizer' | 'member' | 'guest';

/** One email address the meeting's mail goes to (an attendee listed twice is one recipient). */
export interface Recipient {
  name: string;
  email: string;
  kind: RecipientKind;
  attendeeIds: string[];
  /** Already sent an invitation (each of their attendee rows was invited; the organizer once any went out). */
  alreadyInvited: boolean;
}

export interface RecipientResult {
  name: string;
  email: string;
  kind: RecipientKind;
  ok: boolean;
  error?: string;
}

/** An explicit send's outcome: totals, each recipient's result, and who had no address. */
export interface SendReport extends DeliveryReport {
  recipients: RecipientResult[];
  skipped: Array<{ name: string; reason: string }>;
}

export interface SendProblem {
  /** 'error' blocks the send; 'warning' is worth a look but can be sent anyway. */
  level: 'error' | 'warning';
  message: string;
}

export interface InvitePreview {
  recipients: Recipient[];
  missingEmail: Array<{ name: string; attendeeId: string }>;
  problems: SendProblem[];
  invitesSentAt: Date | null;
}

export interface MinutesPreview {
  subject: string;
  html: string;
  text: string;
  attachmentName: string;
  recipients: Recipient[];
  missingEmail: Array<{ name: string; attendeeId: string }>;
}

export interface MeetingNotifyService {
  /** Calendar invitations to everyone, or (onlyNew) just to people who haven't had one yet. */
  sendInvites(meetingId: string, opts?: { onlyNew?: boolean }): Promise<SendReport>;
  /** Who an invitation would go to and anything to fix first — sends nothing. */
  previewInvites(meetingId: string): Promise<InvitePreview>;
  /** Cancel the event in invitees' calendars. Pass the record when the meeting is already deleted. */
  sendCancellation(meetingId: string, opts?: { meeting?: MeetingRecord }): Promise<DeliveryReport>;
  /** Remove the event from one attendee's calendar after they were taken off an invited meeting. */
  sendAttendeeRemoved(meetingId: string, attendee: AttendeeRecord): Promise<DeliveryReport>;
  /** Email the minutes PDF; `only` limits it to some of the meeting's own recipients (by email). */
  /** `final`: the PDF is the approved final minutes (the attachment is named so). */
  sendMinutes(meetingId: string, pdf: Buffer, opts?: { only?: string[]; final?: boolean }): Promise<SendReport>;
  /** The minutes email exactly as it would be sent, and to whom — sends nothing. */
  previewMinutes(meetingId: string, opts?: { final?: boolean }): Promise<MinutesPreview>;
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

  /**
   * Organizer + attendees, resolved to {name,email}, deduped by lowercased email (the organizer
   * first, then the roster in order); attendees without an address are listed separately.
   */
  async function recipientsFor(m: MeetingRecord): Promise<{
    people: NotifyPerson[];
    recipients: Recipient[];
    missingEmail: Array<{ name: string; attendeeId: string }>;
    icsAttendees: IcsPerson[];
    organizer: NotifyPerson | null;
  }> {
    const byEmail = new Map<string, Recipient>();
    const invited = new Map<string, boolean[]>();
    const missingEmail: Array<{ name: string; attendeeId: string }> = [];
    const icsAttendees: IcsPerson[] = [];
    const organizer = await deps.resolveUser(m.organizerId);
    if (organizer?.email) {
      byEmail.set(organizer.email.toLowerCase(), { name: organizer.name, email: organizer.email, kind: 'organizer', attendeeIds: [], alreadyInvited: false });
    }

    for (const a of await attendees.listByMeeting(m.id)) {
      const person = await personFor(a);
      if (!person?.email) {
        missingEmail.push({ name: a.userId ? person?.name ?? 'A team member' : a.externalName ?? 'A guest', attendeeId: a.id });
        continue;
      }
      const key = person.email.toLowerCase();
      const r = byEmail.get(key) ?? { name: person.name, email: person.email, kind: a.userId ? 'member' : 'guest', attendeeIds: [], alreadyInvited: false };
      r.attendeeIds.push(a.id);
      byEmail.set(key, r);
      invited.set(key, [...(invited.get(key) ?? []), a.invitedAt != null]);
      icsAttendees.push({ name: person.name, email: person.email, role: a.role });
    }
    const recipients = [...byEmail.entries()].map(([key, r]) => {
      const rows = invited.get(key);
      return { ...r, alreadyInvited: rows ? rows.every(Boolean) : m.invitesSentAt != null };
    });
    return { people: recipients.map((r) => ({ name: r.name, email: r.email })), recipients, missingEmail, icsAttendees, organizer };
  }

  /** What to fix (error) or look at (warning) before invitations go out. */
  function inviteProblems(m: MeetingRecord, recipients: Recipient[], missingEmail: Array<{ name: string }>): SendProblem[] {
    const problems: SendProblem[] = [];
    if (m.status === 'CANCELLED') problems.push({ level: 'error', message: 'This meeting is cancelled — invitations can’t be sent.' });
    if (!recipients.some((r) => r.kind !== 'organizer')) {
      problems.push({ level: 'error', message: 'Add at least one attendee with an email address to invite.' });
    }
    const at = now().getTime();
    if ((m.endAt ?? m.startAt).getTime() < at) problems.push({ level: 'warning', message: 'This meeting has already ended.' });
    else if (m.startAt.getTime() < at) problems.push({ level: 'warning', message: 'This meeting has already started.' });
    if (!m.location && !m.onlineLink) problems.push({ level: 'warning', message: 'Add a place or a meeting link so people know where to join.' });
    if (missingEmail.length > 0) {
      const n = missingEmail.length;
      problems.push({ level: 'warning', message: `${n} attendee${n === 1 ? ' has' : 's have'} no email address and won’t get an invitation.` });
    }
    return problems;
  }

  function report(r: DeliveryReport & { results: RecipientResult[] }, missingEmail: Array<{ name: string }>): SendReport {
    return { sent: r.sent, failed: r.failed, recipients: r.results, skipped: missingEmail.map((x) => ({ name: x.name, reason: 'no email address' })) };
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
  async function deliver<P extends NotifyPerson>(
    m: MeetingRecord,
    kind: string,
    people: P[],
    send: (p: P) => Promise<void>,
  ): Promise<DeliveryReport & { notConfigured: boolean; results: Array<P & { ok: boolean; error?: string }> }> {
    let sent = 0;
    let failed = 0;
    let notConfigured = 0;
    const results: Array<P & { ok: boolean; error?: string }> = [];
    for (const p of people) {
      try {
        await send(p);
        sent++;
        results.push({ ...p, ok: true });
      } catch (err) {
        failed++;
        if (err instanceof EmailNotConfiguredError) notConfigured++;
        results.push({ ...p, ok: false, error: err instanceof EmailNotConfiguredError ? 'Email isn’t set up on this server.' : 'The mail server didn’t accept it.' });
        deps.logger?.error(`meeting ${kind} email failed`, { err, meetingId: m.id });
      }
    }
    return { sent, failed, notConfigured: failed > 0 && notConfigured === failed, results };
  }

  const resultOf = (r: Recipient & { ok: boolean; error?: string }): RecipientResult => ({
    name: r.name,
    email: r.email,
    kind: r.kind,
    ok: r.ok,
    ...(r.error ? { error: r.error } : {}),
  });

  /** An explicit send that reached nobody because email isn't set up is an error, not "sent to 0". */
  function assertConfigured<R extends DeliveryReport & { notConfigured: boolean }>(r: R): R {
    if (r.sent === 0 && r.notConfigured) {
      throw new HttpError('Email sending is not configured, so nothing was sent.', 'EMAIL_NOT_CONFIGURED', 503);
    }
    return r;
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
    async sendInvites(meetingId, opts) {
      const m = await requireMeeting(meetingId);
      if (m.status === 'CANCELLED') throw new ConflictError('This meeting is cancelled — invitations cannot be sent.');
      const { recipients, missingEmail, icsAttendees, organizer } = await recipientsFor(m);
      const targets = opts?.onlyNew ? recipients.filter((r) => !r.alreadyInvited) : recipients;
      const params = await emailParams(m, organizer);
      const ics = icsFor(m, 'REQUEST', organizerOf(m, organizer), icsAttendees);
      const r = assertConfigured(await deliver(m, 'invitation', targets, (p) => email.sendMeetingInvite(p.email, params, ics)));
      // Only a delivered invitation counts as "invites sent" (it later drives cancellation notices).
      if (r.sent > 0) {
        const at = now();
        await meetings.markInvitesSent(m.id, at);
        await attendees.markInvited?.(r.results.filter((x) => x.ok).flatMap((x) => x.attendeeIds), at);
      }
      return report({ sent: r.sent, failed: r.failed, results: r.results.map(resultOf) }, opts?.onlyNew ? [] : missingEmail);
    },

    async previewInvites(meetingId) {
      const m = await requireMeeting(meetingId);
      const { recipients, missingEmail } = await recipientsFor(m);
      return { recipients, missingEmail, problems: inviteProblems(m, recipients, missingEmail), invitesSentAt: m.invitesSentAt };
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

    async sendMinutes(meetingId, pdf, opts) {
      const m = await requireMeeting(meetingId);
      const { recipients, missingEmail, organizer } = await recipientsFor(m);
      // Only the meeting's own people can be chosen — never an arbitrary address.
      const chosen = opts?.only ? new Set(opts.only.map((e) => e.trim().toLowerCase())) : null;
      const targets = chosen ? recipients.filter((r) => chosen.has(r.email.toLowerCase())) : recipients;
      if (chosen && targets.length === 0) throw new ValidationError('Choose at least one of the meeting’s people to send the minutes to.');
      const params = await emailParams(m, organizer);
      const attachment: EmailAttachment = { filename: minutesAttachmentName(m.title, opts?.final), contentType: 'application/pdf', content: pdf };
      const r = assertConfigured(await deliver(m, 'minutes', targets, (p) => email.sendMeetingMinutes(p.email, params, attachment)));
      return report({ sent: r.sent, failed: r.failed, results: r.results.map(resultOf) }, chosen ? [] : missingEmail);
    },

    async previewMinutes(meetingId, opts) {
      const m = await requireMeeting(meetingId);
      const { recipients, missingEmail, organizer } = await recipientsFor(m);
      const content = meetingMinutesEmail(await emailParams(m, organizer));
      return { subject: content.subject, html: content.html, text: content.text, attachmentName: minutesAttachmentName(m.title, opts?.final), recipients, missingEmail };
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

/** "minutes-weekly-review.pdf", or "minutes-final-weekly-review.pdf" for the approved final minutes. */
function minutesAttachmentName(title: string, final?: boolean): string {
  return `minutes-${final ? 'final-' : ''}${slugify(title)}.pdf`;
}
