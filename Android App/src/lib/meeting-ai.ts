/**
 * Meeting AI and scheduling help in the app's meeting form (2c), as on the website (MeetingFormModal
 * and components/meeting-form): "Describe the meeting" fills the form from a sentence — reviewed
 * first, and only over what the person hasn't set themselves; a new meeting's People and Agenda,
 * saved with it in one request; free times (three suggestions, who clashes, the day's busy blocks —
 * worked out by the server, no AI); "Write description"; and "Draft agenda" (in the form and on the
 * meeting's page), reviewed before anything is added. Pure, so it is tested here.
 */
import { ApiError, isNetworkError } from './api-client';
import { normalizeDigits, parseDueDateInput } from './form-input';
import { fromWallClock, meetingRepeatText, parseTimeInput, toWallClock, type MeetingDraft } from './meeting-form';
import { meetingWhen } from './meeting-detail';
import { meetingFailure } from './meeting-flow';
import { keptTryText } from './pending-keys';
import { meetingTime } from './meetings';
import { recurrenceSummary } from './recurrence-summary';
import { AI_DESCRIPTION_MAX, AI_SENTENCE_MAX } from './resources';
import {
  displayName,
  type AiAgendaItem,
  type AiDraftAgendaInput,
  type AiMeetingDraft,
  type ApiDirectoryUser,
  type ApiMeeting,
  type ApiMeetingAttendee,
  type AttendeeRole,
  type FreeTimesInput,
  type FreeTimesReply,
  type MeetingInput,
  type RecurrenceRule,
} from './types';

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const unique = <T>(xs: T[]) => [...new Set(xs)];
/** The server's limit for an agenda topic's title. */
const TOPIC_MAX = 300;

// ── People ──────────────────────────────────────────────────────────────────

/** Someone invited from the new-meeting form: a team member, or an outside guest by email. */
export type MeetingPerson = { kind: 'user'; id: string; name: string; role: AttendeeRole } | { kind: 'guest'; email: string; name: string; role: AttendeeRole };

export const personKey = (p: MeetingPerson): string => (p.kind === 'user' ? `u:${p.id}` : `e:${p.email.toLowerCase()}`);

/** An address the server takes: no spaces, one @, and a domain of dot-separated parts (none empty). */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** The server's limits for a new meeting's people and agenda (more can be added on its page). */
export const PEOPLE_MAX = 100;
export const AGENDA_MAX = 50;
const GUEST_NAME_MAX = 200;

/**
 * The team members who can be invited: active ones (an older server sends no flag: offered), not
 * the organizer (always in), and not already invited — by name.
 */
export function invitableOptions(directory: ApiDirectoryUser[], organizerId: string | null, people: MeetingPerson[]): { value: string; label: string; hint: string }[] {
  const chosen = new Set(people.map(personKey));
  return directory
    .filter((u) => u.id !== organizerId && u.active !== false && !chosen.has(`u:${u.id}`))
    .map((u) => ({ value: u.id, label: displayName(u), hint: `@${u.username}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function addTeamMember(people: MeetingPerson[], directory: ApiDirectoryUser[], id: string): MeetingPerson[] {
  const u = directory.find((d) => d.id === id);
  if (!u || people.length >= PEOPLE_MAX || people.some((p) => p.kind === 'user' && p.id === id)) return people;
  return [...people, { kind: 'user', id, name: displayName(u), role: 'REQUIRED' }];
}

export const PEOPLE_FULL = 'Up to 100 people can be added here — add more from the meeting’s page once it is saved.';
export const AGENDA_FULL = 'Up to 50 agenda items can be added here — add more from the meeting’s page once it is saved.';

/** A guest by email, named from the part before the @ unless a name is given. */
export function addGuest(people: MeetingPerson[], email: string, name: string): { ok: true; people: MeetingPerson[] } | { ok: false; error: string } {
  const e = email.trim();
  if (!EMAIL_RE.test(e)) return { ok: false, error: 'Enter a valid email address, for example name@company.com.' };
  if (people.some((p) => p.kind === 'guest' && p.email.toLowerCase() === e.toLowerCase())) return { ok: false, error: 'That guest is already invited.' };
  if (people.length >= PEOPLE_MAX) return { ok: false, error: PEOPLE_FULL };
  return { ok: true, people: [...people, { kind: 'guest', email: e, name: (name.trim() || e.split('@')[0]!).slice(0, GUEST_NAME_MAX), role: 'REQUIRED' }] };
}

/** Who may lead an agenda item: the organizer (first, "you") and the invited team members. */
export function agendaLeads(organizerId: string | null, organizerName: string | null, people: MeetingPerson[]): { id: string; name: string }[] {
  return [
    ...(organizerId ? [{ id: organizerId, name: organizerName ? `${organizerName} (you)` : 'You' }] : []),
    ...people.flatMap((p) => (p.kind === 'user' && p.id !== organizerId ? [{ id: p.id, name: p.name }] : [])),
  ];
}

/** The people changed: someone taken off the list no longer leads their agenda items. */
export function withPeople(people: MeetingPerson[], agenda: AgendaDraft[], organizerId: string | null): { people: MeetingPerson[]; agenda: AgendaDraft[] } {
  const still = new Set([organizerId, ...people.flatMap((p) => (p.kind === 'user' ? [p.id] : []))]);
  const next = agenda.map((i) => (i.ownerId && !still.has(i.ownerId) ? { ...i, ownerId: null } : i));
  return { people, agenda: next.some((i, n) => i !== agenda[n]) ? next : agenda };
}

// ── The agenda ──────────────────────────────────────────────────────────────

/** An agenda item in the new-meeting form, before the meeting is saved. */
export interface AgendaDraft {
  /** Stable while the item is edited or moved (not saved). */
  key: string;
  title: string;
  ownerId: string | null;
  minutes: number | null;
}

let seq = 0;
export const newAgendaKey = () => `draft-${Date.now().toString(36)}-${++seq}`;

/** Minutes as typed ("" = none; Arabic digits too), between 1 and 600. */
export function agendaMinutesInput(v: string): number | null {
  const digits = normalizeDigits(v).replace(/[^\d]/g, '');
  if (!digits) return null;
  return clamp(Number(digits) || 1, 1, 600);
}

export function addAgendaTopic(agenda: AgendaDraft[], title: string): { ok: true; agenda: AgendaDraft[] } | { ok: false; error: string } {
  const t = title.trim();
  if (!t) return { ok: false, error: 'Enter an agenda item.' };
  if (agenda.length >= AGENDA_MAX) return { ok: false, error: AGENDA_FULL };
  return { ok: true, agenda: [...agenda, { key: newAgendaKey(), title: t.slice(0, TOPIC_MAX), ownerId: null, minutes: null }] };
}

export function moveAgendaDraft(agenda: AgendaDraft[], index: number, by: -1 | 1): AgendaDraft[] {
  const to = index + by;
  if (index < 0 || index >= agenda.length || to < 0 || to >= agenda.length) return agenda;
  const next = [...agenda];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return next;
}

/** "Total 70 of 60 minutes" — over when the topics take longer than the meeting. */
export function agendaTotal(agenda: AgendaDraft[], length: number): { text: string; over: boolean } {
  const planned = agenda.reduce((s, i) => s + (i.minutes ?? 0), 0);
  return { text: `Total ${planned} of ${length} minutes`, over: planned > length };
}

/** The new meeting's people and agenda, sent with it in the one request (topics without a title are left out). */
export function newMeetingExtras(people: MeetingPerson[], agenda: AgendaDraft[]): Pick<MeetingInput, 'attendees' | 'agendaItems'> {
  const out: Pick<MeetingInput, 'attendees' | 'agendaItems'> = {};
  if (people.length) out.attendees = people.map((p) => (p.kind === 'user' ? { userId: p.id, role: p.role } : { externalEmail: p.email, externalName: p.name, role: p.role }));
  const items = agenda.filter((i) => i.title.trim());
  if (items.length) out.agendaItems = items.map((i) => ({ title: i.title.trim().slice(0, TOPIC_MAX), ownerId: i.ownerId, expectedMinutes: i.minutes }));
  return out;
}

// ── The form's times ────────────────────────────────────────────────────────

/** The form's start and end as "YYYY-MM-DDTHH:MM" in company time ('' when not given or not valid). */
function localTimes(d: MeetingDraft): { start: string; end: string } {
  const day = parseDueDateInput(d.startDay);
  const time = parseTimeInput(d.startTime);
  const endDay = parseDueDateInput(d.endDay);
  const endTime = parseTimeInput(d.endTime);
  const startDay = day.ok && day.value ? day.value : '';
  const start = startDay && time.ok && time.value ? `${startDay}T${time.value}` : '';
  const endOn = endDay.ok && endDay.value ? endDay.value : startDay;
  const end = endTime.ok && endTime.value && endOn ? `${endOn}T${endTime.value}` : '';
  return { start, end };
}

const instant = (local: string, timeZone: string): string | null => (local ? fromWallClock(local.slice(0, 10), local.slice(11, 16), timeZone) : null);

/** The form's start as an instant, or null while it isn't valid. */
export function startIsoOf(d: MeetingDraft, timeZone: string): string | null {
  return instant(localTimes(d).start, timeZone);
}

/** Minutes from the form's start to its end, or null without a (later) end. */
function lengthOfDraft(d: MeetingDraft, timeZone: string): number | null {
  const { start, end } = localTimes(d);
  const a = instant(start, timeZone);
  const b = instant(end, timeZone);
  return a && b && b > a ? Math.round((Date.parse(b) - Date.parse(a)) / 60_000) : null;
}

/** The meeting's length in minutes: from its start to its end — an hour when no end is set. */
export function meetingMinutes(d: MeetingDraft, timeZone: string): number {
  return lengthOfDraft(d, timeZone) ?? 60;
}

/** The form with its start at `startIso`, and its end `length` minutes later when one is given. */
function withStart(d: MeetingDraft, startIso: string, length: number | null, timeZone: string): MeetingDraft {
  const s = toWallClock(startIso, timeZone);
  if (!s) return d;
  const next: MeetingDraft = { ...d, startDay: s.day, startTime: s.time };
  if (!length) return next;
  const e = toWallClock(new Date(Date.parse(startIso) + length * 60_000).toISOString(), timeZone);
  return e ? { ...next, endTime: e.time, endDay: e.day !== s.day ? e.day : '' } : next;
}

/** A suggested free time picked: the start moves there, and an end set keeps the meeting's length. */
export function pickedTime(d: MeetingDraft, startIso: string, timeZone: string): MeetingDraft {
  return withStart(d, startIso, lengthOfDraft(d, timeZone), timeZone);
}

/** "Thu, Oct 22 · 10:00 – 11:00" in company time. */
export function rangeText(startIso: string, endIso: string | null, timeZone: string): string {
  const w = meetingWhen({ startAt: startIso, endAt: endIso }, timeZone);
  return w.day ? `${w.day} · ${w.time}` : '';
}

// ── Describe the meeting ────────────────────────────────────────────────────

/** The form's values a sentence can fill in (start and end as company-time "YYYY-MM-DDTHH:MM"). */
export interface DescribeFields {
  title: string;
  description: string;
  start: string;
  end: string;
  rule: RecurrenceRule | null;
  projectId: string;
  location: string;
  onlineLink: string;
}

/** Describe's "not yours" baseline: every field empty. */
const UNSET: DescribeFields = { title: '', description: '', start: '', end: '', rule: null, projectId: '', location: '', onlineLink: '' };

export function describeFields(d: MeetingDraft): DescribeFields {
  const { start, end } = localTimes(d);
  return { title: d.title, description: d.description, start, end, rule: d.rule, projectId: d.projectId, location: d.location, onlineLink: d.onlineLink };
}

/**
 * What isn't the person's own, so a suggestion may start ticked over it: as on the website, nothing
 * in an existing meeting (its saved details are theirs), nor a project the screen chose; only a new
 * meeting's untouched times (the next whole hour).
 */
export function describeBaseline(d: MeetingDraft, o: { editing: boolean; timesTouched: boolean }): DescribeFields {
  if (o.editing || o.timesTouched) return UNSET;
  const { start, end } = localTimes(d);
  return { ...UNSET, start, end };
}

type DescribeField = 'title' | 'description' | 'start' | 'minutes' | 'rule' | 'projectId' | 'location' | 'onlineLink';

/** One thing found in the sentence, to tick (or, for a shared name, to choose) before it is used. */
export type DescribeSuggestion =
  | { kind: 'field'; key: DescribeField; field: DescribeField; label: string; shown: string; value: unknown; replaces: string | null; checked: boolean }
  | { kind: 'person'; key: string; label: 'Person' | 'Guest'; shown: string; person: MeetingPerson; checked: boolean }
  | { kind: 'choice'; key: string; said: string; options: Array<{ id: string; name: string; username?: string }>; chosen: string | null }
  | { kind: 'agenda'; key: string; shown: string; checked: boolean };

/** What "Use selected details" hands the form: fields, a length, and people and topics to add. */
export interface DescribedPatch {
  title?: string;
  description?: string;
  start?: string;
  minutes?: number;
  rule?: RecurrenceRule | null;
  projectId?: string;
  location?: string;
  onlineLink?: string;
  people?: MeetingPerson[];
  agenda?: string[];
}

const sameRule = (a: RecurrenceRule | null, b: RecurrenceRule | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Minutes between two of the form's local times, or null. */
const lengthOf = (start: string, end: string) => {
  const a = Date.parse(`${start}:00Z`);
  const b = Date.parse(`${end}:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b - a) / 60_000) : null;
};

/**
 * The website's suggestions, in its order: title, when, length, repeat, project, place, link,
 * description — and in a new meeting the people found, a choice for each shared name, the guests
 * and the agenda topics. One that would replace something the person set themselves starts
 * unticked (and says what it replaces); someone already invited isn't offered again; a project
 * outside the person's list is left out.
 */
export function describeSuggestions(
  d: AiMeetingDraft,
  ctx: {
    current: DescribeFields;
    initial: DescribeFields;
    withPeopleAndAgenda: boolean;
    projects: Array<{ id: string; name: string; code: string; number?: string | null }>;
    people: MeetingPerson[];
    timeZone: string;
  },
): DescribeSuggestion[] {
  const { current, initial, timeZone } = ctx;
  const out: DescribeSuggestion[] = [];
  const field = (f: DescribeField, label: string, shown: string, value: unknown, replaces: string | null, mine: boolean) =>
    out.push({ kind: 'field', key: f, field: f, label, shown, value, replaces, checked: !mine });
  const whenText = (local: string) => rangeText(instant(local, timeZone) ?? '', null, timeZone);
  const startIso = instant(current.start, timeZone);
  const repeatText = (r: RecurrenceRule) => (startIso ? meetingRepeatText(r, startIso, timeZone) : recurrenceSummary(r));

  const title = d.title?.trim().slice(0, 191);
  if (title && title !== current.title.trim()) field('title', 'Title', title, title, current.title.trim() ? `“${current.title.trim()}”` : null, current.title.trim() !== '' && current.title !== initial.title);
  const day = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : current.start.slice(0, 10);
  const time = d.startTime && /^\d{2}:\d{2}$/.test(d.startTime) ? d.startTime : current.start.slice(11, 16);
  if ((d.date || d.startTime) && day && time && instant(`${day}T${time}`, timeZone)) {
    const start = `${day}T${time}`;
    if (start !== current.start) field('start', 'When', whenText(start), start, current.start ? whenText(current.start) : null, current.start !== initial.start);
  }
  const length = lengthOf(current.start, current.end);
  if (d.minutes && d.minutes > 0 && d.minutes !== length) {
    field('minutes', 'Length', `${d.minutes} minutes`, d.minutes, length ? `${length} minutes` : null, current.end !== '' && current.end !== initial.end);
  }
  if (d.recurrence && !sameRule(d.recurrence, current.rule)) {
    field('rule', 'Repeat', repeatText(d.recurrence), d.recurrence, current.rule ? repeatText(current.rule) : null, current.rule !== null && !sameRule(current.rule, initial.rule));
  }
  const project = d.project ? ctx.projects.find((p) => p.id === d.project!.id) : undefined;
  if (project && project.id !== current.projectId) {
    const now = ctx.projects.find((p) => p.id === current.projectId);
    field('projectId', 'Project', [project.name, project.code, project.number].filter(Boolean).join(' · '), project.id, now ? now.name : null, current.projectId !== '' && current.projectId !== initial.projectId);
  }
  const location = d.location?.trim();
  if (location && location !== current.location.trim()) field('location', 'Location', location, location, current.location.trim() ? `“${current.location.trim()}”` : null, current.location.trim() !== '' && current.location !== initial.location);
  const link = d.onlineLink?.trim();
  if (link && link !== current.onlineLink.trim()) field('onlineLink', 'Online link', link, link, current.onlineLink.trim() || null, current.onlineLink.trim() !== '' && current.onlineLink !== initial.onlineLink);
  const description = d.description?.trim();
  if (description && description !== current.description.trim()) {
    field('description', 'Description', clip(description, 200), description, current.description.trim() ? `“${clip(current.description.trim(), 60)}”` : null, current.description.trim() !== '' && current.description !== initial.description);
  }
  if (ctx.withPeopleAndAgenda) {
    const have = new Set(ctx.people.map(personKey));
    const offer = (person: MeetingPerson, label: 'Person' | 'Guest', shown: string) => {
      const key = personKey(person);
      if (have.has(key)) return;
      have.add(key);
      out.push({ kind: 'person', key, label, shown, person, checked: true });
    };
    for (const p of d.people?.found ?? []) offer({ kind: 'user', id: p.id, name: p.name, role: 'REQUIRED' }, 'Person', p.name);
    (d.people?.choices ?? []).forEach((c, i) => out.push({ kind: 'choice', key: `choice-${i}`, said: c.said, options: c.options, chosen: null }));
    for (const g of d.guests ?? []) {
      if (!EMAIL_RE.test(g.email ?? '')) continue;
      const name = (g.name?.trim() || g.email.split('@')[0]!).slice(0, GUEST_NAME_MAX);
      offer({ kind: 'guest', email: g.email, name, role: 'REQUIRED' }, 'Guest', `${name} (${g.email})`);
    }
    (d.agenda ?? []).forEach((a, i) => {
      if (a?.trim()) out.push({ kind: 'agenda', key: `agenda-${i}`, shown: a.trim().slice(0, TOPIC_MAX), checked: true });
    });
  }
  return out;
}

/** Is this suggestion going to be used (ticked, or a person chosen)? */
export const isChosen = (s: DescribeSuggestion): boolean => (s.kind === 'choice' ? s.chosen !== null : s.checked);

/** The ticked suggestions, as what the form takes. */
export function chosenPatch(found: DescribeSuggestion[]): DescribedPatch {
  const patch: DescribedPatch = {};
  const add: MeetingPerson[] = [];
  const agenda: string[] = [];
  for (const s of found) {
    if (!isChosen(s)) continue;
    if (s.kind === 'field') (patch as Record<string, unknown>)[s.field] = s.value;
    else if (s.kind === 'person') add.push(s.person);
    else if (s.kind === 'choice') {
      const o = s.options.find((x) => x.id === s.chosen);
      if (o) add.push({ kind: 'user', id: o.id, name: o.name, role: 'REQUIRED' });
    } else agenda.push(s.shown);
  }
  if (add.length) patch.people = add.filter((p, i) => add.findIndex((q) => personKey(q) === personKey(p)) === i);
  if (agenda.length) patch.agenda = agenda;
  return patch;
}

/** The form as "Use selected details" leaves it. */
export interface DescribeState {
  draft: MeetingDraft;
  people: MeetingPerson[];
  agenda: AgendaDraft[];
}

/**
 * The ticked suggestions put into the form: its fields; a new start (a length given sets the end,
 * otherwise an end already set keeps the meeting's length); the people added (once each); the
 * topics added to the end of the agenda.
 */
export function applyDescribed(s: DescribeState, patch: DescribedPatch, ctx: { timeZone: string; organizerId: string | null }): DescribeState {
  let draft: MeetingDraft = { ...s.draft };
  if (patch.title !== undefined) draft.title = patch.title;
  if (patch.description !== undefined) draft.description = patch.description;
  if (patch.location !== undefined) draft.location = patch.location;
  if (patch.onlineLink !== undefined) draft.onlineLink = patch.onlineLink;
  if (patch.projectId !== undefined) draft.projectId = patch.projectId;
  if (patch.rule !== undefined) draft.rule = patch.rule;
  if (patch.start !== undefined || patch.minutes !== undefined) {
    const from = instant(patch.start ?? localTimes(s.draft).start, ctx.timeZone);
    if (from) draft = withStart(draft, from, patch.minutes ?? lengthOfDraft(s.draft, ctx.timeZone), ctx.timeZone);
  }
  // Within the server's limits for a new meeting (more can be added on its page).
  let people = s.people;
  for (const p of patch.people ?? []) if (people.length < PEOPLE_MAX && !people.some((q) => personKey(q) === personKey(p))) people = [...people, p];
  const topics = (patch.agenda ?? []).slice(0, Math.max(0, AGENDA_MAX - s.agenda.length));
  const agenda = [...s.agenda, ...topics.map((t) => ({ key: newAgendaKey(), title: t, ownerId: null, minutes: null }))];
  return { draft, ...withPeople(people, agenda, ctx.organizerId) };
}

// ── Draft agenda ────────────────────────────────────────────────────────────

/**
 * "Draft agenda" in the form: from the title, description and sentence, the project, the start and
 * length, and the people who may lead. Says what is missing first (the button waits).
 */
export function formAgendaRequest(o: { draft: MeetingDraft; timeZone: string; sentence: string; leads: { id: string; name?: string }[] }): { ok: true; input: AiDraftAgendaInput } | { ok: false; hint: string } {
  const title = o.draft.title.trim();
  if (!title) return { ok: false, hint: 'Add a title first.' };
  const startAt = startIsoOf(o.draft, o.timeZone);
  if (!startAt) return { ok: false, hint: 'Choose when it starts first.' };
  const description = o.draft.description.trim();
  const text = o.sentence.trim();
  return {
    ok: true,
    input: {
      title: title.slice(0, TOPIC_MAX),
      ...(description ? { description: description.slice(0, AI_DESCRIPTION_MAX) } : {}),
      ...(text ? { text: text.slice(0, AI_SENTENCE_MAX) } : {}),
      projectId: o.draft.projectId || null,
      startAt,
      minutes: clamp(meetingMinutes(o.draft, o.timeZone), 5, 720),
      peopleIds: unique(o.leads.map((l) => l.id)).slice(0, 100),
    },
  };
}

/**
 * "Draft agenda" on the meeting's page: its details, its organizer and invited team members (the
 * only possible leads), and its id — the series' previous meeting gives the leftovers.
 */
export function pageAgendaRequest(m: Pick<ApiMeeting, 'id' | 'title' | 'description' | 'projectId' | 'startAt' | 'endAt' | 'organizerId'>, attendees: Pick<ApiMeetingAttendee, 'userId'>[]): AiDraftAgendaInput {
  const length = m.endAt ? Math.round((Date.parse(m.endAt) - Date.parse(m.startAt)) / 60_000) : NaN;
  const description = m.description?.trim();
  return {
    title: m.title.trim().slice(0, TOPIC_MAX),
    ...(description ? { description: description.slice(0, AI_DESCRIPTION_MAX) } : {}),
    projectId: m.projectId ?? null,
    startAt: m.startAt,
    minutes: clamp(Number.isFinite(length) && length > 0 ? length : 60, 5, 720),
    peopleIds: unique([m.organizerId, ...attendees.flatMap((a) => (a.userId ? [a.userId] : []))]).slice(0, 100),
    meetingId: m.id,
  };
}

/** The ticked drafted items added to the form's agenda; a lead is kept only when they may lead. */
export function addDraftedItems(agenda: AgendaDraft[], chosen: AiAgendaItem[], leads: { id: string; name?: string }[]): AgendaDraft[] {
  const may = new Set(leads.map((l) => l.id));
  return [
    ...agenda,
    ...chosen
      .filter((c) => c.title?.trim())
      .slice(0, Math.max(0, AGENDA_MAX - agenda.length))
      .map((c) => ({
        key: newAgendaKey(),
        title: c.title.trim().slice(0, TOPIC_MAX),
        ownerId: c.ownerId && may.has(c.ownerId) ? c.ownerId : null,
        minutes: c.minutes > 0 ? clamp(Math.round(c.minutes), 1, 600) : null,
      })),
  ];
}

/**
 * Add items one after another (the drafted agenda, on the meeting's page). On a failure, says which
 * were added and which are left, so a second try adds only those — never one twice.
 */
export async function addInTurn<T>(items: T[], add: (item: T) => Promise<unknown>): Promise<{ added: T[]; left: T[]; error: unknown }> {
  const added: T[] = [];
  for (let i = 0; i < items.length; i += 1) {
    try {
      await add(items[i]!);
      added.push(items[i]!);
    } catch (error) {
      return { added, left: items.slice(i), error };
    }
  }
  return { added, left: [], error: null };
}

// ── Free times ──────────────────────────────────────────────────────────────

/**
 * What free times are asked for: the organizer and the invited team members (guests have no known
 * calendar), the start and length (5 minutes to 12 hours), a new series' repeat (one meeting of a
 * series keeps the series'), and — editing — the meeting itself, whose own time isn't a clash.
 * Null while the start isn't valid.
 */
export function freeTimesInput(o: {
  organizerId: string | null;
  userIds: string[];
  startAt: string | null;
  minutes: number;
  rule: RecurrenceRule | null;
  seriesId: string | null;
  meetingId?: string;
}): FreeTimesInput | null {
  const userIds = unique([...(o.organizerId ? [o.organizerId] : []), ...o.userIds]).slice(0, 50);
  if (!o.startAt || userIds.length === 0) return null;
  return {
    userIds,
    startAt: o.startAt,
    minutes: clamp(Math.round(o.minutes), 5, 720),
    ...(o.rule && !o.seriesId ? { recurrenceRule: o.rule } : {}),
    ...(o.meetingId ? { excludeMeetingId: o.meetingId } : {}),
  };
}

/** The server's answer, read warily: an older server (or a Wi-Fi page) may answer with something else. */
export function readFreeTimes(reply: unknown): FreeTimesReply | undefined {
  const r = reply as Partial<FreeTimesReply> | null | undefined;
  return r && typeof r === 'object' && Array.isArray(r.suggestions) && Array.isArray(r.clashes) && Array.isArray(r.day) && r.workingHours ? (r as FreeTimesReply) : undefined;
}

/** "Omar Said — Thu, Oct 22 · 10:00 – 11:00 (Board review)" — a meeting this person can't see is "Busy". */
export function clashLine(c: FreeTimesReply['clashes'][number], timeZone: string): string {
  return `${c.name} — ${rangeText(c.start, c.end, timeZone)} (${c.title ?? 'Busy'})`;
}

/** Each invited person's meetings on the chosen day, in words. */
export function busyLines(day: FreeTimesReply['day'], timeZone: string): { userId: string; name: string; text: string }[] {
  return day.map((p) => ({
    userId: p.userId,
    name: p.name,
    text: p.blocks.length ? p.blocks.map((b) => `${meetingTime({ startAt: b.start, endAt: b.end }, timeZone)} ${b.title ?? 'Busy'}`).join('; ') : 'No meetings',
  }));
}

// ── When a helper can't answer ──────────────────────────────────────────────

/**
 * What to say when an AI helper fails: the server's own words ("AI is not configured yet…"), the AI
 * being slow, that it needs a connection — else `fallback`.
 */
export function meetingAiFailure(e: unknown, fallback: string): string {
  if (isNetworkError(e) && (e as { timedOut?: unknown }).timedOut === true) return 'The AI is taking longer than usual. Please try again in a minute.';
  if (isNetworkError(e)) return 'You’re offline — the AI helpers need a connection. Try again when you’re online.';
  if (e instanceof ApiError && e.message && !/^Request failed/.test(e.message)) return e.message;
  return fallback;
}

export function freeTimesFailure(e: unknown): string {
  return isNetworkError(e) ? 'Free times need a connection — try again when you’re online.' : 'Couldn’t check free times. Please try again.';
}

/**
 * What "Write description" writes from: the title, the agenda's topics and the sentence (within the
 * server's limits). Null without a title (the button waits).
 */
export function descriptionRequest(o: { title: string; agenda: AgendaDraft[]; sentence: string }): { title: string; agenda?: string[]; text?: string } | null {
  const title = o.title.trim();
  if (!title) return null;
  const topics = o.agenda.map((i) => i.title.trim().slice(0, TOPIC_MAX)).filter(Boolean).slice(0, 30);
  const text = o.sentence.trim().slice(0, AI_SENTENCE_MAX);
  return { title: title.slice(0, TOPIC_MAX), ...(topics.length ? { agenda: topics } : {}), ...(text ? { text } : {}) };
}

/**
 * The drafted agenda wasn't all added (on the meeting's page): how many were, and why the rest
 * weren't. The rest stay in the review, so tapping "Add selected" again adds only those — each
 * with the key of its try, so one that timed out but was saved isn't added twice.
 */
export function draftAddText(added: number, total: number, error: unknown): string {
  const why = keptTryText(error, 'Couldn’t add all of the drafted items.', 'Add selected', meetingFailure);
  return added > 0 ? `Added ${added} of ${total}. ${why}` : why;
}

/**
 * What "Suggest 3 times" shows. Until the time, length, repeat and people have settled (the 400 ms
 * wait), and while asking, it is "finding" — never an error or the answer for what was there before.
 */
export function freeTimesView(o: { shown: boolean; settled: boolean; fetching: boolean; error: unknown; data: FreeTimesReply | undefined }): 'hidden' | 'error' | 'finding' | 'suggestions' | 'none' {
  if (!o.shown) return 'hidden';
  if (!o.settled || o.fetching) return 'finding';
  if (o.error) return 'error';
  if (!o.data) return 'finding';
  return o.data.suggestions.length ? 'suggestions' : 'none';
}

/** Asking (again) checks afresh — someone may have booked a meeting — once what is asked for has settled. */
export function recheckFreeTimes(o: { shown: boolean; stale: boolean; settled: boolean }): boolean {
  return o.settled && (o.shown || o.stale);
}
