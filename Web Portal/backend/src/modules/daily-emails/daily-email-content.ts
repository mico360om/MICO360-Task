import { withGuestsText } from '../tasks/guest-contacts';
import { chipsHtml, escapeHtml, initialsInk, initialsOf, renderEmail, safeHref, type Block, type EmailChip } from '../email/email-layout';
import { resolveBrand, type Brand } from '../email/brand';
import type { EmailContent, TemplateOptions } from '../email/email-templates';
import { completedOnTime, daysUntilDue, dueDayKey, zonedDayKey } from '../../lib/due-date';
import { formatDay } from '../../lib/export-format';
import type { DailyEmailPart } from '../notifications/notification-preferences';
import { OVERDUE_TONES } from '../../lib/colour-scheme';

/** A task's project, as the daily email heads its section. */
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
  /** Companies: the project's main company — the email's heading above its section when grouped. */
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
  /** Its column's status ("In Progress"). */
  statusLabel: string;
  completedAt: Date | null;
  /** Waiting for approval since (task approvals): handed in — marked so, never counted as overdue (owner, 30 Oct). */
  waitingSince?: Date | null;
  description?: string | null;
  startDate?: Date | null;
  /** Its checklist: how many items are done, of how many. */
  checklist?: { done: number; total: number } | null;
  /** The newest comment or change, as one line ("Sara Ali: “…”", "Omar moved this task (To Do → Done)"). */
  latest?: { text: string; at: Date } | null;
  /** A task it depends on isn't done yet. */
  blocked?: boolean;
  /** Who it is assigned to (shown in "In your projects" only: everyone else's tasks are their own). */
  assignees?: string[];
  /** 1.24: its guests (name and company only — a guest's email or phone is never in an email). */
  guests?: { name: string; company: string | null }[];
  /** 1.24: its categories' names. */
  categories?: string[];
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
  /** Companies: tasks in 2+ companies — the project sections are grouped under each company's name. */
  groupByCompany?: boolean;
}

const PRIORITY_CHIP: Record<DailyTask['priority'], EmailChip | null> = {
  URGENT: { text: 'Urgent', tone: 'danger' },
  HIGH: { text: 'High priority', tone: 'warning' },
  // Normal is every task's default: it isn't said.
  NORMAL: null,
  LOW: { text: 'Low priority', tone: 'muted' },
};
const PRIORITY_RANK: Record<DailyTask['priority'], number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const STATUS_CHIP: Record<DailyProject['status'], EmailChip> = {
  PLANNING: { text: 'Planning', tone: 'info' },
  ACTIVE: { text: 'Active', tone: 'success' },
  ON_HOLD: { text: 'On hold', tone: 'warning' },
  COMPLETED: { text: 'Completed', tone: 'success' },
  ARCHIVED: { text: 'Archived', tone: 'muted' },
};

const base = (appUrl: string) => appUrl.replace(/\/+$/, '');
/** The task, opened on My Tasks. */
export const taskLink = (appUrl: string, id: string) => `${base(appUrl)}/my-tasks?task=${encodeURIComponent(id)}`;
/** Someone else's task, opened on its project's page. */
const projectTaskLink = (appUrl: string, projectId: string, id: string) => `${base(appUrl)}/projects/${encodeURIComponent(projectId)}?task=${encodeURIComponent(id)}`;
const projectLink = (appUrl: string, id: string) => `${base(appUrl)}/projects/${encodeURIComponent(id)}`;
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

/** "Wed 4 Nov 2026" for a 'YYYY-MM-DD' day. */
const dayLabel = (key: string): string => formatDay(key, { weekday: true, year: true });
/** "09:05" for an instant, in a time zone. */
function clock(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}
/** "Tue 3 Nov 2026, 09:10". */
const momentLabel = (at: Date, timeZone: string) => `${dayLabel(zonedDayKey(at, timeZone))}, ${clock(at, timeZone)}`;
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

/** How many of each list fit; tighter steps when the email would be too big for Gmail (it cuts off emails over about 102 KB). */
interface Limits {
  schedule: number;
  urgent: number;
  perProject: number;
  projectTasks: number;
  projects: number;
  managed: number;
  completed: number;
}
const LADDER: Limits[] = [
  { schedule: 15, urgent: 10, perProject: 8, projectTasks: 25, projects: 8, managed: 8, completed: 10 },
  { schedule: 12, urgent: 6, perProject: 5, projectTasks: 15, projects: 6, managed: 5, completed: 6 },
  { schedule: 8, urgent: 4, perProject: 3, projectTasks: 8, projects: 4, managed: 3, completed: 4 },
  { schedule: 5, urgent: 2, perProject: 2, projectTasks: 4, projects: 3, managed: 2, completed: 2 },
];
/** Well under Gmail's ~102 KB: the email's own size, with room for what the email provider adds. */
const BUDGET_BYTES = 95_000;

/** One of the email's own pieces: its HTML and its plain-text version. */
interface Piece {
  html: string;
  text: string;
}
const markup = (p: Piece): Block => ({ kind: 'markup', html: p.html, text: p.text });

/** The email's own styles: tiles side by side on wide screens, three to a row on phones; dark mode. */
const CSS =
  '@media (max-width:620px){.email-stat{display:inline-block!important;width:33.33%!important;box-sizing:border-box!important}.email-btn{display:block!important;text-align:center!important}.email-sched-time{width:72px!important}}' +
  `@media (prefers-color-scheme:dark){.email-stat-danger{color:${OVERDUE_TONES.dark.text}!important}.email-btn{color:#FFFFFF!important}.email-sub{color:#D9CFCB!important}}`;

/**
 * The daily email (1.22: one email, replacing the pending-tasks and completed-yesterday emails): the
 * summary numbers; Today's schedule (meetings and tasks due at a time today, by time); Overdue &
 * urgent (days overdue, highest first); the rest of the person's tasks grouped by project, by urgency;
 * In your projects (for people who run a project: its overdue and waiting-for-approval tasks); and
 * Recently completed. Each part can be turned off; a part with nothing in it isn't shown, and with
 * nothing in any part there is no email (null). Every day and time is in the person's time zone.
 * The lists are cut short when the email would be too big for Gmail, saying how many more and where.
 */
export function dailyEmail(input: DailyEmailInput, opts: TemplateOptions = {}): EmailContent | null {
  const brand = resolveBrand(opts.brand);
  const model = classify(input);
  if (!model.hasContent) return null;
  let built: { html: string; text: string } | null = null;
  for (const limits of LADDER) {
    built = renderEmail({
      preheader: model.summaryText,
      heading: greeting(input),
      headerNote: dayLabel(model.today),
      blocks: blocksFor(input, model, limits, brand),
      brand: opts.brand,
      locale: opts.locale,
      css: CSS,
    });
    if (Buffer.byteLength(built.html, 'utf8') <= BUDGET_BYTES) break;
  }
  return { subject: model.subject, html: built!.html, text: built!.text };
}

/** "Good morning, Ada" — or afternoon or evening, by the person's clock (a test sent later in the day). */
function greeting(input: DailyEmailInput): string {
  const hour = Number(clock(input.now, input.timeZone).slice(0, 2));
  return `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${input.name}`;
}

type Model = ReturnType<typeof classify>;

/** What goes where: the numbers, and each part's items in order. */
function classify(input: DailyEmailInput) {
  const { parts, timeZone: tz, now } = input;
  const today = zonedDayKey(now, tz);
  const days = (t: DailyTask) => daysUntilDue(t.dueDate, tz, now);
  const waiting = (t: DailyTask) => Boolean(t.waitingSince);
  const open = input.tasks.filter((t) => !waiting(t));
  const isOverdue = (t: DailyTask) => !waiting(t) && (days(t) ?? 0) < 0;
  const overdue = open.filter(isOverdue).length;
  const dueToday = open.filter((t) => days(t) === 0).length;
  const upcoming = open.filter((t) => (days(t) ?? -1) > 0).length;
  const handedIn = input.tasks.length - open.length;
  const completed = parts.completed ? [...input.completed].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0) || byKey(a, b)) : [];

  // Today's schedule: meetings, and the person's tasks due at a time today.
  const timed = open.filter((t) => t.dueDate && hasDueTime(t.dueDate) && zonedDayKey(t.dueDate, tz) === today);
  const schedule: Array<{ at: Date; meeting?: DailyMeeting; task?: DailyTask }> = parts.schedule
    ? [...input.meetings.map((m) => ({ at: m.startAt, meeting: m })), ...timed.map((t) => ({ at: t.dueDate!, task: t }))].sort((a, b) => a.at.getTime() - b.at.getTime())
    : [];

  // Overdue & urgent: overdue (most days first), then urgent ones.
  const dueKey = (t: DailyTask) => dueDayKey(t.dueDate, tz) ?? '9999';
  const urgent = parts.urgent
    ? open
        .filter((t) => isOverdue(t) || t.priority === 'URGENT')
        .sort((a, b) => Number(!isOverdue(a)) - Number(!isOverdue(b)) || dueKey(a).localeCompare(dueKey(b)) || byKey(a, b))
    : [];
  const inUrgent = new Set(urgent.map((t) => t.id));

  // The rest by project, most urgent first: overdue, due today, high priority, due soon, the rest, handed in.
  const rank = (t: DailyTask) => {
    if (waiting(t)) return 5;
    const d = days(t);
    if (d !== null && d < 0) return 0;
    if (d === 0) return 1;
    if (t.priority === 'HIGH' || t.priority === 'URGENT') return 2;
    if (d !== null && d <= 7) return 3;
    return 4;
  };
  const rest = parts.pending
    ? input.tasks
        .filter((t) => !inUrgent.has(t.id))
        .sort((a, b) => rank(a) - rank(b) || dueKey(a).localeCompare(dueKey(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byKey(a, b))
    : [];
  const groups = byProject(rest);
  const projectGroups = input.groupByCompany ? byCompany(groups) : groups;

  // In your projects: overdue (most days first), then waiting for approval (longest first).
  const managed = parts.managed
    ? input.managed
        .filter((t) => waiting(t) || isOverdue(t))
        .sort(
          (a, b) =>
            Number(waiting(a)) - Number(waiting(b)) ||
            (waiting(a) ? a.waitingSince!.getTime() - b.waitingSince!.getTime() : dueKey(a).localeCompare(dueKey(b))) ||
            byKey(a, b),
        )
    : [];

  const approvals = parts.urgent || parts.pending || parts.managed ? input.awaitingApproval : 0;
  const hasContent = schedule.length > 0 || urgent.length > 0 || rest.length > 0 || managed.length > 0 || completed.length > 0 || approvals > 0;

  const numbers = [
    { label: 'Pending', word: 'pending', n: open.length, danger: false },
    { label: 'Overdue', word: 'overdue', n: overdue, danger: overdue > 0 },
    { label: 'Due today', word: 'due today', n: dueToday, danger: false },
    { label: 'Upcoming', word: 'upcoming', n: upcoming, danger: false },
    ...(parts.completed ? [{ label: 'Completed', word: 'completed recently', n: completed.length, danger: false }] : []),
  ];
  const summaryText = numbers.map((x) => `${x.n} ${x.word}`).join(' · ');

  const meetings = schedule.filter((s) => s.meeting).length;
  const said = [overdue > 0 && `${overdue} overdue`, dueToday > 0 && `${dueToday} due`, meetings > 0 && plural(meetings, 'meeting')].filter(Boolean);
  const subjectDay = formatDay(today, { weekday: true, year: false });
  const subjectWhat = said.length
    ? said.join(', ')
    : open.length
      ? plural(open.length, 'open task')
      : approvals
        ? `${plural(approvals, 'task')} to approve`
        : completed.length
          ? `${plural(completed.length, 'task')} completed recently`
          : managed.length
            ? `${plural(managed.length, 'task')} to check in your projects`
            : 'your day';
  const subject = `Today: ${subjectWhat} — ${subjectDay}`;

  return { today, days, waiting, isOverdue, numbers, summaryText, handedIn, schedule, urgent, projectGroups, managed, completed, approvals, hasContent, subject };
}

/** The tasks of each project, the projects in the order their first task comes. */
function byProject(tasks: DailyTask[]): Array<{ project: DailyProject; tasks: DailyTask[] }> {
  const groups = new Map<string, { project: DailyProject; tasks: DailyTask[] }>();
  for (const t of tasks) {
    const group = groups.get(t.project.id) ?? { project: t.project, tasks: [] };
    group.tasks.push(t);
    groups.set(t.project.id, group);
  }
  return [...groups.values()];
}

/** Companies: the project sections in company-name order (a project under its main company), keeping their own order inside each. */
function byCompany<G extends { project: DailyProject }>(groups: G[]): G[] {
  const name = (g: G) => g.project.company?.name ?? '';
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => collator.compare(name(a.g), name(b.g)) || a.i - b.i)
    .map((x) => x.g);
}

/** The email's blocks with these limits. */
function blocksFor(input: DailyEmailInput, m: Model, limits: Limits, brand: Brand): Block[] {
  const c = brand.colors;
  const app = input.appUrl;
  const tz = input.timeZone;
  const blocks: Block[] = [];

  // ── Summary numbers ──
  blocks.push(markup(statsPiece(m.numbers, c)));
  const note = `Times are in your time zone, ${tz}.${m.handedIn ? ` ${m.handedIn === 1 ? '1 of your tasks is' : `${m.handedIn} of your tasks are`} waiting for approval.` : ''}`;
  blocks.push(markup({ html: `<p class="email-muted" style="margin:0 0 16px;font-size:13px;line-height:1.5;color:${c.ink2}">${escapeHtml(note)}</p>`, text: note }));
  if (m.approvals > 0) {
    const line = `${m.approvals === 1 ? '1 task is' : `${m.approvals} tasks are`} waiting for your approval.`;
    blocks.push(
      markup({
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="background:#E9F0F7;border-left:4px solid #3A6EA5;border-radius:8px;padding:12px 16px;font-size:14px;line-height:1.5;color:#274b70">${escapeHtml(line)} <a href="${safeHref(toApproveLink(app))}" target="_blank" style="font-weight:700;color:#274b70;text-decoration:underline">Review them</a></td></tr></table>`,
        text: `> ${line} Review them: ${toApproveLink(app)}`,
      }),
    );
  }

  const card = cardMaker(input, m, c);
  const moreLine = (left: number): Block[] => (left > 0 ? [markup(moreToDashboard(left, app, c))] : []);

  // ── Today's schedule ──
  if (m.schedule.length) {
    const shown = m.schedule.slice(0, limits.schedule);
    blocks.push({ kind: 'heading', text: 'Today’s schedule' });
    blocks.push(markup(listBox(shown.map((s, i) => (s.meeting ? meetingRow(s.meeting, input, c, i) : timedTaskRow(s.task!, input, c, i))))));
    blocks.push(...moreLine(m.schedule.length - shown.length));
  }

  // ── Overdue & urgent ──
  if (m.urgent.length) {
    const shown = m.urgent.slice(0, limits.urgent);
    blocks.push({ kind: 'heading', text: `Overdue & urgent (${m.urgent.length})` });
    blocks.push(markup(listBox(shown.map((t, i) => card(t, { flat: true, first: i === 0 })))));
    blocks.push(...moreLine(m.urgent.length - shown.length));
  }

  // ── The rest, by project ──
  if (m.projectGroups.length) {
    blocks.push({ kind: 'heading', text: m.urgent.length ? 'Your other tasks' : 'Your tasks' });
    let room = limits.projectTasks;
    let left = 0;
    let lastCompany: string | null | undefined;
    let shownProjects = 0;
    for (const g of m.projectGroups) {
      if (room <= 0 || shownProjects >= limits.projects) {
        left += g.tasks.length;
        continue;
      }
      const company = input.groupByCompany ? (g.project.company ?? null) : undefined;
      if (input.groupByCompany && company?.id !== lastCompany) {
        if (company) blocks.push(markup(companyHeading(company.name, c)));
        lastCompany = company?.id;
      }
      const showing = g.tasks.slice(0, Math.min(limits.perProject, room));
      room -= showing.length;
      shownProjects++;
      blocks.push(markup(projectPiece(g.project, g.tasks, showing, input, m, c, card)));
    }
    blocks.push(...moreLine(left));
  }

  // ── In your projects ──
  if (m.managed.length) {
    const shown = m.managed.slice(0, limits.managed);
    const intro = 'Overdue and waiting-for-approval tasks of the projects you run.';
    blocks.push({ kind: 'heading', text: 'In your projects' });
    blocks.push(markup({ html: `<p class="email-muted" style="margin:0 0 10px;font-size:13px;line-height:1.5;color:${c.ink2}">${intro}</p>`, text: intro }));
    blocks.push(markup(listBox(shown.map((t, i) => card(t, { flat: true, first: i === 0, managed: true })))));
    blocks.push(...moreLine(m.managed.length - shown.length));
  }

  // ── Recently completed ──
  if (m.completed.length) {
    const shown = m.completed.slice(0, limits.completed);
    const since = `Since ${momentLabel(input.completedSince, tz)}.`;
    blocks.push({ kind: 'heading', text: 'Recently completed' });
    blocks.push(markup({ html: `<p class="email-muted" style="margin:0 0 10px;font-size:13px;line-height:1.5;color:${c.ink2}">${escapeHtml(since)}</p>`, text: since }));
    blocks.push(markup(listBox(shown.map((t, i) => completedRow(t, input, c, i)))));
    blocks.push(...moreLine(m.completed.length - shown.length));
  }

  // ── The dashboard, and where to change this email ──
  blocks.push(markup(button('Open the dashboard', dashboardLink(app), brand)));
  blocks.push(markup(preferences(input, c)));
  return blocks;
}

/** The summary numbers: a row of tiles (three to a row on phones). */
function statsPiece(numbers: Array<{ label: string; n: number; danger: boolean }>, c: Brand['colors']): Piece {
  const width = `${Math.floor(100 / numbers.length)}%`;
  const cells = numbers
    .map(
      (x) =>
        `<td class="email-stat" width="${width}" valign="top" style="padding:4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="email-proj" align="center" style="padding:12px 4px;background:#FAF7F6;border:1px solid ${c.line};border-radius:12px"><div class="${x.danger ? 'email-stat-danger' : 'email-text'}" style="font-size:24px;line-height:1.1;font-weight:800;color:${x.danger ? OVERDUE_TONES.light.text : c.ink}">${x.n}</div><div class="email-muted" style="margin-top:4px;font-size:12px;line-height:1.3;color:${c.ink2}">${escapeHtml(x.label)}</div></td></tr></table></td>`,
    )
    .join('');
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr>${cells}</tr></table>`,
    text: numbers.map((x) => `${x.n} ${x.label === 'Completed' ? 'completed recently' : x.label.toLowerCase()}`).join(' · '),
  };
}

/** A bordered list of rows (cards). */
function listBox(rows: Piece[]): Piece {
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-details" style="margin:0 0 16px;border:1px solid #E6DFDC;border-radius:12px;border-collapse:separate">${rows.map((r) => r.html).join('')}</table>`,
    text: rows.map((r) => r.text).join('\n'),
  };
}

const rowStyle = (c: Brand['colors'], first: boolean) => `padding:12px 14px;background:${c.surface}${first ? '' : `;border-top:1px solid ${c.line}`}`;
const titleLink = (href: string, title: string, c: Brand['colors']) =>
  `<a href="${safeHref(href)}" target="_blank" dir="auto" class="email-text" style="font-size:15px;font-weight:700;line-height:1.4;color:${c.ink};text-decoration:none">${escapeHtml(title)}</a>`;
const mutedLine = (text: string, c: Brand['colors'], top = 2) =>
  `<div class="email-muted" dir="auto" style="margin-top:${top}px;font-size:13px;line-height:1.5;color:${c.ink2}">${escapeHtml(text)}</div>`;
const chipLine = (chips: EmailChip[]) => (chips.length ? `<div>${chipsHtml(chips)}</div>` : '');
const chipWords = (chips: EmailChip[]) => chips.map((ch) => ch.text).join(' · ');
const indent = (lines: Array<string | null | undefined | false>) => lines.filter((l): l is string => !!l).map((l) => `  ${l}`);

/** "Rig Inspection (Acme Drilling)", with the company when the email is grouped. */
function projectLine(p: DailyProject, grouped: boolean | undefined): string {
  const name = p.clientName ? `${p.name} (${p.clientName})` : p.name;
  return grouped && p.company ? `${name} · ${p.company.name}` : name;
}

/** Makes a task's card: title, ID, project, status, priority, start, due, checklist, a short description, the latest update, marks. */
function cardMaker(input: DailyEmailInput, m: Model, c: Brand['colors']) {
  const tz = input.timeZone;
  return (t: DailyTask, o: { flat?: boolean; first?: boolean; managed?: boolean }): Piece => {
    const d = m.days(t);
    const key = dueDayKey(t.dueDate, tz);
    const at = t.dueDate && hasDueTime(t.dueDate) ? `, ${clock(t.dueDate, tz)}` : '';
    let due: EmailChip | null = null;
    if (key && d !== null) {
      if (d < 0 && !m.waiting(t)) due = { text: `${plural(-d, 'day')} overdue`, tone: 'danger' };
      else if (d === 0) due = { text: `Due today${at}`, tone: 'warning' };
      else due = { text: `Due ${dayLabel(key)}${at}`, tone: d < 0 ? 'muted' : 'info' };
    }
    const chips = [
      due,
      PRIORITY_CHIP[t.priority],
      { text: t.statusLabel, tone: 'outline' } as EmailChip,
      m.waiting(t) ? ({ text: 'Waiting for approval', tone: 'info' } as EmailChip) : null,
      t.blocked ? ({ text: 'Blocked', tone: 'danger' } as EmailChip) : null,
    ].filter((x): x is EmailChip => !!x);
    const start = dueDayKey(t.startDate ?? null, tz);
    const facts = [
      start ? `Start ${dayLabel(start)}` : null,
      t.checklist?.total ? `Checklist ${t.checklist.done} of ${t.checklist.total}` : null,
      // 1.24: "with guest Ahmed (OXY)" and its categories.
      withGuestsText(t.guests) || null,
      t.categories?.length ? `Categories: ${t.categories.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const assigned = o.managed && t.assignees?.length ? `Assigned to ${t.assignees.join(', ')}` : null;
    const meta = o.flat ? [projectLine(t.project, input.groupByCompany), assigned].filter(Boolean).join(' · ') : '';
    const description = t.description ? clip(t.description, 160) : '';
    const latest = t.latest?.text ? `Latest: ${clip(t.latest.text, 120)} · ${dayLabel(zonedDayKey(t.latest.at, tz))}` : '';
    const href = o.managed ? projectTaskLink(input.appUrl, t.project.id, t.id) : taskLink(input.appUrl, t.id);
    const html = `<tr><td class="email-card" style="${rowStyle(c, o.first === true)}">${titleLink(href, t.title, c)}${mutedLine(meta ? `${t.key} · ${meta}` : t.key, c)}${chipLine(chips)}${facts ? mutedLine(facts, c, 6) : ''}${description ? `<div class="email-text" dir="auto" style="margin-top:6px;font-size:13px;line-height:1.5;color:${c.ink}">${escapeHtml(description)}</div>` : ''}${latest ? `<div class="email-muted email-sub" dir="auto" style="margin-top:6px;font-size:12px;line-height:1.5;color:${c.ink2}">${escapeHtml(latest)}</div>` : ''}</td></tr>`;
    const text = [`- ${t.title} (${t.key})${chips.length ? ` — ${chipWords(chips)}` : ''}`, ...indent([meta, facts, description, latest, href])].join('\n');
    return { html, text };
  };
}

/** A project's section: its head (picture, name, details, labels) and its tasks' cards. */
function projectPiece(
  p: DailyProject,
  all: DailyTask[],
  showing: DailyTask[],
  input: DailyEmailInput,
  m: Model,
  c: Brand['colors'],
  card: ReturnType<typeof cardMaker>,
): Piece {
  const tz = input.timeZone;
  const color = /^#[0-9a-f]{6}$/i.test(p.color ?? '') ? p.color! : c.brand2;
  const target = dueDayKey(p.targetDate, tz);
  const details = [p.code, p.number ? `No. ${p.number}` : null, p.clientName ? `Client: ${p.clientName}` : null, p.managerName ? `Manager: ${p.managerName}` : null, target ? `Target ${dayLabel(target)}` : null].filter(
    (x): x is string => !!x,
  );
  const late = all.filter(m.isOverdue).length;
  const today = all.filter((t) => !m.waiting(t) && m.days(t) === 0).length;
  const chips: EmailChip[] = [
    STATUS_CHIP[p.status],
    { text: plural(all.length, 'task'), tone: 'neutral' },
    ...(late ? [{ text: `${late} overdue`, tone: 'danger' } as EmailChip] : []),
    ...(today ? [{ text: `${today} due today`, tone: 'warning' } as EmailChip] : []),
  ];
  const href = projectLink(input.appUrl, p.id);
  const picture = pictureUrl(p.imageUrl, input.assetUrl);
  const tile = picture
    ? `<img src="${escapeHtml(picture)}" alt="${escapeHtml(p.name)}" width="40" height="40" style="display:block;border:0;width:40px;height:40px;border-radius:10px;object-fit:cover;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:${c.ink2}"/>`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" bgcolor="${color}" style="width:40px;height:40px;border-radius:10px;background:${color};color:${initialsInk(color)};font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:800;line-height:40px;text-align:center">${escapeHtml(initialsOf(p.name))}</td></tr></table>`;
  const head = `<tr><td class="email-proj" style="padding:12px 14px;background:#FAF7F6;border-top:4px solid ${color};border-bottom:1px solid ${c.line}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="52" valign="top" style="width:52px">${tile}</td><td valign="top"><a href="${safeHref(href)}" target="_blank" dir="auto" class="email-text" style="font-size:16px;font-weight:800;line-height:1.3;color:${c.ink};text-decoration:none">${escapeHtml(p.name)} ›</a>${details.length ? mutedLine(details.join(' · '), c, 3) : ''}${chipLine(chips)}</td></tr></table></td></tr>`;
  // Under the head, every card has a line above it.
  const rows = showing.map((t) => card(t, { first: false }));
  const left = all.length - showing.length;
  const more = left
    ? `<tr><td class="email-card" style="padding:10px 14px;background:${c.surface};border-top:1px solid ${c.line}"><a href="${safeHref(href)}" target="_blank" class="email-link" style="font-size:13px;font-weight:700;color:${c.brand};text-decoration:none">and ${left} more in this project ›</a></td></tr>`
    : '';
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-details" style="margin:0 0 16px;border:1px solid ${c.line};border-radius:14px;border-collapse:separate;overflow:hidden">${head}${rows.map((r) => r.html).join('')}${more}</table>`,
    text: [
      `${p.name.toUpperCase()}${details.length ? ` — ${details.join(' · ')}` : ''}`,
      chipWords(chips),
      href,
      ...rows.map((r) => r.text),
      ...(left ? [`and ${left} more in this project: ${href}`] : []),
    ].join('\n'),
  };
}

/** A company's name above its projects (an email grouped by company). */
const companyHeading = (name: string, c: Brand['colors']): Piece => ({
  html: `<div class="email-text" dir="auto" style="margin:18px 0 8px;font-size:15px;line-height:1.3;font-weight:800;color:${c.ink}">${escapeHtml(name)}</div>`,
  text: `-- ${name} --`,
});

const MEETING_STATUS: Partial<Record<DailyMeeting['status'], string>> = { IN_PROGRESS: 'Under way', COMPLETED: 'Finished' };
const RESPONSE: Partial<Record<NonNullable<DailyMeeting['response']>, string>> = { TENTATIVE: 'Maybe', PENDING: 'Not answered yet' };

/** A schedule row: the time on the left, what on the right. */
function scheduleRow(o: { time: string; until: string | null; href: string; title: string; kind: string; details: string[]; chips: EmailChip[]; first: boolean; textTitle: string }, c: Brand['colors']): Piece {
  const html = `<tr><td class="email-card" style="${rowStyle(c, o.first).replace('12px 14px', '10px 14px')}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="email-sched-time" width="84" valign="top" style="width:84px;padding-right:10px;white-space:nowrap"><div class="email-text" style="font-size:15px;line-height:1.4;font-weight:800;color:${c.ink}">${o.time}</div>${o.until ? `<div class="email-muted" style="font-size:12px;line-height:1.4;color:${c.ink2}">to ${o.until}</div>` : ''}</td><td valign="top">${titleLink(o.href, o.title, c)}${mutedLine([o.kind, ...o.details].join(' · '), c)}${chipLine(o.chips)}</td></tr></table></td></tr>`;
  const head = `${o.until ? `${o.time}–${o.until}` : o.time}  ${o.textTitle}`;
  const extra = [...o.details, ...o.chips.map((ch) => ch.text)].join(' · ');
  return { html, text: [head, ...indent([extra, o.href])].join('\n') };
}

function meetingRow(mt: DailyMeeting, input: DailyEmailInput, c: Brand['colors'], i: number): Piece {
  const tz = input.timeZone;
  const details = [mt.projectName, mt.location ? clip(mt.location, 60) : null, mt.online ? 'Online' : null].filter((x): x is string => !!x);
  const chips: EmailChip[] = [
    ...(MEETING_STATUS[mt.status] ? [{ text: MEETING_STATUS[mt.status]!, tone: 'info' } as EmailChip] : []),
    ...(mt.organizer ? [{ text: 'You organize', tone: 'neutral' } as EmailChip] : mt.response && RESPONSE[mt.response] ? [{ text: RESPONSE[mt.response]!, tone: 'warning' } as EmailChip] : []),
  ];
  return scheduleRow(
    {
      time: clock(mt.startAt, tz),
      until: mt.endAt && zonedDayKey(mt.endAt, tz) === zonedDayKey(mt.startAt, tz) ? clock(mt.endAt, tz) : null,
      href: meetingLink(input.appUrl, mt.id),
      title: mt.title,
      kind: 'Meeting',
      details,
      chips,
      first: i === 0,
      textTitle: `${mt.title} (meeting)`,
    },
    c,
  );
}

function timedTaskRow(t: DailyTask, input: DailyEmailInput, c: Brand['colors'], i: number): Piece {
  return scheduleRow(
    {
      time: clock(t.dueDate!, input.timeZone),
      until: null,
      href: taskLink(input.appUrl, t.id),
      title: t.title,
      kind: `Task due · ${t.key}`,
      details: [projectLine(t.project, input.groupByCompany)],
      chips: [],
      first: i === 0,
      textTitle: `${t.title} (${t.key}, due)`,
    },
    c,
  );
}

/** A task completed recently: when, and whether it was on time. */
function completedRow(t: DailyTask, input: DailyEmailInput, c: Brand['colors'], i: number): Piece {
  const tz = input.timeZone;
  const due = dueDayKey(t.dueDate, tz);
  const doneDay = t.completedAt ? zonedDayKey(t.completedAt, tz) : null;
  const onTime = completedOnTime(t.dueDate, t.completedAt, tz);
  const lateDays = due && doneDay ? Math.round((Date.parse(`${doneDay}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 864e5) : 0;
  const chips: EmailChip[] = [
    ...(t.completedAt ? [{ text: `Completed ${momentLabel(t.completedAt, tz)}`, tone: 'neutral' } as EmailChip] : []),
    ...(onTime === true ? [{ text: 'On time', tone: 'success' } as EmailChip] : onTime === false && lateDays > 0 ? [{ text: `${plural(lateDays, 'day')} late`, tone: 'warning' } as EmailChip] : []),
  ];
  const href = taskLink(input.appUrl, t.id);
  const meta = projectLine(t.project, input.groupByCompany);
  return {
    html: `<tr><td class="email-card" style="${rowStyle(c, i === 0).replace('12px 14px', '10px 14px')}">${titleLink(href, t.title, c)}${mutedLine(`${t.key} · ${meta}`, c)}${chipLine(chips)}</td></tr>`,
    text: [`- ${t.title} (${t.key})${chips.length ? ` — ${chipWords(chips)}` : ''}`, ...indent([meta, href])].join('\n'),
  };
}

/** "and 12 more · open the dashboard", when a list is cut short. */
function moreToDashboard(left: number, appUrl: string, c: Brand['colors']): Piece {
  const href = dashboardLink(appUrl);
  return {
    html: `<p style="margin:-6px 0 16px;font-size:13px;line-height:1.5"><a href="${safeHref(href)}" target="_blank" class="email-link" style="font-weight:700;color:${c.brand};text-decoration:none">and ${left} more · open the dashboard ›</a></p>`,
    text: `and ${left} more · open the dashboard: ${href}`,
  };
}

/** A button that works in every client: a VML button for Word-based Outlook, a styled link elsewhere. */
function button(label: string, href: string, brand: Brand): Piece {
  const c = brand.colors;
  const safe = safeHref(href);
  const width = Math.max(180, Math.round(label.length * 9 + 56));
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 20px"><tr><td><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safe}" style="height:46px;v-text-anchor:middle;width:${width}px" arcsize="24%" stroke="f" fillcolor="${c.brand}"><w:anchorlock/><center style="color:${c.onBrand};font-family:Arial,sans-serif;font-size:15px;font-weight:bold">${escapeHtml(label)}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a href="${safe}" target="_blank" class="email-btn" style="display:inline-block;padding:13px 28px;border-radius:12px;background:${c.brand};background:linear-gradient(135deg,${c.brand2} 0%,${c.brand} 100%);font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:${c.onBrand};text-decoration:none">${escapeHtml(label)}</a><!--<![endif]--></td></tr></table>`,
    text: `${label}: ${href}`,
  };
}

/** When the email comes, and the links to change it: the daily email's settings, the time zone, the notifications. */
function preferences(input: DailyEmailInput, c: Brand['colors']): Piece {
  const app = input.appUrl;
  const links = [
    { label: 'Daily email settings', href: settingsLink(app, 'daily-email') },
    { label: 'Time zone', href: settingsLink(app, 'time-zone') },
    { label: 'Notification settings', href: settingsLink(app, 'notifications') },
  ];
  const line = `You get this email at ${input.time} every morning.`;
  return {
    html: `<p class="email-muted" style="margin:0;font-size:13px;line-height:1.6;color:${c.ink2}">${escapeHtml(line)} Change what is in it or when it comes: ${links
      .map((l) => `<a href="${safeHref(l.href)}" target="_blank" class="email-link" style="color:${c.brand};font-weight:700;text-decoration:underline">${escapeHtml(l.label)}</a>`)
      .join(' · ')}</p>`,
    text: [`${line} Change what is in it or when it comes:`, ...links.map((l) => `  - ${l.label}: ${l.href}`)].join('\n'),
  };
}
