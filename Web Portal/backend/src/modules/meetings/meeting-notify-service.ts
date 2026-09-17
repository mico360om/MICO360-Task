import { NotFoundError } from '../../lib/http-errors';
import { buildIcs, type IcsMethod, type IcsPerson } from '../../lib/ics';
import type { EmailAttachment } from '../email/mailer';
import type { MeetingEmailParams } from '../email/email-templates';
import type { MeetingRecord, MeetingRepository, RecurrenceRule } from './meeting-repository';
import type { AttendeeRecord } from './attendee-repository';

export interface NotifyPerson {
  name: string;
  email: string;
}

/** The email surface this service needs (a subset of EmailService). */
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
  now?: () => Date;
}

export interface MeetingNotifyService {
  sendInvites(meetingId: string): Promise<{ sent: number }>;
  sendCancellation(meetingId: string): Promise<{ sent: number }>;
  sendMinutes(meetingId: string, pdf: Buffer): Promise<{ sent: number }>;
  runReminderSweep(leadMs: number): Promise<{ meetings: number; sent: number }>;
}

function slugify(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
}

/** SEQUENCE that increases as a meeting is edited (calendar clients require monotonic sequences). */
function sequenceOf(m: MeetingRecord): number {
  return Math.max(0, Math.round((m.updatedAt.getTime() - m.createdAt.getTime()) / 1000));
}

function formatWhen(m: MeetingRecord): string {
  const tz = m.timeZone || 'UTC';
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }).format(m.startAt);
  const t = (d: Date) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
  const zone = new Intl.DateTimeFormat('en-US', { hour: 'numeric', timeZone: tz, timeZoneName: 'short' }).formatToParts(m.startAt).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  const time = m.endAt ? `${t(m.startAt)} – ${t(m.endAt)}` : t(m.startAt);
  return `${day}, ${time} (${zone})`;
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

  async function requireMeeting(id: string): Promise<MeetingRecord> {
    const m = await meetings.findById(id);
    if (!m) throw new NotFoundError('Meeting not found.');
    return m;
  }

  /** Organizer + attendees, resolved to {name,email}, deduped by lowercased email. */
  async function recipientsFor(m: MeetingRecord): Promise<{ people: NotifyPerson[]; icsAttendees: IcsPerson[]; organizer: NotifyPerson | null }> {
    const byEmail = new Map<string, NotifyPerson>();
    const icsAttendees: IcsPerson[] = [];
    const organizer = await deps.resolveUser(m.organizerId);
    if (organizer?.email) byEmail.set(organizer.email.toLowerCase(), organizer);

    for (const a of await attendees.listByMeeting(m.id)) {
      let person: NotifyPerson | null = null;
      if (a.userId) person = await deps.resolveUser(a.userId);
      else if (a.externalEmail) person = { name: a.externalName ?? a.externalEmail, email: a.externalEmail };
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
    const ics = buildIcs({
      method,
      uid: `meeting-${m.id}@mico360`,
      sequence: method === 'CANCEL' ? sequenceOf(m) + 1 : sequenceOf(m),
      start: m.startAt,
      end: m.endAt,
      summary: m.title,
      description: m.description,
      location: m.location,
      url: `${deps.appUrl.replace(/\/$/, '')}/meetings/${m.id}`,
      organizer,
      attendees: icsAttendees,
      recurrence: (m.recurrenceRule as RecurrenceRule | null) ?? null,
      stamp: now(),
    });
    return {
      filename: `${slugify(m.title)}.ics`,
      contentType: `text/calendar; method=${method}; charset=utf-8`,
      content: Buffer.from(ics, 'utf8'),
    };
  }

  return {
    async sendInvites(meetingId) {
      const m = await requireMeeting(meetingId);
      const { people, icsAttendees, organizer } = await recipientsFor(m);
      const params = await emailParams(m, organizer);
      const org: NotifyPerson = organizer ?? { name: m.organizerId, email: `${m.organizerId}@invalid.local` };
      const ics = icsFor(m, 'REQUEST', org, icsAttendees);
      for (const p of people) await email.sendMeetingInvite(p.email, params, ics);
      await meetings.markInvitesSent(m.id, now());
      return { sent: people.length };
    },

    async sendCancellation(meetingId) {
      const m = await requireMeeting(meetingId);
      const { people, icsAttendees, organizer } = await recipientsFor(m);
      const params = await emailParams(m, organizer);
      const org: NotifyPerson = organizer ?? { name: m.organizerId, email: `${m.organizerId}@invalid.local` };
      const ics = icsFor(m, 'CANCEL', org, icsAttendees);
      for (const p of people) await email.sendMeetingCancelled(p.email, params, ics);
      return { sent: people.length };
    },

    async sendMinutes(meetingId, pdf) {
      const m = await requireMeeting(meetingId);
      const { people, organizer } = await recipientsFor(m);
      const params = await emailParams(m, organizer);
      const attachment: EmailAttachment = { filename: `minutes-${slugify(m.title)}.pdf`, contentType: 'application/pdf', content: pdf };
      for (const p of people) await email.sendMeetingMinutes(p.email, params, attachment);
      return { sent: people.length };
    },

    async runReminderSweep(leadMs) {
      const due = await meetings.listUpcomingWithoutReminder(now(), leadMs);
      let sent = 0;
      for (const m of due) {
        const { people, organizer } = await recipientsFor(m);
        const base = await emailParams(m, organizer);
        const params = { ...base, startsInLabel: startsInLabel(m, now()) };
        for (const p of people) {
          await email.sendMeetingReminder(p.email, params);
          sent++;
        }
        await meetings.markReminderSent(m.id, now());
      }
      return { meetings: due.length, sent };
    },
  };
}
