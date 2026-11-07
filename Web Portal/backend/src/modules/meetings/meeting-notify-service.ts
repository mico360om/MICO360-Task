import { ConflictError, HttpError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { buildIcs, buildIcsCalendar, type IcsEvent, type IcsMethod, type IcsPerson } from '../../lib/ics';
import { zonedDayKey } from '../../lib/due-date';
import { formatDay } from '../../lib/export-format';
import { fmtDate, fmtTimeRange } from './minutes';
import { recurrenceSummary } from '../tasks/recurrence-summary';
import { wallOf } from './meeting-series';
import type { Logger } from '../../lib/logger';
import { EmailNotConfiguredError } from '../email/delivery-error';
import type { EmailAttachment } from '../email/mailer';
import type { MailLines } from '../email/email-service';
import { meetingMinutesEmail, type MeetingEmailParams, type TemplateOptions } from '../email/email-templates';
import type { MeetingRecord, MeetingRepository, MeetingSeriesStore, RecurrenceRule } from './meeting-repository';
import type { AttendeeRecord } from './attendee-repository';
import { isValidTimeZone } from './meeting-validation';

export interface NotifyPerson {
  name: string;
  email: string;
}

/** The email surface this service needs (a subset of EmailService). Sends throw when delivery fails. */
export interface MeetingMailer {
  sendMeetingInvite(email: string, params: MeetingEmailParams, ics: EmailAttachment, opts?: TemplateOptions): Promise<void>;
  sendMeetingCancelled(email: string, params: MeetingEmailParams, ics: EmailAttachment, opts?: TemplateOptions): Promise<void>;
  /** ONE email to its To and Cc lines; `suppressed`: blocked addresses it left out. */
  sendMeetingMinutes(lines: MailLines, params: MeetingEmailParams, pdf: EmailAttachment, opts?: TemplateOptions): Promise<{ suppressed: string[] }>;
}

/** Someone the minutes go to: a user (picked from the people list), or an email address. */
export type MinutesAddressee = { userId: string } | { email: string };

/** Which copy of the minutes a person gets: the shared email, their own (another company), later (once final) or none. */
export type MinutesCopy = 'shared' | 'own' | 'later' | 'none' | 'off';

/** 1.23.7: a client who gets no minutes because these notifications are off, and the words saying why. */
export interface MinutesNotSent {
  notSent: string;
}

/** The most addresses one minutes send may go to (Mailjet takes 50 per email). */
export const MAX_MINUTES_ADDRESSES = 50;

export interface MeetingNotifyDeps {
  /** With the series store, a repeating series is sent as one calendar series (else meeting by meeting). */
  meetings: Pick<MeetingRepository, 'findById' | 'markInvitesSent'> &
    Partial<Pick<MeetingSeriesStore, 'listSeries'>>;
  attendees: {
    listByMeeting(meetingId: string): Promise<AttendeeRecord[]>;
    /** Stamp attendees whose own invitation was delivered (enables "invite only new people"). */
    markInvited?(ids: string[], at: Date): Promise<void>;
  };
  email: MeetingMailer;
  /** Resolve an internal user id to a name + email (null if unknown / no email). */
  resolveUser: (userId: string) => Promise<NotifyPerson | null>;
  /** The active account an email address belongs to (a typed minutes address may be someone's). */
  findUserByEmail?: (email: string) => Promise<{ id: string; name: string; email: string } | null>;
  /** Resolve a project id to its name (for the "Project" row). */
  resolveProjectName?: (projectId: string) => Promise<string | null>;
  /** A project's name, picture ('/uploads/…' or a full address) and colour: the minutes email is headed by them. */
  resolveProjectLook?: (projectId: string) => Promise<{ name: string; imageUrl: string | null; color: string | null } | null>;
  /** Where '/uploads/…' pictures are served from (the API's public address); defaults to appUrl. */
  assetBaseUrl?: string;
  /** Web app base URL for the "Open in app" link. */
  appUrl: string;
  /** Company time zone — used to show times for meetings stored without one. */
  defaultTimeZone?: string;
  /** Where per-recipient failures are reported. */
  logger?: Pick<Logger, 'error' | 'warn'>;
  now?: () => Date;
  /** Companies: the meeting's company brand on its emails (its project's main company, else its own company). */
  emailOptions?: (m: MeetingRecord) => Promise<TemplateOptions | undefined>;
  /**
   * 1.23 Client accounts: may this user attendee be emailed about the meeting? A client who no longer
   * has the project's Meetings module (or whose account is off) is left out of every email of it —
   * invitations, updates, cancellations and the minutes' default lines. Absent: everyone may.
   */
  reach?: (meetingId: string, userId: string) => Promise<boolean>;
  /** 1.23.7: attendees invited for the first time (their invitation was delivered): a client's portal bell. */
  onInvited?: (meetingId: string, attendeeIds: string[]) => void | Promise<void>;
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
  /** The minutes: the line they were on, and whether they got the shared email or their own (another company). */
  line?: 'to' | 'cc';
  copy?: 'shared' | 'own';
  /** The minutes: their account, when they have one. */
  userId?: string;
  /** 1.23.7: nothing was sent to them on purpose (a client's minutes are off); `error` says why. */
  notSent?: boolean;
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
  /** The meeting's people, with their account and which copy they would get. */
  recipients: Array<Recipient & { userId?: string; copy: MinutesCopy }>;
  missingEmail: Array<{ name: string; attendeeId: string }>;
  /** The approved final minutes go out (else the draft minutes). */
  final: boolean;
}

export interface MinutesSendOptions {
  /** Older apps: some of the meeting's own people (by email), all on the To line. */
  only?: string[];
  /** The To line: the meeting's people chosen (by email) and anyone added. Omitted: `only`, else everyone. */
  to?: MinutesAddressee[];
  cc?: MinutesAddressee[];
  /** The PDF is the approved final minutes (the attachment is named so). */
  final?: boolean;
  /**
   * Companies: a user's own copy — a Buffer is theirs (sent in an email of their own), null sends
   * them nothing, undefined the shared email. Addresses that aren't anyone's always get the shared email.
   */
  attachmentFor?: (userId: string) => Promise<Buffer | null | undefined | MinutesNotSent>;
  /**
   * 1.22 review: may the sender see this account's name — a colleague (they share a company)? Asked
   * of a typed address that is someone's account but not one of the meeting's people. No: it is shown
   * and kept as the typed address, with no name or account id (their account still decides their
   * copy). Absent: yes.
   */
  mayName?: (userId: string) => Promise<boolean>;
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
   * `alsoTo`: other meetings of the series whose people who have the series hear too.
   */
  sendCancellation(meetingId: string, opts?: { meeting?: MeetingRecord; scope?: SeriesScope; note?: 'moved'; alsoTo?: MeetingRecord[] }): Promise<DeliveryReport>;
  /**
   * Remove the event from one attendee's calendar after they were taken off an invited meeting —
   * the whole series once they are on none of its upcoming meetings (`alsoFrom`: other meetings
   * of the series they were taken off at the same time).
   */
  sendAttendeeRemoved(meetingId: string, attendee: AttendeeRecord, opts?: { alsoFrom?: MeetingRecord[] }): Promise<DeliveryReport>;
  /**
   * Email the minutes PDF: ONE email with real To and Cc lines (everyone sees who got it) — to the
   * organizer and attendees, or the To and Cc chosen. At most 50 addresses; an address once (To wins).
   * Companies (`attachmentFor`): someone from another company gets their own copy in an email of their
   * own, and the shared email doesn't list them.
   */
  sendMinutes(meetingId: string, pdf: Buffer, opts?: MinutesSendOptions): Promise<SendReport>;
  /** The minutes email exactly as it would be sent, and to whom — sends nothing. `copyOf`: each user's copy (companies). */
  previewMinutes(meetingId: string, opts?: { final?: boolean; copyOf?: (userId: string) => Promise<MinutesCopy> }): Promise<MinutesPreview>;
}

/** One meeting of a repeating series, or all of it. */
export type SeriesScope = 'one' | 'series';

/** Someone the minutes go to, with the address and name they are sent under. */
interface Addressed {
  name: string;
  email: string;
  kind: RecipientKind;
  userId?: string;
  /** The account behind a typed address the sender may not name (1.22 review): its copy rule only, never shown or kept. */
  accountId?: string;
}

/** Why a blocked address (an earlier hard bounce or spam report) was left out of an email. */
const BLOCKED = 'Blocked: earlier emails to this address bounced or were marked as spam.';

function slugify(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'meeting';
}

export function createMeetingNotifyService(deps: MeetingNotifyDeps): MeetingNotifyService {
  const { meetings, attendees } = deps;
  const now = deps.now ?? (() => new Date());
  const fallbackZone = deps.defaultTimeZone && isValidTimeZone(deps.defaultTimeZone) ? deps.defaultTimeZone : 'UTC';

  /** Companies: the meeting's company brand (null: the site's — a brand that can't be read leaves it so). */
  const brandOf = async (m: MeetingRecord): Promise<TemplateOptions | null> => (deps.emailOptions ? ((await deps.emailOptions(m).catch(() => undefined)) ?? null) : null);
  /** The mailer, each send with the meeting's brand added — and exactly as before without one. */
  const mailerFor = (brand: TemplateOptions | null): MeetingMailer =>
    brand
      ? {
          sendMeetingInvite: (to, params, ics) => deps.email.sendMeetingInvite(to, params, ics, brand),
          sendMeetingCancelled: (to, params, ics) => deps.email.sendMeetingCancelled(to, params, ics, brand),
          sendMeetingMinutes: (lines, params, pdf) => deps.email.sendMeetingMinutes(lines, params, pdf, brand),
        }
      : deps.email;

  /** The meeting's own zone when valid, else the company zone — never a zone that makes formatting throw. */
  const zoneOf = (m: MeetingRecord): string => (m.timeZone && isValidTimeZone(m.timeZone) ? m.timeZone : fallbackZone);

  /**
   * "Thursday 1 October 2026, 10:00 – 11:30 (GMT+4)": day before month and the 24-hour clock, in the
   * meeting's zone — as the minutes PDF writes the meeting's day and times.
   */
  function formatWhen(m: MeetingRecord): string {
    const tz = zoneOf(m);
    return `${fmtDate(m.startAt.toISOString(), tz)}, ${fmtTimeRange(m.startAt.toISOString(), m.endAt?.toISOString() ?? null, tz)}`;
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
    /** companies: the user behind each address (lower-cased), for the people who are users. */
    userIdOf: Map<string, string>;
  }> {
    const byEmail = new Map<string, Recipient>();
    const userIdOf = new Map<string, string>();
    const invited = new Map<string, boolean[]>();
    const missingEmail: Array<{ name: string; attendeeId: string }> = [];
    const icsAttendees: IcsPerson[] = [];
    const organizer = await deps.resolveUser(m.organizerId);
    if (organizer?.email) {
      byEmail.set(organizer.email.toLowerCase(), { name: organizer.name, email: organizer.email, kind: 'organizer', attendeeIds: [], alreadyInvited: false });
      userIdOf.set(organizer.email.toLowerCase(), m.organizerId);
    }

    for (const a of await attendees.listByMeeting(m.id)) {
      if (a.userId && deps.reach && !(await deps.reach(m.id, a.userId).catch(() => false))) continue;
      const person = await personFor(a);
      if (!person?.email) {
        missingEmail.push({ name: a.userId ? person?.name ?? 'A team member' : a.externalName ?? 'A guest', attendeeId: a.id });
        continue;
      }
      const key = person.email.toLowerCase();
      const r = byEmail.get(key) ?? { name: person.name, email: person.email, kind: a.userId ? 'member' : 'guest', attendeeIds: [], alreadyInvited: false };
      r.attendeeIds.push(a.id);
      byEmail.set(key, r);
      if (a.userId && !userIdOf.has(key)) userIdOf.set(key, a.userId);
      invited.set(key, [...(invited.get(key) ?? []), a.invitedAt != null]);
      icsAttendees.push({ name: person.name, email: person.email, role: a.role });
    }
    const recipients = [...byEmail.entries()].map(([key, r]) => {
      const rows = invited.get(key);
      return { ...r, alreadyInvited: rows ? rows.every(Boolean) : m.invitesSentAt != null };
    });
    return { people: recipients.map((r) => ({ name: r.name, email: r.email })), recipients, missingEmail, icsAttendees, organizer, userIdOf };
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
      onlineMeetingProvider: m.onlineMeetingProvider ?? null,
      organizerName: organizer?.name ?? null,
      projectName,
      description: m.description,
      link: `${deps.appUrl.replace(/\/$/, '')}/meetings/${m.id}`,
    };
  }

  /** The meeting's project as the minutes email shows it, its picture at an address email clients can load. */
  async function projectLook(m: MeetingRecord): Promise<MeetingEmailParams['project']> {
    if (!m.projectId || !deps.resolveProjectLook) return null;
    const look = await deps.resolveProjectLook(m.projectId).catch(() => null);
    if (!look) return null;
    const base = (deps.assetBaseUrl ?? deps.appUrl).replace(/\/+$/, '');
    const imageUrl = !look.imageUrl ? null : look.imageUrl.startsWith('/') ? `${base}${look.imageUrl}` : /^https?:\/\//i.test(look.imageUrl) ? look.imageUrl : null;
    return { name: look.name, imageUrl, color: look.color };
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
      // 1.23: where to join (a Teams link as one) — in the calendar file as in the email.
      onlineLink: m.onlineLink,
      onlineMeetingProvider: m.onlineMeetingProvider ?? null,
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
    opts: { only?: AttendeeRecord; scope?: SeriesScope; endSeries?: boolean; alsoFrom?: MeetingRecord[]; alsoTo?: MeetingRecord[]; note?: 'moved' } = {},
  ): Promise<DeliveryReport> {
    const { only } = opts;
    const all = await recipientsFor(m);
    let people = all.people;
    let icsAttendees = all.icsAttendees;
    if (only) {
      if (only.userId && deps.reach && !(await deps.reach(m.id, only.userId).catch(() => false))) return { sent: 0, failed: 0 };
      const person = await personFor(only);
      if (!person?.email) return { sent: 0, failed: 0 };
      people = [person];
      icsAttendees = [{ name: person.name, email: person.email, role: only.role }];
    } else if (opts.alsoTo?.length) {
      // Others with the series in their calendar: people invited to its other meetings.
      const have = new Set(people.map((p) => p.email.toLowerCase()));
      for (const r of opts.alsoTo) {
        const more = await recipientsFor(r);
        for (const x of more.recipients) {
          const key = x.email.toLowerCase();
          if (have.has(key) || !x.alreadyInvited) continue;
          have.add(key);
          people = [...people, { name: x.name, email: x.email }];
          const a = more.icsAttendees.find((i) => i.email.toLowerCase() === key);
          if (a) icsAttendees = [...icsAttendees, a];
        }
      }
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
    const mail = mailerFor(await brandOf(m));
    const r = await deliver(m, 'cancellation', people, (p) => mail.sendMeetingCancelled(p.email, params, ics));
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
      const mail = mailerFor(await brandOf(m));
      const r = assertConfigured(await deliver(m, 'invitation', targets, (p) => mail.sendMeetingInvite(p.email, params, ics)));
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
        // 1.23.7: people invited for the first time (not an update of an invitation they already have).
        const firstTime = new Set(targets.filter((t) => !t.alreadyInvited).map((t) => t.email.toLowerCase()));
        const newly = reached.filter((x) => firstTime.has(x.email.toLowerCase())).flatMap((x) => x.attendeeIds);
        if (newly.length && deps.onInvited) await Promise.resolve(deps.onInvited(m.id, newly)).catch(() => undefined);
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
      return cancelFor(m, { scope: opts?.scope, endSeries: opts?.scope === 'series', note: opts?.note, alsoTo: opts?.alsoTo });
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
      const { recipients, missingEmail, organizer, userIdOf } = await recipientsFor(m);
      const ownPeople = new Map(recipients.map((r) => [r.email.toLowerCase(), r]));
      const skipped: Array<{ name: string; reason: string }> = [];

      // Who: the To and Cc chosen; older apps name some of the meeting's own people (never another
      // address); with neither, everyone on the meeting.
      let toList: MinutesAddressee[];
      let ccList: MinutesAddressee[] = [];
      if (opts?.to) {
        toList = opts.to;
        ccList = opts.cc ?? [];
      } else if (opts?.only) {
        const asked = new Set(opts.only.map((e) => e.trim().toLowerCase()));
        toList = recipients.filter((r) => asked.has(r.email.toLowerCase())).map((r) => ({ email: r.email }));
        if (toList.length === 0) throw new ValidationError('Choose at least one of the meeting’s people to send the minutes to.');
      } else {
        toList = recipients.map((r) => ({ email: r.email }));
        skipped.push(...missingEmail.map((x) => ({ name: x.name, reason: 'no email address' })));
      }

      /** An addressee as a person with an address: one of the meeting's people, a user, or just the address. */
      const resolve = async (a: MinutesAddressee): Promise<Addressed | null> => {
        if ('userId' in a) {
          const person = await deps.resolveUser(a.userId);
          if (!person?.email) {
            skipped.push({ name: person?.name || 'A team member', reason: 'no email address' });
            return null;
          }
          const mine = ownPeople.get(person.email.toLowerCase());
          return { name: mine?.name ?? person.name, email: mine?.email ?? person.email, kind: mine?.kind ?? 'member', userId: a.userId };
        }
        const typed = a.email.trim();
        const key = typed.toLowerCase();
        const mine = ownPeople.get(key);
        if (mine) return { name: mine.name, email: mine.email, kind: mine.kind, userId: userIdOf.get(key) };
        // A typed address that is someone's account is that person (the company rule asks about them).
        const user = deps.findUserByEmail ? await deps.findUserByEmail(typed).catch(() => null) : null;
        // 1.22 review: someone the sender may not name (another company's) stays the typed address.
        if (user && opts?.mayName && !(await opts.mayName(user.id).catch(() => false))) return { name: typed, email: typed, kind: 'guest', accountId: user.id };
        if (user) return { name: user.name, email: user.email, kind: 'member', userId: user.id };
        return { name: typed, email: typed, kind: 'guest' };
      };

      // Each address once: the To line first, so To wins over Cc.
      const seen = new Set<string>();
      const chosen: Array<Addressed & { line: 'to' | 'cc' }> = [];
      for (const [line, list] of [['to', toList], ['cc', ccList]] as const) {
        for (const a of list) {
          const r = await resolve(a);
          if (!r || seen.has(r.email.toLowerCase())) continue;
          seen.add(r.email.toLowerCase());
          chosen.push({ ...r, line });
        }
      }
      if (chosen.length > MAX_MINUTES_ADDRESSES) throw new ValidationError(`Send the minutes to ${MAX_MINUTES_ADDRESSES} addresses at most.`);
      if (chosen.length === 0) throw new ValidationError('Choose at least one person with an email address to send the minutes to.');

      // companies: a user from another company gets their own copy (the invitee minutes) in an email of
      // their own, or none yet — never the shared PDF, and the shared email doesn't list them.
      const own = new Map<string, Buffer>();
      const going: typeof chosen = [];
      // 1.23.7: clients whose minutes are off — listed in the report and the log as not sent, with why.
      const notSent: Array<(typeof chosen)[number] & { why: string }> = [];
      for (const r of chosen) {
        const account = r.userId ?? r.accountId;
        const theirs = account && opts?.attachmentFor ? await opts.attachmentFor(account) : undefined;
        if (theirs === null) {
          skipped.push({ name: r.name, reason: 'can’t get these minutes yet' });
          continue;
        }
        if (theirs && !Buffer.isBuffer(theirs)) {
          notSent.push({ ...r, why: theirs.notSent });
          continue;
        }
        if (theirs) own.set(r.email.toLowerCase(), theirs);
        going.push(r);
      }
      if (going.length === 0 && notSent.length > 0) {
        return { sent: 0, failed: 0, recipients: notSent.map((r) => ({ name: r.name, email: r.email, kind: r.kind, ok: false, notSent: true, error: r.why, line: r.line, copy: 'own' as const, ...(r.userId ? { userId: r.userId } : {}) })), skipped };
      }

      const params = { ...(await emailParams(m, organizer)), project: await projectLook(m) };
      const filename = minutesAttachmentName(m.title, opts?.final);
      const mail = mailerFor(await brandOf(m));
      // The name beside an address on the To and Cc lines (none for a bare typed address).
      const lineAddress = (r: Addressed) => ({ email: r.email, name: r.name && r.name !== r.email ? r.name : null });
      const shared = going.filter((r) => !own.has(r.email.toLowerCase()));
      const emails: Array<{ people: Addressed[]; lines: MailLines; content: Buffer; copy: 'shared' | 'own' }> = [];
      if (shared.length) {
        const to = shared.filter((r) => r.line === 'to').map(lineAddress);
        const cc = shared.filter((r) => r.line === 'cc').map(lineAddress);
        // An email needs a To line: with only people from another company in To, the Cc line moves up.
        emails.push({ people: shared, copy: 'shared', content: pdf, lines: to.length ? { to, cc } : { to: cc, cc: [] } });
      }
      for (const r of going) {
        const theirs = own.get(r.email.toLowerCase());
        if (theirs) emails.push({ people: [r], copy: 'own', content: theirs, lines: { to: [lineAddress(r)], cc: [] } });
      }

      const outcome = new Map<string, RecipientResult>();
      let sent = 0;
      let failed = 0;
      let notConfigured = 0;
      for (const e of emails) {
        let blocked = new Set<string>();
        let error: string | null = null;
        let off = false;
        try {
          const r = await mail.sendMeetingMinutes(e.lines, params, { filename, contentType: 'application/pdf', content: e.content });
          blocked = new Set(r.suppressed.map((x) => x.toLowerCase()));
        } catch (err) {
          off = err instanceof EmailNotConfiguredError;
          error = off ? 'Email isn’t set up on this server.' : 'The mail server didn’t accept it.';
          deps.logger?.error('meeting minutes email failed', { err, meetingId: m.id });
        }
        for (const p of e.people) {
          const why = error ?? (blocked.has(p.email.toLowerCase()) ? BLOCKED : null);
          if (why) failed++;
          else sent++;
          if (off) notConfigured++;
          const line = (p as Addressed & { line: 'to' | 'cc' }).line;
          outcome.set(p.email.toLowerCase(), {
            name: p.name,
            email: p.email,
            kind: p.kind,
            ok: !why,
            ...(why ? { error: why } : {}),
            line,
            copy: e.copy,
            ...(p.userId ? { userId: p.userId } : {}),
          });
        }
      }
      // An explicit send that reached nobody because email isn't set up is an error, not "sent to 0".
      if (sent === 0 && failed > 0 && notConfigured === failed) {
        throw new HttpError('Email sending is not configured, so nothing was sent.', 'EMAIL_NOT_CONFIGURED', 503);
      }
      const held = notSent.map((r): RecipientResult => ({ name: r.name, email: r.email, kind: r.kind, ok: false, notSent: true, error: r.why, line: r.line, copy: 'own', ...(r.userId ? { userId: r.userId } : {}) }));
      return { sent, failed, recipients: [...going.map((r) => outcome.get(r.email.toLowerCase())!), ...held], skipped };
    },

    async previewMinutes(meetingId, opts) {
      const m = await requireMeeting(meetingId);
      const { recipients, missingEmail, organizer, userIdOf } = await recipientsFor(m);
      // The preview is the email as sent: with the meeting's company brand.
      const brand = await brandOf(m);
      const content = meetingMinutesEmail({ ...(await emailParams(m, organizer)), project: await projectLook(m) }, brand ?? undefined);
      // Each person's account and copy: the dialog shows who gets their own email, later or nothing.
      const people: MinutesPreview['recipients'] = [];
      for (const r of recipients) {
        const userId = userIdOf.get(r.email.toLowerCase());
        const copy: MinutesCopy = userId && opts?.copyOf ? await opts.copyOf(userId) : 'shared';
        people.push({ ...r, ...(userId ? { userId } : {}), copy });
      }
      return {
        subject: content.subject,
        html: content.html,
        text: content.text,
        attachmentName: minutesAttachmentName(m.title, opts?.final),
        recipients: people,
        missingEmail,
        final: Boolean(opts?.final),
      };
    },
  };
}

/** "minutes-weekly-review.pdf", or "minutes-final-weekly-review.pdf" for the approved final minutes. */
function minutesAttachmentName(title: string, final?: boolean): string {
  return `minutes-${final ? 'final-' : ''}${slugify(title)}.pdf`;
}
