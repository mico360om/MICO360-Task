/**
 * Meetings, as the website shows them (Web Portal/frontend/src/lib/meeting-list.ts, meetingFormat.ts,
 * meeting-repeat.ts, meeting-flow.ts, components/meeting/*), for the extension's light meetings: the
 * next one ("Up next"), the upcoming ones by day, when and where, Join, who's coming, and your answer
 * to the invitation. src/meetings.test.js runs these and the web's over the same inputs. Pure (no DOM).
 */
import { todayKey, zonedDayKey, shiftDayKey, zonedStartOfDay } from './due-date.js';
import { recurrenceSummary } from './recurrence.js';

export const MEETING_STATUS_LABELS = { DRAFT: 'Draft', SCHEDULED: 'Scheduled', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export const RESPONSE_LABELS = { PENDING: 'No response', ACCEPTED: 'Accepted', TENTATIVE: 'Maybe', DECLINED: 'Declined' };

/** A code this version doesn't know, in plain words: "ON_HOLD" → "On hold". */
function plainWords(code) {
  if (typeof code !== 'string' || !code) return '';
  const words = code.replace(/_/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const meetingStatusLabel = (s) => MEETING_STATUS_LABELS[s] || plainWords(s);
export const responseLabel = (r) => RESPONSE_LABELS[r || 'PENDING'] || plainWords(r);

// ---- days and times (the web's formats, in the zone given) ----------------------------------

const fmtCache = new Map();
function fmt(kind, timeZone) {
  const key = `${kind}|${timeZone || ''}`;
  let f = fmtCache.get(key);
  if (!f) {
    const opts = kind === 'date' ? { weekday: 'short', month: 'short', day: 'numeric' }
      : kind === 'time' ? { hour: 'numeric', minute: '2-digit' }
        : { year: 'numeric', month: '2-digit', day: '2-digit' };
    try {
      f = new Intl.DateTimeFormat(kind === 'day' ? 'en-CA' : undefined, timeZone ? { ...opts, timeZone } : opts);
    } catch {
      f = new Intl.DateTimeFormat(kind === 'day' ? 'en-CA' : undefined, opts); // an unknown zone: the device's
    }
    fmtCache.set(key, f);
  }
  return f;
}

/** "Thu, Oct 1" — the meeting's day. */
export function formatMeetingDay(startAt, timeZone) {
  const d = new Date(startAt);
  return Number.isNaN(d.getTime()) ? '' : fmt('date', timeZone).format(d);
}

/** "10:00 AM – 11:30 AM" (the end day named when it runs past midnight). */
export function formatMeetingTimes(startAt, endAt, timeZone) {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return '';
  const startTime = fmt('time', timeZone).format(start);
  const end = endAt ? new Date(endAt) : null;
  if (!end || Number.isNaN(end.getTime())) return startTime;
  const sameDay = fmt('day', timeZone).format(start) === fmt('day', timeZone).format(end);
  const endTime = fmt('time', timeZone).format(end);
  return sameDay ? `${startTime} – ${endTime}` : `${startTime} – ${fmt('date', timeZone).format(end)} ${endTime}`;
}

export function formatClockTime(iso, timeZone) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : fmt('time', timeZone).format(d);
}

// ---- when -----------------------------------------------------------------------------------

const HOUR = 3600000;
const MINUTE = 60000;

/** Started and not yet ended (a meeting without an end lasts an hour), or marked in progress. */
export function isUnderWay(m, now) {
  if (m.status === 'IN_PROGRESS') return true;
  if (m.status !== 'SCHEDULED') return false;
  const start = new Date(m.startAt).getTime();
  const end = m.endAt ? new Date(m.endAt).getTime() : start + HOUR;
  return start <= now.getTime() && now.getTime() < end;
}

/** "Up next": one under way (the earliest), else the soonest scheduled one to come. */
export function nextUpMeeting(list, now) {
  const byStart = (a, b) => a.startAt.localeCompare(b.startAt);
  const live = list.filter((m) => isUnderWay(m, now)).sort(byStart);
  if (live[0]) return live[0];
  return list.filter((m) => m.status === 'SCHEDULED' && new Date(m.startAt).getTime() > now.getTime()).sort(byStart)[0] || null;
}

const dayWords = (key, opts) => new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));

/** "Happening now", "in 25 min", "Tomorrow at 10:00", "Tue 20 Oct at 10:00". */
export function startsLabel(m, now, timeZone) {
  if (isUnderWay(m, now)) return 'Happening now';
  const ms = new Date(m.startAt).getTime() - now.getTime();
  if (ms < MINUTE) return 'Starting now';
  if (ms < HOUR) return `in ${Math.floor(ms / MINUTE)} min`;
  const today = todayKey(timeZone, now);
  const day = zonedDayKey(new Date(m.startAt), timeZone);
  const time = formatClockTime(m.startAt, timeZone);
  if (day === today) return `Today at ${time}`;
  if (day === shiftDayKey(today, 1)) return `Tomorrow at ${time}`;
  if (day > today && day <= shiftDayKey(today, 6)) return `${dayWords(day, { weekday: 'long' })} at ${time}`;
  return `${dayWords(day, { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')} at ${time}`;
}

const byStartAt = (a, b) => a.startAt.localeCompare(b.startAt);
const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
const byUpdated = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
const GROUP_LABELS = { today: 'Today', next7: 'Next 7 days', later: 'Later', drafts: 'Drafts', past: 'Past' };

/** Today, Next 7 days, Later, Drafts and Past (empty groups left out), as on the web. */
export function groupMeetings(list, ctx, sort) {
  const today = todayKey(ctx.timeZone, ctx.now);
  const weekEnd = shiftDayKey(today, 7);
  const buckets = { today: [], next7: [], later: [], drafts: [], past: [] };
  for (const m of list) {
    if (m.status === 'DRAFT') buckets.drafts.push(m);
    else {
      const day = zonedDayKey(new Date(m.startAt), ctx.timeZone);
      buckets[day === today ? 'today' : day < today ? 'past' : day <= weekEnd ? 'next7' : 'later'].push(m);
    }
  }
  const order = (key, items) => {
    if (sort === 'title') return [...items].sort(byTitle);
    if (sort === 'updated') return [...items].sort(byUpdated);
    return key === 'past' ? [...items].sort(byStartAt).reverse() : [...items].sort(byStartAt);
  };
  return ['today', 'next7', 'later', 'drafts', 'past']
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABELS[k], items: order(k, buckets[k]) }));
}

/** The extension's list: what is coming (Today, Next 7 days, Later). Drafts and past ones are on the website. */
export function upcomingGroups(list, ctx) {
  return groupMeetings(list, ctx, 'date').filter((g) => g.key === 'today' || g.key === 'next7' || g.key === 'later');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (key) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** "Repeats every week on Tue, until 3 Nov 2026" for a meeting series starting at `startAt`. */
export function meetingRepeatText(rule, startAt, timeZone) {
  const day = zonedDayKey(new Date(startAt), timeZone);
  const weekdays = rule.freq === 'WEEKLY' && !(rule.weekdays && rule.weekdays.length) ? [new Date(`${day}T12:00:00Z`).getUTCDay()] : rule.weekdays;
  let text = recurrenceSummary({ ...rule, weekdays, count: null, until: null, paused: false, createNext: undefined });
  if (rule.count != null) text += `, ${rule.count} times`;
  if (rule.until) text += `, until ${dayText(rule.until.slice(0, 10))}`;
  return text;
}

// ---- where, and Join ------------------------------------------------------------------------

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const UNSAFE_SCHEME = /^\s*(javascript|data|vbscript|file|about|blob|mailto|tel|ftp)\s*:/i;

/** The web's reading of a typed meeting link (https added when no scheme; http(s) with a real host). */
function normalizeMeetingLink(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return null;
  if (UNSAFE_SCHEME.test(raw)) return undefined;
  const candidate = HAS_SCHEME.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const host = url.hostname;
  if (!host || (!host.includes('.') && host !== 'localhost')) return undefined;
  return url.href;
}

/** The link Join opens: only a secure (https) web link; null for anything else. */
export function safeJoinLink(link) {
  const href = normalizeMeetingLink(link);
  return href && href.startsWith('https:') ? href : null;
}

/** Where it happens: the place, else "Online" for a meeting with a link. */
export function meetingPlace(m) {
  if (m.location) return m.location;
  return m.onlineLink ? 'Online' : null;
}

/** The meeting on the website (its id encoded), or null without the website's address. */
export function meetingWebUrl(appBase, id) {
  const base = String(appBase || '').replace(/\/+$/, '');
  return base ? `${base}/meetings/${encodeURIComponent(id)}` : null;
}

// ---- your answer ----------------------------------------------------------------------------

/** Your own row on the meeting, or null when you aren't on it. */
export function myInvitation(attendees, userId) {
  if (!userId || !Array.isArray(attendees)) return null;
  return attendees.find((a) => a && a.userId === userId) || null;
}

/** An invitation can be answered until the meeting is over or cancelled (as on the web). */
export function canAnswer(m) {
  return !!m && m.status !== 'CANCELLED' && m.status !== 'COMPLETED';
}

/** The three answers, in the web's order and words. */
export const ANSWERS = [
  { value: 'ACCEPTED', label: 'Accept' },
  { value: 'TENTATIVE', label: 'Maybe' },
  { value: 'DECLINED', label: 'Decline' },
];

/** Pressing an answer gives it; pressing the one already given takes it back (no response). */
export function answerAfterTap(current, tapped) {
  return (current || 'PENDING') === tapped ? 'PENDING' : tapped;
}

/** How many people gave each answer (older rows without one count as no response). */
export function responseSummary(attendees) {
  const out = { ACCEPTED: 0, TENTATIVE: 0, DECLINED: 0, PENDING: 0 };
  for (const a of attendees) out[a.response || 'PENDING'] += 1;
  return out;
}

export function responseLine(s) {
  return `${s.ACCEPTED} accepted · ${s.TENTATIVE} maybe · ${s.DECLINED} declined · ${s.PENDING} no response`;
}

/** Your answer, in words. */
export function myAnswerText(response) {
  switch (response) {
    case 'ACCEPTED': return 'You’re going.';
    case 'TENTATIVE': return 'You might go.';
    case 'DECLINED': return 'You’re not going.';
    default: return 'You haven’t answered yet.';
  }
}

/** Your answers on a list of meetings (`[{ meetingId, people }]`): meeting id → `{ attendeeId, response }`. */
export function answersFor(list, userId) {
  const out = new Map();
  for (const { meetingId, people } of list) {
    const mine = myInvitation(people, userId);
    if (mine) out.set(meetingId, { attendeeId: mine.id, response: mine.response || 'PENDING' });
  }
  return out;
}

/**
 * Your row on a listed meeting from the list itself: a newer server sends `myAttendeeId` and
 * `myResponse` on each row (`myPending`: your answer waiting to sync, H3). Null when you aren't on
 * it; undefined when the server doesn't send them (an older one: read the meeting's people).
 */
export function rowInvitation(m, userId) {
  if (!m || !('myAttendeeId' in m)) return undefined;
  if (!m.myAttendeeId) return null;
  return { id: m.myAttendeeId, userId, response: m.myResponse || 'PENDING', ...(m.myPending ? { pending: true } : {}) };
}

// ---- which meetings a list reads ------------------------------------------------------------

/** The start of today in `timeZone`, as an ISO instant (stable all day, so its saved copy is too). */
function startOfToday(timeZone, now) {
  return zonedStartOfDay(todayKey(timeZone, now), timeZone);
}

/**
 * Meetings: those starting from today (company time). A ranged read lists them soonest first — the
 * plain list is the latest 500 by start, so a few repeating series could push today's out.
 */
export function meetingsListParams(timeZone, now = new Date()) {
  return { from: startOfToday(timeZone, now).toISOString() };
}

/** The Dashboard's Up next: the two weeks from the start of today. */
export function upNextListParams(timeZone, now = new Date()) {
  const from = startOfToday(timeZone, now);
  return { from: from.toISOString(), to: zonedStartOfDay(shiftDayKey(todayKey(timeZone, now), 14), timeZone).toISOString() };
}
