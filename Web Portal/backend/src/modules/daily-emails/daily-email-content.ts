import { escapeHtml, initialsInk, initialsOf, renderEmail, safeHref, type Block } from '../email/email-layout';
import { resolveBrand, type Brand } from '../email/brand';
import type { EmailContent, TemplateOptions } from '../email/email-templates';
import { completedOnTime, daysUntilDue, dueDayKey, shiftDayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';
import { formatDay } from '../../lib/export-format';
import type { DailyEmailPart } from '../notifications/notification-preferences';
import {
  allTokens,
  DUE_SOON_TOKEN,
  DUE_SOON_TONES,
  OVERDUE_TOKEN,
  OVERDUE_TONES,
  PRIORITY_LEVELS,
  PRIORITY_TOKEN,
  PRIORITY_TONES,
  STATUS_TOKEN,
  STATUS_TONES,
  type StatusKind,
  type ThemeTones,
} from '../../lib/colour-scheme';

/**
 * The daily email, redesigned (Nov 2026, owner request of 10 Nov): 720 px wide on a computer and fluid
 * below, every part email-safe (tables only, inline styles, bars as coloured table cells). In order:
 * Today at a glance (tiles), This week (done of due, and the last 7 days against the 7 before) beside
 * By priority, the approval line, Overdue, Due today, Coming up (next 7 days, and tasks waiting for a
 * later start day), Other open tasks (everything else, by project — nothing disappears), Today's
 * meetings, Completed yesterday, Your projects (people who run one: completion, overdue, to approve)
 * and the overdue and waiting tasks of others in those projects. A part that is off or has nothing in
 * it is left out; figures alone never send an email. Every day and time is in the person's time zone,
 * and their week starts on their own week start. Lists are trimmed so the email stays under Gmail's
 * cut-off (about 102 KB), saying how many more and where.
 */

/** A task's project, as the email names it (and heads its group in Other open tasks). */
export interface DailyProject {
  id: string;
  code: string;
  name: string;
  /** The client's / contract project number. */
  number: string | null;
  clientName: string | null;
  managerName: string | null;
  status: 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
  color: string | null;
  /** As stored ("/uploads/…" or an http(s) address). */
  imageUrl: string | null;
  targetDate: Date | null;
  /** Companies: the project's main company — named in the lists, and a heading when the email is grouped. */
  company?: { id: string; name: string } | null;
}

/** A task as the daily email shows it (read fresh from the database just before sending). */
export interface DailyTask {
  id: string;
  key: string;
  title: string;
  project: DailyProject;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  /** A calendar day (stored at UTC midnight), or an instant: a due time. */
  dueDate: Date | null;
  /** Its column's name ("In Progress"). */
  statusLabel: string;
  /** Its column's kind: In progress, Review and Blocked count as in progress; To do and Backlog as not started. */
  statusKind?: StatusKind | null;
  completedAt: Date | null;
  /** Waiting for approval since (task approvals): handed in — counted as in progress, never as overdue. */
  waitingSince?: Date | null;
  startDate?: Date | null;
  /**
   * The day it is on the board (a noon-UTC anchor). A later day than today: the task waits for that day
   * (scheduled for the future) — out of today's lists and figures, in Coming up.
   */
  boardDate?: Date | null;
  /** Its checklist: how many to-do items are done, of how many (every level of a nested checklist). */
  checklist?: { done: number; total: number } | null;
  /** A task it depends on isn't done yet. */
  blocked?: boolean;
  /** Who it is assigned to (shown for others' tasks in the projects the person runs). */
  assignees?: string[];
  /** Task categories (chips), when the site has them. */
  categories?: Array<{ name: string; color?: string | null }>;
  /** Guests on the task ("Ahmed (OXY)"), when the site has them. */
  guests?: string[];
}

/** A meeting on the person's day: one they organize or are invited to and haven't declined. */
export interface DailyMeeting {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  location: string | null;
  /** It has an online link (the link itself is on the meeting's page). */
  online: boolean;
  projectName: string | null;
  /** The person organizes it. */
  organizer: boolean;
  /** Their answer to the invitation (null: the organizer). */
  response: 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' | null;
  status: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

/** The person's week's figures, from their tasks. */
export interface DailyWeek {
  /** Their tasks due around this week (the email keeps those due in their week), done or not. */
  due: Array<{ dueDate: Date; done: boolean }>;
  /** When each of their tasks was completed, from 14 days back (and their week's start) until now. */
  completions: Date[];
}

/** A project the person runs, for Your projects. */
export interface DailyProjectFigures {
  project: DailyProject;
  /** Completion as the project counts it (by tasks or by weight), 0–100; 100 only when all is done. */
  pct: number;
  /** Tasks finished, and in all. */
  done: number;
  total: number;
  /** Tasks not done. */
  open: number;
  /** Open tasks whose due day is before today (not those waiting for approval). */
  overdue: number;
  /** Tasks waiting for approval (the person runs the project: they can approve them). */
  waiting: number;
}

/** Which parts the email has (Settings → Daily email). */
export type DailyParts = Readonly<Record<DailyEmailPart, boolean>>;

export interface DailyEmailInput {
  name: string;
  /** Their own time zone (else the company's): every day and time in the email is in it. */
  timeZone: string;
  now: Date;
  appUrl: string;
  /** Where the server serves stored files ("/uploads/…"), for project pictures email clients can load. */
  assetUrl?: string;
  /** When the email goes ('HH:MM'), said at the end. */
  time: string;
  /** The person's week start (their own, else their company's, else the site's): 0 Sunday, 1 Monday, 6 Saturday. */
  weekStart: number;
  parts: DailyParts;
  /** Assigned to them and not done (waiting-for-approval ones too). */
  tasks: DailyTask[];
  /** Today's meetings. */
  meetings: DailyMeeting[];
  /** Assigned to them and completed since `completedSince`. */
  completed: DailyTask[];
  completedSince: Date;
  /** How many tasks wait for their approval (they run the project, or are an administrator). */
  awaitingApproval: number;
  /** Tasks of the projects they run, assigned to others (overdue and waiting-for-approval ones are shown). */
  managed: DailyTask[];
  /** This week's figures (absent: no This week, nothing done this week). */
  week?: DailyWeek | null;
  /** The projects they run (absent or empty: no Your projects). */
  projects?: DailyProjectFigures[];
  /** Companies: tasks in 2+ companies — Other open tasks is grouped under each company's name. */
  groupByCompany?: boolean;
}

const base = (appUrl: string) => appUrl.replace(/\/+$/, '');
/** The task, opened on My Tasks. */
export const taskLink = (appUrl: string, id: string) => `${base(appUrl)}/my-tasks?task=${encodeURIComponent(id)}`;
/** Someone else's task, opened on its project's page. */
const projectTaskLink = (appUrl: string, projectId: string, id: string) => `${base(appUrl)}/projects/${encodeURIComponent(projectId)}?task=${encodeURIComponent(id)}`;
const projectLink = (appUrl: string, id: string) => `${base(appUrl)}/projects/${encodeURIComponent(id)}`;
const projectsLink = (appUrl: string) => `${base(appUrl)}/projects`;
const meetingLink = (appUrl: string, id: string) => `${base(appUrl)}/meetings/${encodeURIComponent(id)}`;
const dashboardLink = (appUrl: string) => `${base(appUrl)}/dashboard`;
/** The To approve list on My Tasks. */
export const toApproveLink = (appUrl: string) => `${base(appUrl)}/my-tasks#to-approve`;
const settingsLink = (appUrl: string, anchor: string) => `${base(appUrl)}/settings#${anchor}`;

/** A project picture at an address email clients can load: stored paths are on the server (`assetUrl`). */
function pictureUrl(imageUrl: string | null, assetUrl: string | undefined): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return imageUrl.startsWith('/') && assetUrl ? `${base(assetUrl)}${imageUrl}` : null;
}

// ── Words and numbers ────────────────────────────────────────────────────────

/** "Wed 4 Nov 2026" for a 'YYYY-MM-DD' day. */
const dayLabel = (key: string): string => formatDay(key, { weekday: true, year: true });
/** "Wed 4 Nov". */
const shortDay = (key: string): string => formatDay(key, { weekday: true, year: false });
/** "4 Nov". */
const plainDay = (key: string): string => formatDay(key, { weekday: false, year: false });
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay();
/** Whole days from one day to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
/** "09:05" for an instant, in a time zone. */
function clock(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}
/** "Tue 3 Nov, 09:10". */
const momentLabel = (at: Date, timeZone: string) => `${shortDay(zonedDayKey(at, timeZone))}, ${clock(at, timeZone)}`;
/** A due date with a time of day (anything stored at other than UTC midnight). */
const hasDueTime = (d: Date) => d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0 || d.getUTCMilliseconds() !== 0;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Whitespace folded and cut to about `max` characters at a word, with "…". */
function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  return `${cut.replace(/[\s.,;:–—-]+$/, '')}…`;
}
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byKey = (a: DailyTask, b: DailyTask) => collator.compare(a.key, b.key);
const PRIORITY_RANK: Record<DailyTask['priority'], number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const PRIORITY_WORD: Record<DailyTask['priority'], string> = { URGENT: 'Urgent', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
/** Rounded, but 100% only once all of it is done (as the Projects page and the Timeline show progress). */
const share = (part: number, whole: number) => (whole <= 0 ? 0 : part >= whole ? 100 : Math.min(99, Math.round((Math.max(0, part) / whole) * 100)));
const IN_PROGRESS_KINDS = new Set<string>(['IN_PROGRESS', 'REVIEW', 'BLOCKED']);
const safeColor = (v: string | null | undefined) => (/^#[0-9a-f]{6}$/i.test(v ?? '') ? v! : null);

// ── How many fit ─────────────────────────────────────────────────────────────

/** How many of each list fit; tighter steps when the email would be too big for Gmail (it cuts off emails over about 102 KB). */
interface Limits {
  overdue: number;
  dueToday: number;
  comingUp: number;
  /** Other open tasks in all, at most `perProject` of a project, at most `groups` projects. */
  other: number;
  perProject: number;
  groups: number;
  meetings: number;
  completed: number;
  projects: number;
  managed: number;
}
/** Overdue and Due today keep the most rows step after step; Other open tasks and the lists of what is past are cut first. */
const LADDER: Limits[] = [
  { overdue: 15, dueToday: 15, comingUp: 12, other: 20, perProject: 6, groups: 8, meetings: 12, completed: 10, projects: 10, managed: 8 },
  { overdue: 12, dueToday: 12, comingUp: 8, other: 10, perProject: 4, groups: 5, meetings: 8, completed: 5, projects: 8, managed: 5 },
  { overdue: 10, dueToday: 10, comingUp: 6, other: 5, perProject: 3, groups: 3, meetings: 6, completed: 3, projects: 6, managed: 4 },
  { overdue: 8, dueToday: 8, comingUp: 4, other: 3, perProject: 2, groups: 2, meetings: 5, completed: 2, projects: 5, managed: 3 },
  { overdue: 4, dueToday: 4, comingUp: 2, other: 2, perProject: 1, groups: 2, meetings: 3, completed: 1, projects: 3, managed: 2 },
];
/** Well under Gmail's ~102 KB: the email's own size, with room for what the email provider adds. */
const BUDGET_BYTES = 95_000;

// ── Look ─────────────────────────────────────────────────────────────────────

/** Outlook on Windows has Segoe UI (Word falls back to Times New Roman when the first font is missing); then Apple, Android, the rest. */
const FONT = "'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";
const TRACK = '#ECE6E3';
/** The brand's ink (headings are drawn before the brand is at hand). */
const INK = '#211B1A';
const TRACK_DARK = '#3A312E';
const TILE_BG = '#FAF7F6';
const ZERO_BAR = '#D9D0CC';
/** "Done" green: completion bars and the trend. */
const DONE = STATUS_TONES.DONE;
const DONE_TOKEN = STATUS_TOKEN.DONE;
const WAITING = STATUS_TONES.REVIEW;
const WAITING_TOKEN = STATUS_TOKEN.REVIEW;
const BLOCKED_T = STATUS_TONES.BLOCKED;
const BLOCKED_TOKEN = STATUS_TOKEN.BLOCKED;
const NEUTRAL = STATUS_TONES.BACKLOG;
const NEUTRAL_TOKEN = STATUS_TOKEN.BACKLOG;

/**
 * The email's own styles: phones (under 480 px) stack the tiles two to a row and each row's columns;
 * dark mode gives every badge, bar and tile its dark colours (the website's scheme) — only the
 * colours the email uses, to keep it small. Clients that ignore these still read well: 720 px and
 * fluid below, light colours on explicit backgrounds.
 */
function cssFor(html: string): string {
  const used = (cls: string) => html.includes(cls);
  return [
  `td,p,div,span,a,h1,h2{font-family:${FONT}}`,
  '@media (max-width:480px){' +
    '.em-tile{display:inline-block!important;width:50%!important;box-sizing:border-box!important}' +
    '.em-col{display:block!important;width:auto!important;max-width:100%!important}' +
    '.em-right{text-align:left!important;padding:6px 0 0!important;white-space:normal!important}' +
    '.em-right .em-mini{float:none!important;margin:4px 0 0!important}' +
    '.em-half{display:block!important;width:auto!important;padding:0 0 12px!important}' +
    '.em-time{width:58px!important}' +
    '.em-btn-wrap{width:100%!important}.email-btn{display:block!important;text-align:center!important}' +
    '}',
  '@media (prefers-color-scheme:dark){' +
    `.em-tile-box{background:#26211F!important;border-color:#3A312E!important}` +
    `.em-track{background:${TRACK_DARK}!important}` +
    `.em-zero{background:#5A4E4A!important}` +
    '.email-btn{color:#FFFFFF!important}' +
    '.em-callout{background:#2F3844!important;color:#E7E1DE!important}.em-callout a{color:#82B4EA!important}' +
    allTokens()
      .map(([name, tones]) =>
        [
          used(`em-t-${name}"`) || used(`em-t-${name} `) ? `.em-t-${name}{background:${tones.dark.soft}!important;color:${tones.dark.text}!important}` : '',
          used(`em-f-${name}"`) ? `.em-f-${name}{background:${tones.dark.fill}!important}` : '',
          used(`em-ink-${name}"`) || used(`em-ink-${name} `) ? `.em-ink-${name}{color:${tones.dark.text}!important}` : '',
          used(`em-edge-${name}"`) ? `.em-edge-${name}{border-left-color:${tones.dark.fill}!important}` : '',
        ].join(''),
      )
      .join('') +
    '}',
  ].join('');
}

/** One of the email's own pieces: its HTML and its plain-text version. */
interface Piece {
  html: string;
  text: string;
}
const join = (pieces: Piece[], sep = '\n'): Piece => ({ html: pieces.map((p) => p.html).join(''), text: pieces.map((p) => p.text).filter(Boolean).join(sep) });

/** A badge: a word on its colour's tint (the scheme's text colour: 4.5:1 in light and dark). */
function badge(text: string, token: string, tones: ThemeTones): string {
  return `<span class="em-t-${token}" style="display:inline-block;margin:4px 4px 0 0;padding:0 8px;border-radius:9px;background:${tones.light.soft};color:${tones.light.text};font-size:11px;line-height:18px;font-weight:700;white-space:nowrap">${escapeHtml(text)}</span>`;
}

/** A horizontal bar: a coloured cell for the share done and a track for the rest. */
function bar(pct: number, token: string, tones: ThemeTones, o: { height?: number; width?: number } = {}): string {
  const h = o.height ?? 6;
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const cell = (cls: string, w: number, color: string) =>
    `<td class="${cls}" width="${w}%" bgcolor="${color}" style="width:${w}%;height:${h}px;background:${color};font-size:0;line-height:${h}px;mso-line-height-rule:exactly">&nbsp;</td>`;
  const cells = (p > 0 ? cell(`em-f-${token}`, p, tones.light.fill) : '') + (p < 100 ? cell('em-track', 100 - p, TRACK) : '');
  const width = o.width ? ` width="${o.width}" align="right" class="em-mini"` : ' width="100%"';
  const style = o.width ? `width:${o.width}px;border-collapse:collapse;margin:4px 0 0 auto` : 'width:100%;border-collapse:collapse';
  return `<table role="presentation"${width} cellpadding="0" cellspacing="0" style="${style}"><tr>${cells}</tr></table>`;
}

/** A section's heading, with its count ("Overdue 3") in the section's colour. */
function heading(text: string, count: number | null, tone?: { token: string; tones: ThemeTones }): Piece {
  const t = tone ?? { token: NEUTRAL_TOKEN, tones: NEUTRAL };
  const n =
    count === null
      ? ''
      : ` <span class="em-t-${t.token}" style="display:inline-block;padding:0 8px;border-radius:9px;background:${t.tones.light.soft};color:${t.tones.light.text};font-size:12px;line-height:20px;font-weight:800;vertical-align:2px">${count}</span>`;
  return {
    html: `<h2 class="email-text" style="margin:22px 0 8px;font-size:16px;line-height:1.3;font-weight:800;color:${INK}">${escapeHtml(text)}${n}</h2>`,
    text: `== ${text}${count === null ? '' : ` (${count})`} ==`,
  };
}

/** A bordered box of rows. */
const box = (rows: string, c: Brand['colors']) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-details" style="width:100%;margin:0;border:1px solid ${c.line};border-radius:12px;border-collapse:separate;overflow:hidden">${rows}</table>`;

const muted = (text: string, c: Brand['colors'], top = 2) => `<div class="email-muted" dir="auto" style="margin-top:${top}px;font-size:13px;line-height:1.45;color:${c.ink2}">${escapeHtml(text)}</div>`;

// ── The model: what goes where ───────────────────────────────────────────────

type Place = 'overdue' | 'dueToday' | 'comingUp' | 'other';

type Model = ReturnType<typeof classify>;

/** "Good morning, Ada" — or afternoon or evening, by the person's clock (a test sent later in the day). */
function greeting(input: DailyEmailInput): string {
  const hour = Number(clock(input.now, input.timeZone).slice(0, 2));
  return `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${input.name}`;
}

function classify(input: DailyEmailInput) {
  const { parts, timeZone: tz, now } = input;
  const today = zonedDayKey(now, tz);
  const days = (t: DailyTask) => daysUntilDue(t.dueDate, tz, now);
  const waiting = (t: DailyTask) => Boolean(t.waitingSince);
  /** Days until the task's start day when it waits for a later day (else 0). Board days are noon-UTC anchors: their UTC date. */
  const startsIn = (t: DailyTask) => {
    if (!t.boardDate) return 0;
    const start = t.boardDate.toISOString().slice(0, 10);
    return start > today ? daysBetween(today, start) : 0;
  };
  const dueKey = (t: DailyTask) => dueDayKey(t.dueDate, tz) ?? '9999';

  const placeOf = (t: DailyTask): Place => {
    if (waiting(t)) return 'other';
    const s = startsIn(t);
    if (s > 0) return s <= 7 ? 'comingUp' : 'other';
    const d = days(t);
    if (d === null) return 'other';
    if (d < 0) return 'overdue';
    if (d === 0) return 'dueToday';
    return d <= 7 ? 'comingUp' : 'other';
  };
  const placed: Record<Place, DailyTask[]> = { overdue: [], dueToday: [], comingUp: [], other: [] };
  for (const t of input.tasks) placed[placeOf(t)].push(t);
  const dueTime = (t: DailyTask) => (t.dueDate && hasDueTime(t.dueDate) ? t.dueDate.getTime() : Number.MAX_SAFE_INTEGER);
  placed.overdue.sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byKey(a, b));
  placed.dueToday.sort((a, b) => dueTime(a) - dueTime(b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byKey(a, b));
  /** The day a coming-up task counts from: its start day when it waits for one, else its due day. */
  const upKey = (t: DailyTask) => (startsIn(t) > 0 ? shiftDayKey(today, startsIn(t)) : dueKey(t));
  placed.comingUp.sort((a, b) => upKey(a).localeCompare(upKey(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byKey(a, b));
  placed.other.sort((a, b) => Number(waiting(a)) - Number(waiting(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || dueKey(a).localeCompare(dueKey(b)) || byKey(a, b));

  // Today's work: not waiting for a later start day.
  const current = input.tasks.filter((t) => startsIn(t) === 0);
  const inProgress = current.filter((t) => waiting(t) || IN_PROGRESS_KINDS.has(t.statusKind ?? 'TODO')).length;

  // Their week (their own week start) in their time zone.
  const weekStartKey = shiftDayKey(today, -((weekdayOf(today) - (((input.weekStart % 7) + 7) % 7) + 7) % 7));
  const weekStartAt = zonedStartOfDay(weekStartKey, tz);
  const weekEndKey = shiftDayKey(weekStartKey, 6);
  const completions = input.week?.completions ?? [];
  const doneThisWeek = completions.filter((at) => at.getTime() >= weekStartAt.getTime() && at.getTime() <= now.getTime()).length;
  const dueThisWeek = (input.week?.due ?? []).filter((r) => {
    const k = dueDayKey(r.dueDate, tz);
    return k !== null && k >= weekStartKey && k <= weekEndKey;
  });
  const weekDone = dueThisWeek.filter((r) => r.done).length;
  // The trend: the 7 days to yesterday, and the 7 before.
  const doneOn = new Map<string, number>();
  for (const at of completions) {
    const k = zonedDayKey(at, tz);
    doneOn.set(k, (doneOn.get(k) ?? 0) + 1);
  }
  const trend = Array.from({ length: 7 }, (_, i) => {
    const key = shiftDayKey(today, i - 7);
    return { key, label: WEEKDAY[weekdayOf(key)]!, n: doneOn.get(key) ?? 0 };
  });
  const lastWeek = trend.reduce((s, d) => s + d.n, 0);
  const weekBefore = Array.from({ length: 7 }, (_, i) => doneOn.get(shiftDayKey(today, i - 14)) ?? 0).reduce((s, n) => s + n, 0);

  const numbers = { open: current.length, inProgress, notStarted: current.length - inProgress, overdue: placed.overdue.length, doneThisWeek };
  const priorities = PRIORITY_LEVELS.map((p) => ({ level: p, n: current.filter((t) => t.priority === p).length }));

  const completed = parts.completed ? [...input.completed].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0) || byKey(a, b)) : [];
  const meetings = parts.schedule ? [...input.meetings].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()) : [];
  // Others' overdue (most days first), then waiting for approval (longest first).
  const managed = parts.managed
    ? input.managed
        .filter((t) => waiting(t) || (days(t) ?? 0) < 0)
        .sort((a, b) => Number(waiting(a)) - Number(waiting(b)) || (waiting(a) ? a.waitingSince!.getTime() - b.waitingSince!.getTime() : dueKey(a).localeCompare(dueKey(b))) || byKey(a, b))
    : [];
  // Your projects: those needing attention first (overdue, then waiting, then least done), each with tasks.
  const projects = parts.projects
    ? (input.projects ?? []).filter((p) => p.total > 0).sort((a, b) => b.overdue - a.overdue || b.waiting - a.waiting || a.pct - b.pct || collator.compare(a.project.name, b.project.name))
    : [];

  const approvals = parts.glance || parts.urgent || parts.pending || parts.projects || parts.managed ? input.awaitingApproval : 0;

  // Figures alone never send an email: something open, new or on the day must be in it.
  const ownOn = parts.glance || parts.priority || parts.urgent || parts.comingUp || parts.pending;
  const weekOpen = parts.week && dueThisWeek.some((r) => !r.done);
  const hasContent =
    (ownOn && input.tasks.length > 0) ||
    weekOpen ||
    meetings.length > 0 ||
    completed.length > 0 ||
    approvals > 0 ||
    managed.length > 0 ||
    projects.some((p) => p.open > 0 || p.waiting > 0 || p.overdue > 0);

  const dueToday = placed.dueToday.length;
  const said = [numbers.overdue > 0 && `${numbers.overdue} overdue`, dueToday > 0 && `${dueToday} due`, meetings.length > 0 && plural(meetings.length, 'meeting')].filter(Boolean);
  const subjectWhat = said.length
    ? said.join(', ')
    : input.tasks.length
      ? plural(input.tasks.length, 'open task')
      : approvals
        ? `${plural(approvals, 'task')} to approve`
        : completed.length
          ? `${plural(completed.length, 'task')} completed recently`
          : managed.length
            ? `${plural(managed.length, 'task')} to check in your projects`
            : 'your day';
  const subject = `Today: ${subjectWhat} — ${shortDay(today)}`;
  const preheader = [
    numbers.overdue > 0 ? `${numbers.overdue} overdue` : null,
    dueToday > 0 ? `${dueToday} due today` : null,
    `${numbers.open} open`,
    meetings.length > 0 ? plural(meetings.length, 'meeting') : null,
    `${numbers.doneThisWeek} done this week`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    today,
    days,
    waiting,
    startsIn,
    dueKey,
    placed,
    numbers,
    priorities,
    week: {
      due: dueThisWeek.length,
      done: weekDone,
      trend,
      lastWeek,
      weekBefore,
      any: dueThisWeek.length > 0 || lastWeek + weekBefore > 0,
    },
    completed,
    meetings,
    managed,
    projects,
    approvals,
    hasContent,
    subject,
    preheader,
  };
}

// ── The email ────────────────────────────────────────────────────────────────

/**
 * The person's daily email, or null when there is nothing in it (no part on has anything — figures
 * alone don't count). Lists are trimmed step by step until the HTML is within the size budget.
 */
export function dailyEmail(input: DailyEmailInput, opts: TemplateOptions = {}): EmailContent | null {
  const brand = resolveBrand(opts.brand);
  const model = classify(input);
  if (!model.hasContent) return null;
  let built: { html: string; text: string } | null = null;
  for (const limits of LADDER) {
    const blocks = blocksFor(input, model, limits, brand);
    built = renderEmail({
      preheader: model.preheader,
      heading: greeting(input),
      headerNote: dayLabel(model.today),
      blocks,
      brand: opts.brand,
      locale: opts.locale,
      css: cssFor(blocks.map((b) => (b.kind === 'markup' ? b.html : '')).join('')),
    });
    if (Buffer.byteLength(built.html, 'utf8') <= BUDGET_BYTES) break;
  }
  return { subject: model.subject, html: built!.html, text: built!.text };
}

const boxed = (rows: Piece[], c: Brand['colors']): Piece => ({ html: box(rows.map((r) => r.html).join(''), c), text: rows.map((r) => r.text).join('\n') });

/** The email's body: one block, its sections inside a table that carries the font (Outlook doesn't pass it down from the body). */
function blocksFor(input: DailyEmailInput, m: Model, limits: Limits, brand: Brand): Block[] {
  const c = brand.colors;
  const app = input.appUrl;
  const p = input.parts;
  const sections: Piece[] = [];
  const more = (left: number): Piece[] => (left > 0 ? [moreLine(`and ${left} more on the Dashboard`, dashboardLink(app), c)] : []);

  if (p.glance && (m.numbers.open > 0 || m.numbers.doneThisWeek > 0)) sections.push(join([heading('Today at a glance', null), tiles(m, c)]));
  if (m.approvals > 0) sections.push(approvalLine(m.approvals, app));
  const weekShown = p.week && m.week.any;
  const priorityShown = p.priority && m.numbers.open > 0;
  if (weekShown || priorityShown) sections.push(weekAndPriority(weekShown ? weekPiece(m, c) : null, priorityShown ? priorityPiece(m, c) : null));

  const row = rowMaker(input, m, c);
  const list = (title: string, tasks: DailyTask[], limit: number, tone: { token: string; tones: ThemeTones } | undefined, edge?: boolean) => {
    if (!tasks.length) return;
    const shown = tasks.slice(0, limit);
    sections.push(join([heading(title, tasks.length, tone), boxed(shown.map((t, i) => row(t, { first: i === 0, edge })), c), ...more(tasks.length - shown.length)]));
  };
  if (p.urgent) {
    list('Overdue', m.placed.overdue, limits.overdue, { token: OVERDUE_TOKEN, tones: OVERDUE_TONES }, true);
    list('Due today', m.placed.dueToday, limits.dueToday, { token: DUE_SOON_TOKEN, tones: DUE_SOON_TONES });
  }
  if (p.comingUp) list('Coming up', m.placed.comingUp, limits.comingUp, undefined);
  if (p.pending && m.placed.other.length) sections.push(otherTasks(input, m, limits, c, row));

  if (m.meetings.length) {
    const shown = m.meetings.slice(0, limits.meetings);
    sections.push(join([heading('Today’s meetings', m.meetings.length), boxed(shown.map((mt, i) => meetingRow(mt, input, c, i === 0)), c), ...more(m.meetings.length - shown.length)]));
  }

  if (m.completed.length) {
    const shown = m.completed.slice(0, limits.completed);
    const yesterday = zonedStartOfDay(shiftDayKey(m.today, -1), input.timeZone);
    const title = input.completedSince.getTime() >= yesterday.getTime() ? 'Completed yesterday' : `Completed since ${shortDay(zonedDayKey(input.completedSince, input.timeZone))}`;
    sections.push(join([heading(title, m.completed.length, { token: DONE_TOKEN, tones: DONE }), boxed(shown.map((t, i) => completedRow(t, input, c, i === 0)), c), ...more(m.completed.length - shown.length)]));
  }

  if (m.projects.length) {
    const shown = m.projects.slice(0, limits.projects);
    const left = m.projects.length - shown.length;
    sections.push(
      join([
        heading('Your projects', m.projects.length),
        boxed(shown.map((f, i) => projectRow(f, input, c, i === 0)), c),
        ...(left > 0 ? [moreLine(`and ${left} more on the Projects page`, projectsLink(app), c)] : []),
      ]),
    );
  }
  if (m.managed.length) {
    const shown = m.managed.slice(0, limits.managed);
    sections.push(
      join([
        heading('Overdue and waiting in your projects', m.managed.length),
        boxed(shown.map((t, i) => row(t, { first: i === 0, managed: true, edge: !m.waiting(t) })), c),
        ...more(m.managed.length - shown.length),
      ]),
    );
  }

  sections.push(button('Open the dashboard', dashboardLink(app), brand));
  sections.push(preferences(input, c));
  const body = join(sections, '\n\n');
  return [
    {
      kind: 'markup',
      html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr><td style="font-family:${FONT};font-size:14px;line-height:1.45;color:${c.ink}">${body.html}</td></tr></table>`,
      text: body.text,
    },
  ];
}

// ── Today at a glance ────────────────────────────────────────────────────────

function tiles(m: Model, c: Brand['colors']): Piece {
  const n = m.numbers;
  const late = n.overdue > 0;
  const items: Array<{ n: number; label: string; tones: ThemeTones; red?: boolean }> = [
    { n: n.open, label: 'Open', tones: PRIORITY_TONES.NORMAL },
    { n: n.inProgress, label: 'In progress', tones: STATUS_TONES.IN_PROGRESS },
    { n: n.notStarted, label: 'Not started', tones: STATUS_TONES.TODO },
    { n: n.overdue, label: 'Overdue', tones: late ? OVERDUE_TONES : NEUTRAL, red: late },
    { n: n.doneThisWeek, label: 'Done this week', tones: DONE },
  ];
  const cells = items
    .map((x) => {
      const bg = x.red ? x.tones.light.soft : TILE_BG;
      const number = x.red
        ? `<div class="em-tile-n em-ink-overdue" style="font-size:22px;line-height:1.15;font-weight:800;color:${x.tones.light.text}">${x.n}</div>`
        : `<div class="em-tile-n email-text" style="font-size:22px;line-height:1.15;font-weight:800;color:${c.ink}">${x.n}</div>`;
      const label = `<div class="${x.red ? 'em-ink-overdue' : 'email-muted'}" style="margin-top:2px;font-size:12px;line-height:1.3;font-weight:${x.red ? 700 : 400};color:${x.red ? x.tones.light.text : c.ink2}">${x.label}</div>`;
      return `<td class="em-tile" width="20%" valign="top" style="width:20%;padding:3px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr><td class="${x.red ? `em-t-${OVERDUE_TOKEN}` : 'em-tile-box'}" bgcolor="${bg}" style="padding:9px 10px;background:${bg};border:1px solid ${c.line};border-top:3px solid ${x.tones.light.fill};border-radius:10px">${number}${label}</td></tr></table></td>`;
    })
    .join('');
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr>${cells}</tr></table>`,
    text: `${n.open} open · ${n.inProgress} in progress · ${n.notStarted} not started · ${n.overdue} overdue · ${n.doneThisWeek} done this week`,
  };
}

function approvalLine(n: number, app: string): Piece {
  const line = `${n === 1 ? '1 task is' : `${n} tasks are`} waiting for your approval.`;
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:14px 0 0"><tr><td class="em-callout" bgcolor="#E9F0F7" style="background:#E9F0F7;border-left:4px solid #3A6EA5;border-radius:8px;padding:10px 14px;font-size:14px;line-height:1.5;color:#274b70">${escapeHtml(line)} <a href="${safeHref(toApproveLink(app))}" target="_blank" style="font-weight:700;color:#274b70;text-decoration:underline">Review them</a></td></tr></table>`,
    text: `> ${line} Review them: ${toApproveLink(app)}`,
  };
}

// ── This week + By priority ─────────────────────────────────────────────────

/** Two halves side by side on a computer, one under the other on a phone. */
function weekAndPriority(week: Piece | null, priority: Piece | null): Piece {
  const half = (p: Piece, pad: string) => `<td class="em-half em-col" width="50%" valign="top" style="width:50%;${pad}">${p.html}</td>`;
  const html =
    week && priority
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr>${half(week, 'padding-right:12px')}${half(priority, 'padding-left:12px')}</tr></table>`
      : (week ?? priority)!.html;
  return { html, text: [week?.text, priority?.text].filter(Boolean).join('\n\n') };
}

const NONE_DONE = 'Nothing completed in the last two weeks';

function weekPiece(m: Model, c: Brand['colors']): Piece {
  const w = m.week;
  const pct = share(w.done, w.due);
  const dueLine = w.due > 0 ? `${w.done} of ${w.due} done · ${pct}%` : 'Nothing due this week';
  const max = Math.max(1, ...w.trend.map((d) => d.n));
  const H = 36;
  const cols = w.trend
    .map((d) => {
      const h = d.n > 0 ? Math.max(4, Math.round((d.n / max) * H)) : 2;
      const fill =
        d.n > 0
          ? `class="em-f-${DONE_TOKEN}" bgcolor="${DONE.light.fill}" style="width:16px;height:${h}px;background:${DONE.light.fill};font-size:0;line-height:${h}px;mso-line-height-rule:exactly"`
          : `class="em-zero" bgcolor="${ZERO_BAR}" style="width:16px;height:2px;background:${ZERO_BAR};font-size:0;line-height:2px;mso-line-height-rule:exactly"`;
      return `<td align="center" valign="bottom" width="14%" style="width:14%;padding:0 1px"><div class="email-muted" style="font-size:11px;line-height:14px;color:${c.ink2}">${d.n}</div><table role="presentation" width="16" cellpadding="0" cellspacing="0" style="width:16px;border-collapse:collapse"><tr><td width="16" ${fill}>&nbsp;</td></tr></table><div class="email-muted" style="font-size:11px;line-height:14px;color:${c.ink2}">${d.label}</div></td>`;
    })
    .join('');
  // Seven empty bars say nothing: a plain line instead.
  const anyDone = w.lastWeek + w.weekBefore > 0;
  const diff = w.lastWeek - w.weekBefore;
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  const word = diff > 0 ? 'more' : diff < 0 ? 'fewer' : 'the same';
  const versus = `${w.lastWeek} done vs ${w.weekBefore} the week before`;
  const tone = diff > 0 ? DONE : diff < 0 ? OVERDUE_TONES : NEUTRAL;
  const toneToken = diff > 0 ? DONE_TOKEN : diff < 0 ? OVERDUE_TOKEN : NEUTRAL_TOKEN;
  const html =
    heading('This week', null).html +
    `<div class="email-muted" style="font-size:12px;line-height:1.4;color:${c.ink2}">Due this week</div>` +
    `<div class="email-text" style="margin:2px 0 6px;font-size:15px;line-height:1.35;font-weight:700;color:${c.ink}">${escapeHtml(dueLine)}</div>` +
    (w.due > 0 ? bar(pct, DONE_TOKEN, DONE, { height: 8 }) : '') +
    (anyDone
      ? `<div class="email-muted" style="margin-top:12px;font-size:12px;line-height:1.4;color:${c.ink2}">Done each day, last 7 days</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-top:4px"><tr>${cols}</tr></table>` +
        `<div class="em-ink-${toneToken}" style="margin-top:6px;font-size:13px;line-height:1.4;font-weight:700;color:${tone.light.text}">${escapeHtml(versus)} ${arrow}</div>`
      : `<div class="email-muted" style="margin-top:12px;font-size:12px;line-height:1.4;color:${c.ink2}">${NONE_DONE}.</div>`);
  const text = [
    '== This week ==',
    w.due > 0 ? `Due this week: ${dueLine}` : 'Nothing due this week',
    anyDone ? `Done each day, last 7 days: ${w.trend.map((d) => `${d.label} ${d.n}`).join(' · ')} — ${versus} (${word})` : `${NONE_DONE}.`,
  ].join('\n');
  return { html, text };
}

function priorityPiece(m: Model, c: Brand['colors']): Piece {
  const total = Math.max(1, m.numbers.open);
  const rows = m.priorities
    .map(({ level, n }) => {
      const tones = PRIORITY_TONES[level];
      const pct = Math.round((n / total) * 100);
      return `<tr><td class="em-ink-${PRIORITY_TOKEN[level]}" width="64" style="width:64px;padding:5px 8px 5px 0;font-size:13px;line-height:18px;font-weight:700;color:${tones.light.text};white-space:nowrap">${PRIORITY_WORD[level]}</td><td valign="middle" style="padding:5px 0">${bar(pct, PRIORITY_TOKEN[level], tones, { height: 8 })}</td><td class="email-text" width="34" align="right" style="width:34px;padding:5px 0 5px 8px;font-size:13px;line-height:18px;font-weight:700;color:${c.ink}">${n}</td></tr>`;
    })
    .join('');
  return {
    html: heading('By priority', null).html + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%">${rows}</table>`,
    text: ['== By priority ==', m.priorities.map(({ level, n }) => `${PRIORITY_WORD[level]} ${n}`).join(' · ')].join('\n'),
  };
}

// ── Task rows ────────────────────────────────────────────────────────────────

/** "Rig Inspection (Acme Drilling)", or with the company when the email is grouped. */
function projectLine(p: DailyProject, grouped: boolean | undefined): string {
  if (grouped && p.company) return `${p.name} · ${p.company.name}`;
  return p.clientName ? `${p.name} (${p.clientName})` : p.name;
}

/** How a task's day reads at the right of its row ("3 days late", "today 14:00", "in 3 days", "starts tomorrow", "1 Dec"). */
function dayPhrase(t: DailyTask, m: Model, tz: string): { text: string; token: string | null; tones: ThemeTones | null } | null {
  const s = m.startsIn(t);
  const rel = (d: number) => (d === 1 ? 'tomorrow' : d <= 7 ? `in ${d} days` : plainDay(shiftDayKey(m.today, d)));
  if (s > 0) return { text: `starts ${rel(s)}`, token: null, tones: null };
  const d = m.days(t);
  if (d === null) return null;
  const at = t.dueDate && hasDueTime(t.dueDate) ? ` ${clock(t.dueDate, tz)}` : '';
  if (m.waiting(t)) return { text: plainDay(m.dueKey(t)), token: null, tones: null };
  if (d < 0) return { text: `${plural(-d, 'day')} late`, token: OVERDUE_TOKEN, tones: OVERDUE_TONES };
  if (d === 0) return { text: `today${at}`, token: DUE_SOON_TOKEN, tones: DUE_SOON_TONES };
  if (d <= 7) return { text: `${rel(d)}${at}`, token: null, tones: null };
  return { text: plainDay(m.dueKey(t)), token: null, tones: null };
}

/** Makes a task's row: number and title, project and dates, badges; at the right, its day and its checklist. */
function rowMaker(input: DailyEmailInput, m: Model, c: Brand['colors']) {
  const tz = input.timeZone;
  return (t: DailyTask, o: { first: boolean; edge?: boolean; managed?: boolean; inGroup?: boolean }): Piece => {
    const phrase = dayPhrase(t, m, tz);
    const s = m.startsIn(t);
    const d = m.days(t);
    const dueKey = dueDayKey(t.dueDate, tz);
    const at = t.dueDate && hasDueTime(t.dueDate) ? `, ${clock(t.dueDate, tz)}` : '';
    // The day itself beside a relative phrase ("3 days late" · "Due Sun 1 Nov"); a phrase that is a date already says it.
    const relative = !m.waiting(t) && d !== null && (s > 0 || d < 0 || (d > 0 && d <= 7));
    const dates = [s > 0 ? `Starts ${shortDay(shiftDayKey(m.today, s))}` : null, dueKey && relative ? `Due ${shortDay(dueKey)}${at}` : null].filter((x): x is string => !!x);
    const meta = [o.inGroup ? null : projectLine(t.project, input.groupByCompany), ...dates, o.managed && t.assignees?.length ? `Assigned to ${t.assignees.join(', ')}` : null].filter(
      (x): x is string => !!x,
    );

    const kind = (STATUS_TOKEN[(t.statusKind ?? 'TODO') as StatusKind] ? t.statusKind ?? 'TODO' : 'TODO') as StatusKind;
    const badges: Array<{ text: string; token: string; tones: ThemeTones; color?: string | null }> = [
      { text: t.statusLabel, token: STATUS_TOKEN[kind], tones: STATUS_TONES[kind] },
      ...(t.priority !== 'NORMAL' ? [{ text: PRIORITY_WORD[t.priority], token: PRIORITY_TOKEN[t.priority], tones: PRIORITY_TONES[t.priority] }] : []),
      ...(m.waiting(t) ? [{ text: 'Waiting for approval', token: WAITING_TOKEN, tones: WAITING }] : []),
      ...(t.blocked ? [{ text: 'Blocked', token: BLOCKED_TOKEN, tones: BLOCKED_T }] : []),
      ...(t.categories ?? []).map((cat) => ({ text: cat.name, token: NEUTRAL_TOKEN, tones: NEUTRAL, color: safeColor(cat.color) })),
      ...(t.guests ?? []).map((g) => ({ text: `Guest: ${g}`, token: NEUTRAL_TOKEN, tones: NEUTRAL })),
    ];
    // A category's own colour is a dot before its name (the name says it; colour is never alone).
    const badgeHtml = badges
      .map((b) => (b.color ? badge(b.text, b.token, b.tones).replace('">', `"><span style="color:${b.color}">●</span>&nbsp;`) : badge(b.text, b.token, b.tones)))
      .join(' ');
    const list = t.checklist && t.checklist.total > 0 ? t.checklist : null;
    const listPct = list ? share(list.done, list.total) : 0;
    const href = o.managed ? projectTaskLink(input.appUrl, t.project.id, t.id) : taskLink(input.appUrl, t.id);

    const right =
      (phrase
        ? `<div class="${phrase.token ? `em-ink-${phrase.token}` : 'email-text'}" style="font-size:13px;line-height:1.35;font-weight:700;color:${phrase.tones ? phrase.tones.light.text : c.ink}">${escapeHtml(phrase.text)}</div>`
        : '') +
      (list
        ? `<div class="email-muted" style="margin-top:3px;font-size:12px;line-height:1.3;color:${c.ink2}">Checklist <span class="email-text" style="font-weight:700;color:${c.ink}">${list.done}/${list.total} · ${listPct}%</span></div>${bar(listPct, DONE_TOKEN, DONE, { height: 5, width: 96 })}`
        : '');
    const edge = o.edge ? `;border-left:4px solid ${OVERDUE_TONES.light.fill}` : '';
    const html =
      `<tr><td class="email-card${o.edge ? ` em-edge-${OVERDUE_TOKEN}` : ''}" style="padding:9px 12px;background:${c.surface}${o.first ? '' : `;border-top:1px solid ${c.line}`}${edge}">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr>` +
      `<td class="em-col" valign="top" style="padding-right:10px">` +
      `<span class="email-muted" style="font-size:12px;font-weight:700;color:${c.ink2};white-space:nowrap">${escapeHtml(t.key)}</span>&nbsp; ` +
      `<a href="${safeHref(href)}" target="_blank" dir="auto" class="email-text" style="font-size:15px;line-height:1.35;font-weight:700;color:${c.ink};text-decoration:none">${escapeHtml(clip(t.title, 160))}</a>` +
      (meta.length ? muted(meta.join(' · '), c) : '') +
      `<div style="font-size:0;line-height:0">${badgeHtml}</div>` +
      `</td>` +
      (right ? `<td class="em-col em-right" valign="top" align="right" width="128" style="width:128px;text-align:right;white-space:nowrap">${right}</td>` : '') +
      `</tr></table></td></tr>`;
    const words = [...meta, ...badges.map((b) => b.text), ...(list ? [`Checklist ${list.done}/${list.total} (${listPct}%)`] : [])];
    const text = [`- ${t.key} ${clip(t.title, 160)}${phrase ? ` — ${phrase.text}` : ''}`, `  ${words.join(' · ')}`, `  ${href}`].join('\n');
    return { html, text };
  };
}

/** Other open tasks: by project (and company, when grouped), each project trimmed with "and N more in this project". */
function otherTasks(input: DailyEmailInput, m: Model, limits: Limits, c: Brand['colors'], row: ReturnType<typeof rowMaker>): Piece {
  const tasks = m.placed.other;
  const groups = new Map<string, { project: DailyProject; tasks: DailyTask[] }>();
  for (const t of tasks) {
    const g = groups.get(t.project.id) ?? { project: t.project, tasks: [] };
    g.tasks.push(t);
    groups.set(t.project.id, g);
  }
  let ordered = [...groups.values()];
  if (input.groupByCompany) {
    const name = (g: { project: DailyProject }) => g.project.company?.name ?? '';
    ordered = ordered
      .map((g, i) => ({ g, i }))
      .sort((a, b) => collator.compare(name(a.g), name(b.g)) || a.i - b.i)
      .map((x) => x.g);
  }
  const pieces: Piece[] = [heading('Other open tasks', tasks.length)];
  let room = limits.other;
  let shownGroups = 0;
  let left = 0;
  let lastCompany: string | null | undefined;
  for (const g of ordered) {
    if (room <= 0 || shownGroups >= limits.groups) {
      left += g.tasks.length;
      continue;
    }
    const company = input.groupByCompany ? (g.project.company ?? null) : undefined;
    if (input.groupByCompany && company?.id !== lastCompany) {
      if (company) pieces.push({ html: `<div class="email-text" dir="auto" style="margin:14px 0 6px;font-size:14px;line-height:1.3;font-weight:800;color:${c.ink}">${escapeHtml(company.name)}</div>`, text: `-- ${company.name} --` });
      lastCompany = company?.id;
    }
    const showing = g.tasks.slice(0, Math.min(limits.perProject, room));
    room -= showing.length;
    shownGroups++;
    const href = projectLink(input.appUrl, g.project.id);
    const head = projectHead(g.project, g.tasks.length, input, c);
    const rows = showing.map((t) => row(t, { first: false, inGroup: true }));
    const rest = g.tasks.length - showing.length;
    const moreRow = rest
      ? {
          html: `<tr><td class="email-card" style="padding:8px 12px;background:${c.surface};border-top:1px solid ${c.line}"><a href="${safeHref(href)}" target="_blank" class="email-link" style="font-size:13px;font-weight:700;color:${c.brand};text-decoration:none">and ${rest} more in this project ›</a></td></tr>`,
          text: `and ${rest} more in this project: ${href}`,
        }
      : null;
    pieces.push({
      html: `<div style="margin:0 0 8px">${box(head.html + rows.map((r) => r.html).join('') + (moreRow?.html ?? ''), c)}</div>`,
      text: [head.text, ...rows.map((r) => r.text), ...(moreRow ? [moreRow.text] : [])].join('\n'),
    });
  }
  if (left > 0) pieces.push(moreLine(`and ${left} more on the Dashboard`, dashboardLink(input.appUrl), c));
  return join(pieces);
}

/** A project's small tile: its picture, or its initials on its colour. */
function projectTile(p: DailyProject, input: DailyEmailInput, c: Brand['colors'], size: number): string {
  const color = safeColor(p.color) ?? c.brand2;
  const picture = pictureUrl(p.imageUrl, input.assetUrl);
  return picture
    ? `<img src="${escapeHtml(picture)}" alt="${escapeHtml(p.name)}" width="${size}" height="${size}" style="display:block;border:0;width:${size}px;height:${size}px;border-radius:6px;font-size:10px;color:${c.ink2}"/>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td width="${size}" height="${size}" align="center" bgcolor="${color}" style="width:${size}px;height:${size}px;border-radius:6px;background:${color};color:${initialsInk(color)};font-size:${Math.round(size * 0.4)}px;font-weight:800;line-height:${size}px;text-align:center">${escapeHtml(initialsOf(p.name))}</td></tr></table>`;
}

/** A project's head row in Other open tasks: tile, name (a link), short details, how many tasks. */
function projectHead(p: DailyProject, count: number, input: DailyEmailInput, c: Brand['colors']): Piece {
  const color = safeColor(p.color) ?? c.brand2;
  const href = projectLink(input.appUrl, p.id);
  const details = [p.code, p.number ? `No. ${p.number}` : null, p.clientName, plural(count, 'task')].filter((x): x is string => !!x);
  return {
    html: `<tr><td class="email-proj" style="padding:8px 12px;background:${TILE_BG};border-top:3px solid ${color}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr><td width="32" valign="middle" style="width:32px">${projectTile(p, input, c, 24)}</td><td valign="middle" style="padding:0"><a href="${safeHref(href)}" target="_blank" dir="auto" class="email-text" style="font-size:14px;font-weight:800;line-height:1.3;color:${c.ink};text-decoration:none">${escapeHtml(p.name)} ›</a>${muted(details.join(' · '), c, 1)}</td></tr></table></td></tr>`,
    text: [`${p.name.toUpperCase()} — ${details.join(' · ')}`, href].join('\n'),
  };
}

// ── Meetings, completed, projects ───────────────────────────────────────────

const MEETING_STATUS: Partial<Record<DailyMeeting['status'], string>> = { IN_PROGRESS: 'Under way', COMPLETED: 'Finished' };
const RESPONSE: Partial<Record<NonNullable<DailyMeeting['response']>, string>> = { TENTATIVE: 'Maybe', PENDING: 'Not answered yet' };

function meetingRow(mt: DailyMeeting, input: DailyEmailInput, c: Brand['colors'], first: boolean): Piece {
  const tz = input.timeZone;
  const time = clock(mt.startAt, tz);
  const until = mt.endAt && zonedDayKey(mt.endAt, tz) === zonedDayKey(mt.startAt, tz) ? clock(mt.endAt, tz) : null;
  const details = [mt.projectName, mt.location ? clip(mt.location, 60) : null, mt.online ? 'Online' : null].filter((x): x is string => !!x);
  const marks = [
    ...(MEETING_STATUS[mt.status] ? [{ text: MEETING_STATUS[mt.status]!, token: STATUS_TOKEN.IN_PROGRESS, tones: STATUS_TONES.IN_PROGRESS }] : []),
    ...(mt.organizer
      ? [{ text: 'You organize', token: NEUTRAL_TOKEN, tones: NEUTRAL }]
      : mt.response && RESPONSE[mt.response]
        ? [{ text: RESPONSE[mt.response]!, token: DUE_SOON_TOKEN, tones: DUE_SOON_TONES }]
        : []),
  ];
  const href = meetingLink(input.appUrl, mt.id);
  const html =
    `<tr><td class="email-card" style="padding:9px 12px;background:${c.surface}${first ? '' : `;border-top:1px solid ${c.line}`}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr>` +
    `<td class="em-time" width="70" valign="top" style="width:70px;padding-right:10px;white-space:nowrap"><div class="email-text" style="font-size:15px;line-height:1.35;font-weight:800;color:${c.ink}">${time}</div>${until ? `<div class="email-muted" style="font-size:12px;line-height:1.3;color:${c.ink2}">to ${until}</div>` : ''}</td>` +
    `<td valign="top" style="padding:0"><a href="${safeHref(href)}" target="_blank" dir="auto" class="email-text" style="font-size:15px;line-height:1.35;font-weight:700;color:${c.ink};text-decoration:none">${escapeHtml(clip(mt.title, 140))}</a>${details.length ? muted(details.join(' · '), c) : ''}${marks.length ? `<div style="font-size:0;line-height:0">${marks.map((x) => badge(x.text, x.token, x.tones)).join(' ')}</div>` : ''}</td>` +
    `</tr></table></td></tr>`;
  const extra = [...details, ...marks.map((x) => x.text)].join(' · ');
  return { html, text: [`${until ? `${time}–${until}` : time}  ${clip(mt.title, 140)}`, ...(extra ? [`  ${extra}`] : []), `  ${href}`].join('\n') };
}

/** A task completed recently: when, and whether it was on time. */
function completedRow(t: DailyTask, input: DailyEmailInput, c: Brand['colors'], first: boolean): Piece {
  const tz = input.timeZone;
  const due = dueDayKey(t.dueDate, tz);
  const doneDay = t.completedAt ? zonedDayKey(t.completedAt, tz) : null;
  const onTime = completedOnTime(t.dueDate, t.completedAt, tz);
  const lateDays = due && doneDay ? daysBetween(due, doneDay) : 0;
  const when = t.completedAt ? `Done ${momentLabel(t.completedAt, tz)}` : null;
  const mark =
    onTime === true
      ? { text: 'On time', token: DONE_TOKEN, tones: DONE }
      : onTime === false && lateDays > 0
        ? { text: `${plural(lateDays, 'day')} late`, token: DUE_SOON_TOKEN, tones: DUE_SOON_TONES }
        : null;
  const href = taskLink(input.appUrl, t.id);
  const meta = [projectLine(t.project, input.groupByCompany), when].filter((x): x is string => !!x);
  const html =
    `<tr><td class="email-card" style="padding:9px 12px;background:${c.surface}${first ? '' : `;border-top:1px solid ${c.line}`}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr>` +
    `<td class="em-col" valign="top" style="padding-right:10px"><span class="email-muted" style="font-size:12px;font-weight:700;color:${c.ink2};white-space:nowrap">${escapeHtml(t.key)}</span>&nbsp; <a href="${safeHref(href)}" target="_blank" dir="auto" class="email-text" style="font-size:15px;line-height:1.35;font-weight:700;color:${c.ink};text-decoration:none">${escapeHtml(clip(t.title, 160))}</a>${muted(meta.join(' · '), c)}</td>` +
    (mark ? `<td class="em-col em-right" valign="top" align="right" width="128" style="width:128px;text-align:right;white-space:nowrap">${badge(mark.text, mark.token, mark.tones)}</td>` : '') +
    `</tr></table></td></tr>`;
  return { html, text: [`- ${t.key} ${clip(t.title, 160)}${mark ? ` — ${mark.text}` : ''}`, `  ${meta.join(' · ')}`, `  ${href}`].join('\n') };
}

/** One project the person runs: tile and name, done of total; at the right, its bar and what needs them. */
function projectRow(f: DailyProjectFigures, input: DailyEmailInput, c: Brand['colors'], first: boolean): Piece {
  const p = f.project;
  const href = projectLink(input.appUrl, p.id);
  const pct = Math.max(0, Math.min(100, Math.round(f.pct)));
  const facts = [p.code, `${f.done} of ${f.total} done`].filter(Boolean).join(' · ');
  const marks: string[] = [];
  const words: string[] = [];
  if (f.overdue > 0) {
    marks.push(badge(`${f.overdue} overdue`, OVERDUE_TOKEN, OVERDUE_TONES));
    words.push(`${f.overdue} overdue`);
  } else words.push('nothing overdue');
  if (f.waiting > 0) {
    marks.push(`<a href="${safeHref(toApproveLink(input.appUrl))}" target="_blank" style="text-decoration:none">${badge(`${f.waiting} to approve`, WAITING_TOKEN, WAITING)}</a>`);
    words.push(`${f.waiting} to approve`);
  }
  if (!marks.length) marks.push(`<span class="email-muted" style="display:inline-block;margin-top:4px;font-size:12px;line-height:18px;color:${c.ink2}">Nothing overdue</span>`);
  const html =
    `<tr><td class="email-card" style="padding:9px 12px;background:${c.surface}${first ? '' : `;border-top:1px solid ${c.line}`}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr>` +
    `<td class="em-col" valign="top" style="padding-right:10px"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td width="38" valign="top" style="width:38px;padding-top:2px">${projectTile(p, input, c, 28)}</td><td valign="top" style="padding:0"><a href="${safeHref(href)}" target="_blank" dir="auto" class="email-text" style="font-size:15px;line-height:1.35;font-weight:800;color:${c.ink};text-decoration:none">${escapeHtml(p.name)} ›</a>${muted(facts, c)}</td></tr></table></td>` +
    `<td class="em-col em-right" valign="top" width="220" style="width:220px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%"><tr><td valign="middle" style="padding:0">${bar(pct, DONE_TOKEN, DONE, { height: 8 })}</td><td class="email-text" width="44" align="right" valign="middle" style="width:44px;padding-left:8px;font-size:14px;font-weight:800;color:${c.ink}">${pct}%</td></tr></table><div style="font-size:0;line-height:0">${marks.join(' ')}</div></td>` +
    `</tr></table></td></tr>`;
  return { html, text: [`- ${p.name} — ${pct}% complete (${f.done} of ${f.total} done) · ${words.join(' · ')}`, `  ${href}`].join('\n') };
}

// ── Footer ───────────────────────────────────────────────────────────────────

/** "and 12 more on the Dashboard ›", when a list is cut short. */
function moreLine(words: string, href: string, c: Brand['colors']): Piece {
  return {
    html: `<p style="margin:6px 0 0;font-size:13px;line-height:1.5"><a href="${safeHref(href)}" target="_blank" class="email-link" style="font-weight:700;color:${c.brand};text-decoration:none">${escapeHtml(words)} ›</a></p>`,
    text: `${words}: ${href}`,
  };
}

/** A button that works in every client: a VML button for Word-based Outlook, a styled link elsewhere (46 px tall: a good tap target). */
function button(label: string, href: string, brand: Brand): Piece {
  const c = brand.colors;
  const safe = safeHref(href);
  const width = Math.max(180, Math.round(label.length * 9 + 56));
  return {
    html: `<table role="presentation" class="em-btn-wrap" cellpadding="0" cellspacing="0" style="margin:22px 0 16px"><tr><td style="padding:0"><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safe}" style="height:46px;v-text-anchor:middle;width:${width}px" arcsize="24%" stroke="f" fillcolor="${c.brand}"><w:anchorlock/><center style="color:${c.onBrand};font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:bold">${escapeHtml(label)}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a href="${safe}" target="_blank" class="email-btn" style="display:inline-block;padding:13px 28px;border-radius:12px;background:${c.brand};background:linear-gradient(135deg,${c.brand2} 0%,${c.brand} 100%);font-size:15px;line-height:20px;font-weight:700;color:${c.onBrand};text-decoration:none">${escapeHtml(label)}</a><!--<![endif]--></td></tr></table>`,
    text: `${label}: ${href}`,
  };
}

/** When the email comes (and in which time zone), and the links to change it. */
function preferences(input: DailyEmailInput, c: Brand['colors']): Piece {
  const app = input.appUrl;
  const links = [
    { label: 'Daily email settings', href: settingsLink(app, 'daily-email') },
    { label: 'Time zone', href: settingsLink(app, 'time-zone') },
    { label: 'Notification settings', href: settingsLink(app, 'notifications') },
  ];
  const line = `You get this email at ${input.time} every morning, ${input.timeZone} time.`;
  return {
    html: `<p class="email-muted" style="margin:0;font-size:13px;line-height:1.6;color:${c.ink2}">${escapeHtml(line)} Change what is in it or when it comes: ${links
      .map((l) => `<a href="${safeHref(l.href)}" target="_blank" class="email-link" style="color:${c.brand};font-weight:700;text-decoration:underline">${escapeHtml(l.label)}</a>`)
      .join(' · ')}</p>`,
    text: [`${line} Change what is in it or when it comes:`, ...links.map((l) => `  - ${l.label}: ${l.href}`)].join('\n'),
  };
}

// ── Email-safety lint ────────────────────────────────────────────────────────

/**
 * What a reviewer would flag for Outlook (Word's engine), Gmail and phone apps: layout by tables only
 * (every table role="presentation"), inline styles on the elements that carry text, no CSS those
 * clients drop or mangle (flex, grid, position, float, CSS variables, calc, background images, SVG,
 * scripts), and bars as table cells, never sized spans or divs. The <head>'s own style block may use
 * media queries and !important overrides (float there only undoes a mini bar's align on phones).
 */
export function emailSafetyProblems(html: string): string[] {
  const problems: string[] = [];
  const styleBlock = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('');
  const body = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/gi, '');
  if (/<script|<svg|<link\b|@import/i.test(html)) problems.push('scripts, SVG or linked styles');
  if (/display\s*:\s*(flex|grid)|position\s*:|var\(|calc\(/i.test(styleBlock)) problems.push('the style block uses flex, grid, position, var( or calc(');
  for (const m of body.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const name = m[1]!.toLowerCase();
    const attrs = m[2] ?? '';
    const style = /style="([^"]*)"/i.exec(attrs)?.[1] ?? '';
    const flat = style.replace(/\s+/g, '');
    if (/display:(flex|grid)/i.test(flat)) problems.push(`<${name}> uses ${/display:(flex|grid)/i.exec(flat)![0]}`);
    if (/(^|;)position:/i.test(flat)) problems.push(`<${name}> uses position`);
    if (/(^|;)float:/i.test(flat)) problems.push(`<${name}> uses float`);
    if (/var\(/i.test(flat)) problems.push(`<${name}> uses var(`);
    if (/calc\(/i.test(flat)) problems.push(`<${name}> uses calc(`);
    if (/background-image|url\(/i.test(flat)) problems.push(`<${name}> uses a background image`);
    if (name === 'table' && !/role="presentation"/.test(attrs)) problems.push('a <table> without role="presentation"');
    if ((name === 'span' || name === 'div') && /(^|;)(width|height):/i.test(flat) && /background/i.test(flat)) problems.push(`a <${name}> drawn as a bar (bars are table cells)`);
    if (['td', 'div', 'span', 'a', 'p', 'h1', 'h2', 'h3'].includes(name) && !style) problems.push(`a <${name}> without an inline style`);
    if (name === 'img' && !/\balt="/.test(attrs)) problems.push('an <img> without alt text');
  }
  return [...new Set(problems)];
}
