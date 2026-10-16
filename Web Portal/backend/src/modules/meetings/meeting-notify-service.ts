import { ConflictError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { buildIcs, buildIcsCalendar, type IcsEvent, type IcsMethod, type IcsPerson } from '../../lib/ics';
import { zonedDayKey } from '../../lib/due-date';
import { formatDay } from '../../lib/export-format';
import { recurrenceSummary } from '../tasks/recurrence-summary';
import { wallOf } from './meeting-series';
import type { Logger } from '../../lib/logger';
import { EmailNotConfiguredError } from '../email/delivery-error';
import type { EmailAttachment } from '../email/mailer';
import { meetingMinutesEmail, type MeetingEmailParams } from '../email/email-templates';
import type { MeetingRecord, MeetingRepository, MeetingSeriesStore, RecurrenceRule } from './meeting-repository';
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
  /** With the series store, a repeating series is sent as one calendar series (else meeting by meeting). */
  meetings: Pick<MeetingRepository, 'findById' | 'markInvitesSent' | 'markReminderSent' | 'listUpcomingWithoutReminder'> &
    Partial<Pick<MeetingSeriesStore, 'listSeries'>>;
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
  /**
   * Calendar invitations to everyone, or (onlyNew) just to people who haven't had one yet. A
   * meeting of a series sends the whole series, or with scope 'one' just this meeting (an update).
   */
  sendInvites(meetingId: string, opts?: { onlyNew?: boolean; scope?: SeriesScope }): Promise<SendReport>;
  /** Who an invitation would go to and anything to fix first — sends nothing. */
  previewInvites(meetingId: string): Promise<InvitePreview>;
  /**
   * Cancel the event in invitees' calendars. Pass the record when the meeting is already deleted.
   * A meeting of a series cancels just that meeting, or with scope 'series' its upcoming meetings.
   */
  sendCancellation(meetingId: string, opts?: { meeting?: MeetingRecord; scope?: SeriesScope; note?: 'moved' }): Promise<DeliveryReport>;
  /**
   * Remove the event from one attendee's calendar after they were taken off an invited meeting —
   * the whole series once they are on none of its upcoming meetings (`alsoFrom`: other meetings
   * of the series they were taken off at the same time).
   */
  sendAttendeeRemoved(meetingId: string, attendee: AttendeeRecord, opts?: { alsoFrom?: MeetingRecord[] }): Promise<DeliveryReport>;
  /** Email the minutes PDF; `only` limits it to some of the meeting's own recipients (by email). */
  /** `final`: the PDF is the approved final minutes (the attachment is named so). */
  sendMinutes(meetingId: string, pdf: Buffer, opts?: { only?: string[]; final?: boolean }): Promise<SendReport>;
  /** The minutes email exactly as it would be sent, and to whom — sends nothing. */
  previewMinutes(meetingId: string, opts?: { final?: boolean }): Promise<MinutesPreview>;
  runReminderSweep(leadMs: number): Promise<{ meetings: number; sent: number; failed: number }>;
}

/** One meeting of a repeating series, or all of it. */
export type SeriesScope = 'one' | 'series';

function slugify(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
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

  const placeOf = (m: MeetingRecord) => m.recurrenceStart ?? m.startAt;
  const durationOf = (m: MeetingRecord) => (m.endAt ? m.endAt.getTime() - m.startAt.getTime() : null);
  const uidOf = (id: string) => `meeting-${id}@mico360`;

  /** A meeting's series — its first meeting and every meeting of it, deleted ones flagged — or null. */
  async function seriesOf(m: MeetingRecord): Promise<{ root: MeetingRecord; rows: MeetingRecord[] } | null> {
    const rootId = m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null);
    if (!rootId || !meetings.listSeries) return null;
    const rows = await meetings.listSeries(rootId);
    const root = rows.find((r) => r.id === rootId);
    return root?.recurrenceRule ? { root, rows } : null;
  }

  /** "Repeats every week on Tue, until 3 Nov 2026". */
  function repeatText(root: MeetingRecord): string {
    const rule = root.recurrenceRule!;
    const weekday = rule.freq === 'WEEKLY' && !rule.weekdays?.length ? [wallOf(placeOf(root), zoneOf(root)).getUTCDay()] : rule.weekdays;
    let text = recurrenceSummary({ ...rule, weekdays: weekday, count: null, until: null, paused: false });
    if (rule.count != null) text += `, ${rule.count} times`;
    if (rule.until) text += `, until ${formatDay(rule.until)}`;
    return text;
  }

  /**
   * SEQUENCE for a calendar message about something created at `createdAt`: the seconds since then,
   * so every message is numbered above the one before — an invitation sent after a cancellation
   * included (clients ignore an update numbered below what they have). A cancellation counts one more.
   */
  const sequenceFor = (createdAt: Date, method: IcsMethod) =>
    Math.max(0, Math.floor((now().getTime() - createdAt.getTime()) / 1000)) + (method === 'CANCEL' ? 1 : 0);

  /** The meeting that shows the series' own details: the latest one going ahead on its own schedule. */
  function patternOf(rows: MeetingRecord[], root: MeetingRecord): MeetingRecord {
    const byPlace = rows.filter((r) => !r.deletedAt).sort((a, b) => placeOf(b).getTime() - placeOf(a).getTime());
    const live = byPlace.filter((r) => r.status !== 'CANCELLED');
    return live.find((r) => r.startAt.getTime() === placeOf(r).getTime()) ?? live[0] ?? byPlace[0] ?? root;
  }

  function eventOf(m: MeetingRecord, method: IcsMethod, organizer: NotifyPerson, icsAttendees: IcsPerson[]): IcsEvent {
    return {
      method,
      uid: uidOf(m.id),
      sequence: sequenceFor(m.createdAt, method),
      start: m.startAt,
      end: m.endAt,
      timeZone: zoneOf(m),
      summary: m.title,
      description: m.description,
      location: m.location,
      url: `${deps.appUrl.replace(/\/$/, '')}/meetings/${m.id}`,
      organizer,
      attendees: icsAttendees,
      stamp: now(),
    };
  }

  /**
   * The calendar file for a meeting: on its own; one meeting of a series (RECURRENCE-ID, plus
   * `alsoFrom`); or the whole series — its rule, the dates that don't take place, and the
   * meetings that differ from it.
   */
  async function calendarFor(
    m: MeetingRecord,
    method: IcsMethod,
    organizer: NotifyPerson,
    icsAttendees: IcsPerson[],
    scope: SeriesScope,
    alsoFrom: MeetingRecord[] = [],
  ): Promise<EmailAttachment> {
    const s = await seriesOf(m);
    let ics: string;
    if (!s) {
      const rule = (m.recurrenceRule as RecurrenceRule | null) ?? null;
      // A paused series is announced as a single occurrence.
      ics = buildIcs({ ...eventOf(m, method, organizer, icsAttendees), recurrence: rule && !rule.paused ? rule : null });
    } else {
      const uid = uidOf(s.root.id);
      // Calendar clients take an update only with a sequence at least the last one's.
      const sequence = sequenceFor(s.root.createdAt, method);
      if (scope === 'one') {
        const events = [m, ...alsoFrom].map((r) => ({ ...eventOf(r, method, organizer, icsAttendees), uid, sequence, recurrenceId: placeOf(r) }));
        ics = buildIcsCalendar(method, events);
      } else {
        const rule = s.root.recurrenceRule!;
        const tz = zoneOf(s.root);
        const last = new Date(Math.max(...s.rows.map((r) => placeOf(r).getTime())));
        const recurrence = rule.paused ? { ...rule, paused: false, count: null, until: zonedDayKey(last, tz) } : rule;
        const start = placeOf(s.root);
        // The series' own title, place and length — not those of a meeting changed on its own.
        const pattern = patternOf(s.rows, s.root);
        const duration = durationOf(pattern);
        const master: IcsEvent = {
          ...eventOf(pattern, method, organizer, icsAttendees),
          url: eventOf(m, method, organizer, icsAttendees).url,
          uid,
          sequence,
          start,
          end: duration != null ? new Date(start.getTime() + duration) : null,
          timeZone: tz,
          recurrence,
          exdates: s.rows.filter((r) => r.deletedAt || r.status === 'CANCELLED').map(placeOf),
        };
        const differs = (r: MeetingRecord) =>
          r.startAt.getTime() !== placeOf(r).getTime() ||
          durationOf(r) !== duration ||
          r.title !== pattern.title ||
          r.description !== pattern.description ||
          r.location !== pattern.location;
        const changed =
          method === 'CANCEL'
            ? []
            : s.rows
                .filter((r) => !r.deletedAt && r.status !== 'CANCELLED' && differs(r))
                .map((r) => ({ ...eventOf(r, method, organizer, icsAttendees), uid, sequence, recurrenceId: placeOf(r) }));
        ics = buildIcsCalendar(method, [master, ...changed]);
      }
    }
    return {
      filename: `${slugify(m.title)}.ics`,
      contentType: `text/calendar; method=${method}; charset=utf-8`,
      content: Buffer.from(ics, 'utf8'),
    };
  }

  /** Record a series invitation on each of its meetings, for the people it reached. */
  async function markSeriesInvited(rows: MeetingRecord[], reached: Set<string>, at: Date): Promise<void> {
    const people = new Map<string, NotifyPerson | null>();
    for (const row of rows.filter((r) => !r.deletedAt)) {
      await meetings.markInvitesSent(row.id, at);
      const ids: string[] = [];
      for (const a of await attendees.listByMeeting(row.id)) {
        const key = a.userId ?? `guest:${a.externalEmail ?? ''}`;
        if (!people.has(key)) people.set(key, await personFor(a));
        const email = people.get(key)?.email?.toLowerCase();
        if (email && reached.has(email)) ids.push(a.id);
      }
      if (ids.length) await attendees.markInvited?.(ids, at);
    }
  }

  /** Is this person on any upcoming meeting of the series still? */
  async function onUpcoming(rows: MeetingRecord[], who: AttendeeRecord, email: string | null): Promise<boolean> {
    const at = now().getTime();
    for (const row of rows.filter((r) => !r.deletedAt && r.status !== 'CANCELLED' && r.startAt.getTime() >= at)) {
      for (const a of await attendees.listByMeeting(row.id)) {
        if (who.userId ? a.userId === who.userId : !!email && a.externalEmail?.toLowerCase() === email) return true;
      }
    }
    return false;
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

  /**
   * Cancel a meeting in its people's calendars (or one person's, with `only`). `endSeries`: the
   * series' upcoming meetings are cancelled — a series that has started is shortened, keeping
   * the meetings held; one that hasn't is cancelled whole.
   */
  async function cancelFor(
    m: MeetingRecord,
    opts: { only?: AttendeeRecord; scope?: SeriesScope; endSeries?: boolean; alsoFrom?: MeetingRecord[]; note?: 'moved' } = {},
  ): Promise<DeliveryReport> {
    const { only } = opts;
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
    const s = await seriesOf(m);
    const scope: SeriesScope = s ? opts.scope ?? 'one' : 'one';
    let method: IcsMethod = 'CANCEL';
    if (s && scope === 'series') {
      const held = s.rows.some((r) => !r.deletedAt && r.status !== 'CANCELLED' && r.startAt.getTime() < now().getTime());
      if (opts.endSeries && held) {
        method = 'REQUEST'; // the series now ends before its cancelled meetings
        params.whenLabel =
          opts.note === 'moved'
            ? `${repeatText(s.root)} — the upcoming meetings moved to a new schedule (a new invitation follows)`
            : `${repeatText(s.root)} — the upcoming meetings are cancelled`;
      } else {
        params.whenLabel =
          opts.note === 'moved'
            ? `${repeatText(s.root)} — moved to a new schedule (a new invitation follows)`
            : `${repeatText(s.root)} — every meeting of the series is cancelled`;
      }
    } else if (s) {
      params.whenLabel = `${params.whenLabel} · This meeting of the series only`;
    }
    // Someone taken off the meetings: the series goes on, they're just no longer on it.
    if (only && s) {
      params.whenLabel = scope === 'series' ? `${repeatText(s.root)} — you’re no longer on this meeting series` : `${params.whenLabel} · you’re no longer on this meeting`;
    }
    const ics = await calendarFor(m, method, organizerOf(m, all.organizer), icsAttendees, scope, opts.alsoFrom);
    const r = await deliver(m, 'cancellation', people, (p) => email.sendMeetingCancelled(p.email, params, ics));
    return { sent: r.sent, failed: r.failed };
  }

  return {
    async sendInvites(meetingId, opts) {
      const m = await requireMeeting(meetingId);
      if (m.status === 'CANCELLED') throw new ConflictError('This meeting is cancelled — invitations cannot be sent.');
      const { recipients, missingEmail, icsAttendees, organizer } = await recipientsFor(m);
      const params = await emailParams(m, organizer);
      const s = await seriesOf(m);
      const scope: SeriesScope = s ? opts?.scope ?? 'series' : 'one';
      const asked = opts?.onlyNew ? recipients.filter((r) => !r.alreadyInvited) : recipients;
      // A change to one meeting of a series goes only to people who have the series: for anyone
      // else it would be a stray update of a meeting they were never invited to.
      const targets = s && scope === 'one' ? asked.filter((r) => r.alreadyInvited || r.kind === 'organizer') : asked;
      if (s) params.whenLabel = scope === 'series' ? `${params.whenLabel} · ${repeatText(s.root)}` : `${params.whenLabel} · This meeting of the series only`;
      const ics = await calendarFor(m, 'REQUEST', organizerOf(m, organizer), icsAttendees, scope);
      const r = assertConfigured(await deliver(m, 'invitation', targets, (p) => email.sendMeetingInvite(p.email, params, ics)));
      // Only a delivered invitation counts as "invites sent" (it later drives cancellation notices).
      if (r.sent > 0) {
        const at = now();
        const reached = r.results.filter((x) => x.ok);
        if (s && scope === 'series') {
          await markSeriesInvited(s.rows, new Set(reached.map((x) => x.email.toLowerCase())), at);
        } else {
          await meetings.markInvitesSent(m.id, at);
          await attendees.markInvited?.(reached.flatMap((x) => x.attendeeIds), at);
        }
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
      return cancelFor(m, { scope: opts?.scope, endSeries: opts?.scope === 'series', note: opts?.note });
    },

    async sendAttendeeRemoved(meetingId, attendee, opts) {
      const m = await meetings.findById(meetingId);
      // Nothing to retract if the meeting never reached calendars (or its cancellation already did).
      if (!m || !m.invitesSentAt || m.status === 'CANCELLED') return { sent: 0, failed: 0 };
      const s = await seriesOf(m);
      if (!s) return cancelFor(m, { only: attendee });
      // Off every upcoming meeting: the series leaves their calendar; else just the meetings they left.
      const person = await personFor(attendee);
      const still = await onUpcoming(s.rows, attendee, person?.email?.toLowerCase() ?? null);
      return still ? cancelFor(m, { only: attendee, scope: 'one', alsoFrom: opts?.alsoFrom }) : cancelFor(m, { only: attendee, scope: 'series' });
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
