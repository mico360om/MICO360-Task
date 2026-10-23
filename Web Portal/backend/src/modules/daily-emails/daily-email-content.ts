import { renderEmail, type Block, type EmailChip, type EmailProjectCard, type EmailTaskItem } from '../email/email-layout';
import type { EmailContent, TemplateOptions } from '../email/email-templates';
import { completedOnTime, daysUntilDue, dueDayKey, zonedDayKey } from '../../lib/due-date';

/** A task's project, as the daily emails head its section. */
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
}

/** A task as the daily emails show it (read fresh from the database just before sending). */
export interface DailyTask {
  id: string;
  key: string;
  title: string;
  project: DailyProject;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueDate: Date | null;
  /** Its column's status ("In Progress"). */
  statusLabel: string;
  completedAt: Date | null;
}

const PRIORITY_CHIP: Record<DailyTask['priority'], EmailChip> = {
  URGENT: { text: 'Urgent', tone: 'danger' },
  HIGH: { text: 'High priority', tone: 'warning' },
  NORMAL: { text: 'Normal priority', tone: 'neutral' },
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
const projectLink = (appUrl: string, id: string) => `${base(appUrl)}/projects/${encodeURIComponent(id)}`;
/** A project picture at an address email clients can load: stored paths are on the server (`assetUrl`). */
function pictureUrl(imageUrl: string | null, assetUrl: string | undefined): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  return imageUrl.startsWith('/') && assetUrl ? `${base(assetUrl)}${imageUrl}` : null;
}

/** "Mon 19 Oct" for a 'YYYY-MM-DD' day. */
function dayLabel(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`)).replace(',', '');
}
/** "Wednesday 21 October" for a 'YYYY-MM-DD' day (the header's note). */
function dayLongLabel(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`)).replace(',', '');
}
/** Today, in the person's time zone. */
const todayLabel = (now: Date, timeZone: string) => dayLongLabel(zonedDayKey(now, timeZone));
/** The day after a 'YYYY-MM-DD' day. */
const nextDay = (key: string) => new Date(Date.parse(`${key}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
/** "Tue 20 Oct, 09:10" for an instant, in the person's time zone. */
function momentLabel(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${dayLabel(zonedDayKey(at, timeZone))}, ${get('hour')}:${get('minute')}`;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dueText = (t: DailyTask, timeZone: string) => {
  const key = dueDayKey(t.dueDate, timeZone);
  return key ? `Due ${dayLabel(key)}` : 'No due date';
};
const byDueThenPriority = (timeZone: string) => (a: DailyTask, b: DailyTask) =>
  (dueDayKey(a.dueDate, timeZone) ?? '9999').localeCompare(dueDayKey(b.dueDate, timeZone) ?? '9999') ||
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
  a.key.localeCompare(b.key, undefined, { numeric: true });

/** At most this many tasks of one project, tasks in all, and projects: Gmail cuts off emails over about 100 KB. */
const PER_PROJECT = 10;
const IN_ALL = 30;
const PROJECTS = 8;

/**
 * The sections that fit: up to PER_PROJECT tasks of a project, IN_ALL tasks and PROJECTS projects in
 * all, in order; with how many tasks (and projects) were left out.
 */
function fitting<G extends { tasks: DailyTask[] }>(groups: G[]): { shown: Array<G & { showing: DailyTask[] }>; leftTasks: number; leftProjects: number } {
  let room = IN_ALL;
  const shown: Array<G & { showing: DailyTask[] }> = [];
  let leftTasks = 0;
  let leftProjects = 0;
  for (const g of groups) {
    if (room <= 0 || shown.length >= PROJECTS) {
      leftTasks += g.tasks.length;
      leftProjects += 1;
      continue;
    }
    const showing = g.tasks.slice(0, Math.min(PER_PROJECT, room));
    room -= showing.length;
    shown.push({ ...g, showing });
  }
  return { shown, leftTasks, leftProjects };
}

/** "+2 more tasks in this project", linking to the project, when a section is cut short. */
const moreInProject = (g: { project: DailyProject; tasks: DailyTask[]; showing: DailyTask[] }, appUrl: string) =>
  g.tasks.length > g.showing.length ? { more: { text: `+${plural(g.tasks.length - g.showing.length, 'more task')} in this project`, href: projectLink(appUrl, g.project.id) } } : {};

/** "+10 more tasks in 1 more project. Open My Tasks to see them all." */
const moreProjects = (left: { leftTasks: number; leftProjects: number }): Block[] =>
  left.leftProjects ? [{ kind: 'text', text: `+${plural(left.leftTasks, 'more task')} in ${plural(left.leftProjects, 'more project')}. Open My Tasks to see them all.` }] : [];

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

/** A section's head: the project's details (only those it has), its status and the given labels. */
function projectCard(p: DailyProject, chips: EmailChip[], o: { appUrl: string; assetUrl?: string; timeZone: string }): EmailProjectCard {
  const target = dueDayKey(p.targetDate, o.timeZone);
  return {
    name: p.name,
    href: projectLink(o.appUrl, p.id),
    color: p.color,
    imageUrl: pictureUrl(p.imageUrl, o.assetUrl),
    details: [
      p.code,
      p.number ? `No. ${p.number}` : null,
      p.clientName ? `Client: ${p.clientName}` : null,
      p.managerName ? `Manager: ${p.managerName}` : null,
      target ? `Target ${dayLabel(target)}` : null,
    ].filter((d): d is string => !!d),
    chips: [STATUS_CHIP[p.status], ...chips],
  };
}

const counted = (chips: Array<EmailChip | false>) => chips.filter((c): c is EmailChip => !!c);
/** The day at a glance: a row of labels, or nothing when there are none. */
const glance = (chips: Array<EmailChip | false>): Block[] => (counted(chips).length ? [{ kind: 'chips', items: counted(chips) }] : []);

function render(subject: string, preheader: string, heading: string, headerNote: string, blocks: Block[], opts: TemplateOptions = {}): EmailContent {
  const { html, text } = renderEmail({ preheader, heading, headerNote, blocks, brand: opts.brand, locale: opts.locale });
  return { subject, html, text };
}

function settingsNote(appUrl: string, what: string): Block {
  return { kind: 'text', text: `You get ${what} every morning. To change the time or turn it off, open Settings → Daily task emails: ${base(appUrl)}/settings` };
}

/**
 * The morning email of someone's pending tasks (assigned to them, not done): the day at a glance, then
 * a section per project (the one with the most urgent task first), each with its details and its
 * tasks, most urgent first (overdue, due today, upcoming, no due date; then priority).
 */
export function pendingEmail(
  p: { name: string; tasks: DailyTask[]; timeZone: string; now: Date; appUrl: string; assetUrl?: string },
  opts?: TemplateOptions,
): EmailContent {
  const days = (t: DailyTask) => daysUntilDue(t.dueDate, p.timeZone, p.now);
  const isOverdue = (t: DailyTask) => (days(t) ?? 0) < 0;
  const isToday = (t: DailyTask) => days(t) === 0;
  const sorted = [...p.tasks].sort(byDueThenPriority(p.timeZone));
  const overdue = sorted.filter(isOverdue).length;
  const today = sorted.filter(isToday).length;
  const upcoming = sorted.filter((t) => (days(t) ?? -1) > 0).length;
  const noDue = sorted.filter((t) => days(t) === null).length;
  const dueChip = (t: DailyTask): EmailChip => {
    const d = days(t);
    if (d === null) return { text: 'No due date', tone: 'muted' };
    if (d < 0) return { text: `${plural(-d, 'day')} overdue`, tone: 'danger' };
    if (d === 0) return { text: 'Due today', tone: 'warning' };
    return { text: dueText(t, p.timeZone), tone: 'info' };
  };
  const item = (t: DailyTask): EmailTaskItem => ({
    title: t.title,
    href: taskLink(p.appUrl, t.id),
    key: t.key,
    chips: [dueChip(t), PRIORITY_CHIP[t.priority], { text: t.statusLabel, tone: 'outline' }],
  });
  const groups = byProject(sorted);
  const fit = fitting(groups);
  const n = p.tasks.length;
  const blocks: Block[] = [
    { kind: 'text', text: `You have ${plural(n, 'task')} that ${n === 1 ? 'isn’t' : 'aren’t'} done yet${groups.length > 1 ? `, in ${groups.length} projects` : ''}.` },
    ...glance([
      overdue > 0 && { text: `${overdue} overdue`, tone: 'danger' },
      today > 0 && { text: `${today} due today`, tone: 'warning' },
      upcoming > 0 && { text: `${upcoming} upcoming`, tone: 'info' },
      noDue > 0 && { text: `${noDue} with no due date`, tone: 'muted' },
    ]),
    ...fit.shown.map((g): Block => {
      const late = g.tasks.filter(isOverdue).length;
      const now = g.tasks.filter(isToday).length;
      return {
        kind: 'project',
        project: projectCard(
          g.project,
          counted([
            { text: `${plural(g.tasks.length, 'task')} for you`, tone: 'neutral' },
            late > 0 && { text: `${late} overdue`, tone: 'danger' },
            now > 0 && { text: `${now} due today`, tone: 'warning' },
          ]),
          p,
        ),
        items: g.showing.map(item),
        ...moreInProject(g, p.appUrl),
      };
    }),
    ...moreProjects(fit),
    { kind: 'button', label: 'Open My Tasks', href: `${base(p.appUrl)}/my-tasks` },
    settingsNote(p.appUrl, 'this email'),
  ];
  const subject = `Your pending tasks: ${n}${overdue ? ` (${overdue} overdue)` : ''}`;
  const preheader = overdue ? `${plural(overdue, 'task')} overdue, ${today} due today.` : `${today} due today.`;
  return render(subject, preheader, `Good morning, ${p.name}`, todayLabel(p.now, p.timeZone), blocks, opts);
}

/**
 * The morning email of someone's tasks completed the day before (`day`, their calendar): a section per
 * project, in the order the work was finished, each task with when, whether it was on time, its
 * priority and due day.
 */
export function completedEmail(
  p: { name: string; tasks: DailyTask[]; day: string; timeZone: string; appUrl: string; assetUrl?: string },
  opts?: TemplateOptions,
): EmailContent {
  const sorted = [...p.tasks].sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0));
  const timing = (t: DailyTask): EmailChip | null => {
    const due = dueDayKey(t.dueDate, p.timeZone);
    const done = t.completedAt ? zonedDayKey(t.completedAt, p.timeZone) : null;
    const onTime = completedOnTime(t.dueDate, t.completedAt, p.timeZone);
    const late = due && done ? Math.round((Date.parse(`${done}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 864e5) : 0;
    if (onTime === true) return { text: 'On time', tone: 'success' };
    if (onTime === false && late > 0) return { text: `${plural(late, 'day')} late`, tone: 'warning' };
    return null;
  };
  const item = (t: DailyTask): EmailTaskItem => ({
    title: t.title,
    href: taskLink(p.appUrl, t.id),
    key: t.key,
    chips: counted([
      !!t.completedAt && { text: `Completed ${momentLabel(t.completedAt, p.timeZone)}`, tone: 'neutral' },
      timing(t) ?? false,
      PRIORITY_CHIP[t.priority],
      { text: dueText(t, p.timeZone), tone: 'muted' },
    ]),
  });
  const onTime = sorted.filter((t) => timing(t)?.tone === 'success').length;
  const late = sorted.filter((t) => timing(t)?.tone === 'warning').length;
  const label = dayLabel(p.day);
  const n = sorted.length;
  const fit = fitting(byProject(sorted));
  const blocks: Block[] = [
    { kind: 'text', text: `${p.name}, here ${n === 1 ? 'is the task' : 'are the tasks'} assigned to you that ${n === 1 ? 'was' : 'were'} completed yesterday, ${label}.` },
    ...glance([onTime > 0 && { text: `${onTime} on time`, tone: 'success' }, late > 0 && { text: `${late} late`, tone: 'warning' }]),
    ...fit.shown.map(
      (g): Block => ({
        kind: 'project',
        project: projectCard(g.project, [{ text: `${plural(g.tasks.length, 'task')} done`, tone: 'neutral' }], p),
        items: g.showing.map(item),
        ...moreInProject(g, p.appUrl),
      }),
    ),
    ...moreProjects(fit),
    { kind: 'button', label: 'Open My Tasks', href: `${base(p.appUrl)}/my-tasks` },
    settingsNote(p.appUrl, 'this email'),
  ];
  return render(`Completed yesterday (${label}): ${plural(n, 'task')}`, `${plural(n, 'task')} done on ${label}.`, 'Completed yesterday', dayLongLabel(nextDay(p.day)), blocks, opts);
}
