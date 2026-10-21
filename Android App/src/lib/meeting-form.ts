/**
 * The Schedule / Edit meeting form (2b), as on the website (MeetingFormModal): times are typed and
 * shown in company time — never the phone's own zone — and sent with that zone, so invitations,
 * reminders and minutes print the right local time. A meeting can repeat; a change to a meeting of
 * a series is for that meeting only or for all its upcoming meetings. Pure, so it is tested here.
 */
import { ApiError, isNetworkError } from './api-client';
import { normalizeDigits, parseDueDateInput, type Parsed } from './form-input';
import { dateFormat } from './intl-cache';
import { safeMeetingHref } from './meetings';
import { MEETING_STATUS_LABELS } from './meeting-detail';
import { recurrenceSummary, upcomingDates } from './recurrence-summary';
import { zonedDayKey } from './due-date';
import type { ApiMeeting, MeetingInput, MeetingPatch, MeetingStatus, RecurrenceRule, SeriesScope } from './types';

// ── Company time ────────────────────────────────────────────────────────────

/** A day ('YYYY-MM-DD') and a 24-hour time ('HH:MM') on the wall clock of a zone. */
export interface WallClock {
  day: string;
  time: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** No zone is more than 14 hours from UTC, and none is a part of a minute off. */
const saneOffset = (ms: number | null): ms is number => ms !== null && Number.isFinite(ms) && Math.abs(ms) <= 14 * 3_600_000 && ms % 60_000 === 0;

/** The offset from the zone's wall clock in parts (formatToParts) — null if it is missing, throws or makes no sense. */
function offsetFromParts(instant: number, timeZone: string): number | null {
  try {
    const f = dateFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (typeof f.formatToParts !== 'function') return null;
    const parts = f.formatToParts(new Date(instant));
    if (!Array.isArray(parts)) return null;
    const [y, mo, d, h, mi, s] = ['year', 'month', 'day', 'hour', 'minute', 'second'].map((type) => {
      const v = parts.find((p) => p?.type === type)?.value;
      return typeof v === 'string' && /^\d{1,4}$/.test(v) ? Number(v) : NaN;
    }) as [number, number, number, number, number, number];
    if ([y, mo, d, h, mi, s].some(Number.isNaN)) return null;
    const ms = Date.UTC(y, mo - 1, d, h % 24, mi, s) - Math.floor(instant / 1000) * 1000;
    return saneOffset(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * The offset from the two plain format() calls the app already shows dates with on every phone:
 * the day as zonedDayKey reads it (en-CA) and the time as clockTime reads it (en-GB, 24-hour).
 */
function offsetFromFormat(instant: number, timeZone: string): number | null {
  try {
    const at = new Date(instant);
    const day = /(\d{4})-(\d{2})-(\d{2})/.exec(dateFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at));
    const time = /(\d{1,2}):(\d{2})/.exec(dateFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(at));
    if (!day || !time) return null;
    const ms = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(time[1]) % 24, Number(time[2])) - Math.floor(instant / 60_000) * 60_000;
    return saneOffset(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * How far `timeZone` is ahead of UTC at `instant`, in ms — or null when this phone can't tell
 * (never a guess: a wrong offset would book the meeting at the wrong time without a word).
 * formatToParts is tried first; if this phone's Intl lacks it, throws, or leaves out a part, the
 * day and time are read from format() instead.
 */
function zoneOffsetMs(instant: number, timeZone: string): number | null {
  return offsetFromParts(instant, timeZone) ?? offsetFromFormat(instant, timeZone);
}

/** An instant as the day and time on the zone's wall clock (null for none or a bad date). */
export function toWallClock(iso: string | null | undefined, timeZone: string): WallClock | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const offset = zoneOffsetMs(t, timeZone);
  if (offset === null) return null;
  const s = new Date(t + offset);
  return { day: `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`, time: `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}` };
}

/** A day and time on the zone's wall clock as an ISO instant (null when either is missing or bad). */
export function fromWallClock(day: string, time: string, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  if (Number.isNaN(wall) || new Date(Date.UTC(y, mo - 1, da)).toISOString().slice(0, 10) !== day || h > 23 || mi > 59) return null;
  // Two passes settle the offset across a clock change.
  const first = zoneOffsetMs(wall, timeZone);
  if (first === null) return null;
  const second = zoneOffsetMs(wall - first, timeZone);
  if (second === null) return null;
  return new Date(wall - second).toISOString();
}

/** A time typed as HH:MM ("9:30" and "9" too; Arabic digits allowed). Blank → '' (none). */
export function parseTimeInput(input: string): Parsed<string> {
  const s = normalizeDigits(input).trim();
  if (!s) return { ok: true, value: '' };
  const m = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(s);
  const h = m ? Number(m[1]) : NaN;
  const mi = m ? Number(m[2] ?? '0') : NaN;
  if (!m || h > 23 || mi > 59) return { ok: false, error: 'Enter the time as HH:MM, e.g. 09:30.' };
  return { ok: true, value: `${pad(h)}:${pad(mi)}` };
}

// ── Online links ────────────────────────────────────────────────────────────

/**
 * What someone typed as the online link, as the website keeps it: `https://` added when no scheme
 * was given, null for none, undefined when it isn't a web link (`javascript:`, `tel:`…).
 */
export function normalizeMeetingLink(input: string | null | undefined): string | null | undefined {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  return safeMeetingHref(raw) ?? undefined;
}

// ── Repeats ─────────────────────────────────────────────────────────────────

const daysInMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

/** Is a 'YYYY-MM-DD' day one of the rule's days (its weekdays, day of the month or "2nd Tuesday")? */
function onRule(day: string, rule: RecurrenceRule): boolean {
  const d = new Date(`${day}T12:00:00Z`);
  if (rule.freq === 'WEEKLY' && rule.weekdays?.length) return rule.weekdays.includes(d.getUTCDay());
  if (rule.freq !== 'MONTHLY' && rule.freq !== 'QUARTERLY') return true;
  const date = d.getUTCDate();
  if (rule.nthWeekday) {
    const { week, day: weekday } = rule.nthWeekday;
    if (d.getUTCDay() !== weekday) return false;
    return week === -1 ? date + 7 > daysInMonth(d) : Math.ceil(date / 7) === week;
  }
  if (rule.dayOfMonth != null) return date === Math.min(rule.dayOfMonth, daysInMonth(d));
  return true;
}

/**
 * The day a new series' first meeting will be on: the day chosen, or — when it isn't one of the
 * repeat's days — the repeat's next day (the server moves it there, as calendars expect).
 */
export function firstMeetingDay(startDay: string, rule: RecurrenceRule): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay) || onRule(startDay, rule)) return startDay;
  return upcomingDates(startDay, { ...rule, count: null, until: null }, 1)[0] ?? startDay;
}

/** What's wrong with a meeting's repeat for its first day ('YYYY-MM-DD'), or null. */
export function repeatProblem(rule: RecurrenceRule | null, firstDay: string): string | null {
  if (!rule) return null;
  if (rule.until && firstDay && rule.until.slice(0, 10) < firstDay) return 'The repeat can’t end before the first meeting.';
  return null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon 26 Oct" for a 'YYYY-MM-DD' day (the website's words), without Intl. */
function dayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return key;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** When the chosen day isn't one of the repeat's days, where the first meeting goes instead. */
export function firstMeetingNote(startDay: string, rule: RecurrenceRule): string | null {
  const first = firstMeetingDay(startDay, rule);
  return first !== startDay ? `The first meeting will be on ${dayLabel(first)}, the first day this repeat gives.` : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/**
 * "Repeats every week on Tue, until 3 Nov 2026" for a series starting at `startAt`. A weekly rule
 * without chosen days repeats on the first meeting's weekday, where it is held.
 */
export function meetingRepeatText(rule: RecurrenceRule, startAt: string, timeZone: string): string {
  const day = zonedDayKey(new Date(startAt), timeZone);
  const weekdays = rule.freq === 'WEEKLY' && !rule.weekdays?.length ? [new Date(`${day}T12:00:00Z`).getUTCDay()] : rule.weekdays;
  let text = recurrenceSummary({ ...rule, weekdays, count: null, until: null, paused: false, createNext: undefined });
  if (rule.count != null) text += `, ${rule.count} times`;
  if (rule.until) text += `, until ${dayText(rule.until.slice(0, 10))}`;
  return text;
}

// ── Series ──────────────────────────────────────────────────────────────────

/** The id of a meeting's series (its first meeting), or null for a one-off meeting. */
export function seriesIdOf(m: Pick<ApiMeeting, 'id' | 'recurrenceParentId' | 'recurrenceRule'>): string | null {
  return m.recurrenceParentId ?? (m.recurrenceRule ? m.id : null);
}

/** The repeat a meeting follows: its series' (one meeting's details), else its own (the first meeting). */
export function meetingRule(m: Pick<ApiMeeting, 'recurrenceRule' | 'series'>): RecurrenceRule | null {
  return m.series?.rule ?? m.recurrenceRule ?? null;
}

/** "This meeting" or "All upcoming": the default answer, and why only the series can change. */
export function scopeChoice(ruleChanged: boolean): { scope: SeriesScope; oneDisabled: string | null } {
  return ruleChanged ? { scope: 'series', oneDisabled: 'A new repeat changes the whole series.' } : { scope: 'one', oneDisabled: null };
}

// ── The form ────────────────────────────────────────────────────────────────

const CREATE_STATUSES: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS'];
const ALL_STATUSES: MeetingStatus[] = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/** The statuses to choose from: a new meeting can't start completed or cancelled. */
export function statusOptions(editing: boolean): { value: MeetingStatus; label: string }[] {
  return (editing ? ALL_STATUSES : CREATE_STATUSES).map((s) => ({ value: s, label: MEETING_STATUS_LABELS[s] }));
}

/** The form's fields as typed. An end day left blank is the start day. */
export interface MeetingDraft {
  title: string;
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
  location: string;
  onlineLink: string;
  /** '' = a standalone meeting. */
  projectId: string;
  status: MeetingStatus;
  description: string;
  rule: RecurrenceRule | null;
}

/** A new meeting: the next whole hour, no end, scheduled — in the project given, if any. */
export function newMeetingDraft(timeZone: string, now: Date = new Date(), projectId?: string | null): MeetingDraft {
  // (A phone that can't tell company time leaves the start for the person to type.)
  const start = toWallClock(new Date(now.getTime() + 60 * 60_000).toISOString(), timeZone);
  return {
    title: '',
    startDay: start?.day ?? '',
    startTime: start ? `${start.time.slice(0, 2)}:00` : '',
    endDay: '',
    endTime: '',
    location: '',
    onlineLink: '',
    projectId: projectId ?? '',
    status: 'SCHEDULED',
    description: '',
    rule: null,
  };
}

/** An existing meeting as the form opens it (its end day only when it isn't the start day). */
export function draftFromMeeting(m: ApiMeeting, timeZone: string): MeetingDraft {
  const start = toWallClock(m.startAt, timeZone);
  const end = toWallClock(m.endAt, timeZone);
  return {
    title: m.title,
    startDay: start?.day ?? '',
    startTime: start?.time ?? '',
    endDay: end && start && end.day !== start.day ? end.day : '',
    endTime: end?.time ?? '',
    location: m.location ?? '',
    onlineLink: m.onlineLink ?? '',
    projectId: m.projectId ?? '',
    status: m.status,
    description: m.description ?? '',
    rule: meetingRule(m),
  };
}

export type DraftField = 'title' | 'start' | 'end' | 'link' | 'repeat';

export type DraftCheck = { ok: true; payload: MeetingInput; link: string | null } | { ok: false; field: DraftField; message: string };

/**
 * The form checked as the website checks it, and what would be sent: trimmed words, the times in
 * company time with that zone, empty fields as none. A new meeting (or a one-off given a repeat)
 * takes the repeat; one meeting of a series keeps the series' (changed with scope = series).
 */
export function checkMeetingDraft(d: MeetingDraft, opts: { timeZone: string; seriesId: string | null; ruleChanged?: boolean }): DraftCheck {
  const fail = (field: DraftField, message: string): DraftCheck => ({ ok: false, field, message });
  const title = d.title.trim();
  if (!title) return fail('title', 'A meeting title is required.');

  const startDay = parseDueDateInput(d.startDay);
  if (!startDay.ok) return fail('start', startDay.error);
  const startTime = parseTimeInput(d.startTime);
  if (!startTime.ok) return fail('start', startTime.error);
  const startAt = startDay.value && startTime.value ? fromWallClock(startDay.value, startTime.value, opts.timeZone) : null;
  if (!startAt) return fail('start', 'Choose when the meeting starts.');

  const endDay = parseDueDateInput(d.endDay);
  if (!endDay.ok) return fail('end', endDay.error);
  const endTime = parseTimeInput(d.endTime);
  if (!endTime.ok) return fail('end', endTime.error);
  if (endDay.value && !endTime.value) return fail('end', 'Add the end time, or clear the end date.');
  const endAt = endTime.value ? fromWallClock(endDay.value || startDay.value!, endTime.value, opts.timeZone) : null;
  if (endAt && endAt <= startAt) return fail('end', endAt < startAt ? 'The end time can’t be before the start time.' : 'The end time must be after the start time.');

  const link = normalizeMeetingLink(d.onlineLink);
  if (link === undefined) return fail('link', 'Enter a web link that starts with https:// (for example https://meet.google.com/abc-defg-hij).');

  // A new repeat is checked against the day its first meeting will really be on.
  if (d.rule && (!opts.seriesId || opts.ruleChanged)) {
    const day = startDay.value!;
    if (repeatProblem(d.rule, firstMeetingDay(day, d.rule))) return fail('repeat', 'Check the repeat schedule below.');
  }

  const payload: MeetingInput = {
    title,
    startAt,
    endAt,
    timeZone: opts.timeZone,
    location: d.location.trim() || null,
    onlineLink: link,
    projectId: d.projectId || null,
    status: d.status,
    description: d.description.trim() || null,
  };
  if (!opts.seriesId && d.rule) payload.recurrenceRule = d.rule;
  return { ok: true, payload, link };
}

export type SaveRequest =
  | { kind: 'create'; input: MeetingInput }
  | { kind: 'update'; patch: MeetingPatch; scope: SeriesScope }
  /** A series change that changes nothing: nothing to send (and nobody to email). */
  | { kind: 'none' };

/**
 * What saving sends. A change for a whole series carries only what was changed from the meeting as
 * the form opened it, so a meeting of the series changed on its own (another room, say) keeps its
 * other details.
 */
export function saveRequest(f: {
  payload: MeetingInput;
  /** The meeting as the form opened it; null for a new one. */
  meeting: ApiMeeting | null;
  scope: SeriesScope;
  ruleChanged: boolean;
  rule: RecurrenceRule | null;
  timeZone: string;
}): SaveRequest {
  const was = f.meeting;
  if (!was) return { kind: 'create', input: f.payload };
  if (f.scope !== 'series' || !seriesIdOf(was)) return { kind: 'update', patch: f.payload, scope: 'one' };
  const p = f.payload;
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim();
  const clock = (iso: string | null | undefined) => {
    const w = toWallClock(iso, f.timeZone);
    return w ? `${w.day}T${w.time}` : '';
  };
  const changes: MeetingPatch = {};
  if (!same(p.title, was.title)) changes.title = p.title;
  if (clock(p.startAt) !== clock(was.startAt) || clock(p.endAt) !== clock(was.endAt)) Object.assign(changes, { startAt: p.startAt, endAt: p.endAt, timeZone: f.timeZone });
  if (!same(p.location, was.location)) changes.location = p.location;
  if (!same(p.onlineLink, was.onlineLink)) changes.onlineLink = p.onlineLink;
  if ((p.projectId ?? null) !== (was.projectId ?? null)) changes.projectId = p.projectId;
  if (p.status !== was.status) changes.status = p.status;
  if (!same(p.description, was.description)) changes.description = p.description;
  if (f.ruleChanged) changes.recurrenceRule = f.rule;
  return Object.keys(changes).length ? { kind: 'update', patch: changes, scope: 'series' } : { kind: 'none' };
}

/**
 * Whether a new meeting's next try keeps this try's idempotency key: yes while the server may still
 * have the first (no answer came, or it is still being saved) — a repeat then can't schedule it
 * twice; no after a refusal, which the server keeps under its key (a fixed form is a new try).
 */
export function keepsSaveKey(e: unknown): boolean {
  return isNetworkError(e) || (e instanceof ApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS');
}

/** Why a save was refused, in the website's words; offline, that nothing was saved. */
export function saveFailureText(e: unknown, editing: boolean): string {
  if (isNetworkError(e) && (e as { timedOut?: unknown }).timedOut === true) {
    return editing
      ? 'The server took too long to answer — your changes may already be saved. Pull down on the meeting to check.'
      : 'The server took too long to answer — the meeting may already be saved. Tap again to finish: it won’t be scheduled twice.';
  }
  if (isNetworkError(e)) {
    // A new meeting's try may still have reached the server: the retry goes under the same key.
    return editing
      ? 'You’re offline — this needs a connection. Nothing was saved; try again when you’re online.'
      : 'You’re offline — this needs a connection. Tap “Schedule meeting” again when you’re online: it won’t be scheduled twice.';
  }
  if (e instanceof ApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS') return 'The meeting is still being saved — try again in a moment.';
  if (e instanceof ApiError && e.status === 403) return editing ? 'You don’t have permission to change this meeting.' : 'You don’t have access to that project.';
  if (e instanceof ApiError && e.status === 400 && e.message && !/^Request failed/.test(e.message)) return e.message;
  return editing ? 'Couldn’t save changes. Check the title, times and link.' : 'Couldn’t create the meeting. Check the title, times and link.';
}

/** Said under a locked form (afterSaveFailure). */
export const LOCKED_FORM_NOTE = 'Until it is saved, this form can’t be changed — if the first try reached the server, a change made now would be lost. You can change the meeting once it is saved.';

/**
 * What a failed save leaves (2b review). A new meeting whose try got no answer (or is still being
 * saved) keeps its key, so the next tap can't schedule it twice — and because the server matches
 * that key and not what is sent, a corrected retry would bring back the first meeting and silently
 * drop the correction. So the form is locked until a definite answer: nothing typed is ever lost
 * (the people and agenda of a new meeting included), and it can be changed once saved. A refusal
 * is a definite answer: a new key, and the form unlocks to be fixed. Changes to an existing meeting
 * are sent whole each time, so they never lock.
 */
export function afterSaveFailure(e: unknown, editing: boolean): { keepKey: boolean; lock: boolean; message: string } {
  const keepKey = keepsSaveKey(e);
  return { keepKey, lock: !editing && keepKey, message: saveFailureText(e, editing) };
}
