import { renderEmail, type Block, type EmailTaskItem } from '../email/email-layout';
import type { EmailContent, TemplateOptions } from '../email/email-templates';
import { completedOnTime, daysUntilDue, dueDayKey, zonedDayKey } from '../../lib/due-date';

/** A task as the daily emails show it (read fresh from the database just before sending). */
export interface DailyTask {
  id: string;
  key: string;
  title: string;
  projectName: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  dueDate: Date | null;
  /** Its column's status ("In Progress"). */
  statusLabel: string;
  completedAt: Date | null;
}

const PRIORITY_LABEL: Record<DailyTask['priority'], string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };
const PRIORITY_RANK: Record<DailyTask['priority'], number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

const base = (appUrl: string) => appUrl.replace(/\/+$/, '');
/** The task, opened on My Tasks. */
export const taskLink = (appUrl: string, id: string) => `${base(appUrl)}/my-tasks?task=${encodeURIComponent(id)}`;

/** "Mon 19 Oct" for a 'YYYY-MM-DD' day. */
function dayLabel(key: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`)).replace(',', '');
}
/** "Tue 20 Oct, 09:10" for an instant, in the person's time zone. */
function momentLabel(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${dayLabel(zonedDayKey(at, timeZone))}, ${get('hour')}:${get('minute')}`;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dueFact = (t: DailyTask, timeZone: string) => {
  const key = dueDayKey(t.dueDate, timeZone);
  return key ? `Due ${dayLabel(key)}` : 'No due date';
};
const byDueThenPriority = (timeZone: string) => (a: DailyTask, b: DailyTask) =>
  (dueDayKey(a.dueDate, timeZone) ?? '9999').localeCompare(dueDayKey(b.dueDate, timeZone) ?? '9999') ||
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
  a.key.localeCompare(b.key, undefined, { numeric: true });

function render(subject: string, preheader: string, heading: string, blocks: Block[], opts: TemplateOptions = {}): EmailContent {
  const { html, text } = renderEmail({ preheader, heading, blocks, brand: opts.brand, locale: opts.locale });
  return { subject, html, text };
}

function settingsNote(appUrl: string, what: string): Block {
  return { kind: 'text', text: `You get ${what} every morning. To change the time or turn it off, open Settings → Daily task emails: ${base(appUrl)}/settings` };
}

/**
 * The morning email of someone's pending tasks (assigned to them, not done), grouped: overdue (most
 * overdue first), due today, upcoming, no due date; each with its priority, due day, status and link.
 */
export function pendingEmail(
  p: { name: string; tasks: DailyTask[]; timeZone: string; now: Date; appUrl: string },
  opts?: TemplateOptions,
): EmailContent {
  const days = (t: DailyTask) => daysUntilDue(t.dueDate, p.timeZone, p.now);
  const sorted = [...p.tasks].sort(byDueThenPriority(p.timeZone));
  const overdue = sorted.filter((t) => (days(t) ?? 0) < 0);
  const today = sorted.filter((t) => days(t) === 0);
  const upcoming = sorted.filter((t) => (days(t) ?? -1) > 0);
  const noDue = sorted.filter((t) => days(t) === null);
  const item = (t: DailyTask, flag?: EmailTaskItem['flag']): EmailTaskItem => ({
    title: t.title,
    href: taskLink(p.appUrl, t.id),
    key: t.key,
    project: t.projectName,
    facts: [`${PRIORITY_LABEL[t.priority]} priority`, dueFact(t, p.timeZone), t.statusLabel],
    ...(flag ? { flag } : {}),
  });
  const blocks: Block[] = [
    { kind: 'text', text: `Here ${p.tasks.length === 1 ? 'is the 1 task' : `are the ${p.tasks.length} tasks`} assigned to you that ${p.tasks.length === 1 ? 'isn’t' : 'aren’t'} done yet.` },
  ];
  if (overdue.length) blocks.push({ kind: 'tasks', heading: 'Overdue', tone: 'danger', items: overdue.map((t) => item(t, { text: `${plural(-(days(t) ?? 0), 'day')} overdue`, tone: 'danger' })) });
  if (today.length) blocks.push({ kind: 'tasks', heading: 'Due today', tone: 'warning', items: today.map((t) => item(t, { text: 'Due today', tone: 'warning' })) });
  if (upcoming.length) blocks.push({ kind: 'tasks', heading: 'Upcoming', tone: 'info', items: upcoming.map((t) => item(t)) });
  if (noDue.length) blocks.push({ kind: 'tasks', heading: 'No due date', tone: 'info', items: noDue.map((t) => item(t)) });
  blocks.push({ kind: 'button', label: 'Open My Tasks', href: `${base(p.appUrl)}/my-tasks` });
  blocks.push(settingsNote(p.appUrl, 'this email'));
  const subject = `Your pending tasks: ${p.tasks.length}${overdue.length ? ` (${overdue.length} overdue)` : ''}`;
  const preheader = overdue.length ? `${plural(overdue.length, 'task')} overdue, ${today.length} due today.` : `${today.length} due today.`;
  return render(subject, preheader, `Good morning, ${p.name}`, blocks, opts);
}

/**
 * The morning email of someone's tasks completed the day before (`day`, their calendar), in the order
 * they were finished, each with when, its priority and due day, and whether it was on time.
 */
export function completedEmail(
  p: { name: string; tasks: DailyTask[]; day: string; timeZone: string; appUrl: string },
  opts?: TemplateOptions,
): EmailContent {
  const sorted = [...p.tasks].sort((a, b) => (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0));
  const items: EmailTaskItem[] = sorted.map((t) => {
    const due = dueDayKey(t.dueDate, p.timeZone);
    const done = t.completedAt ? zonedDayKey(t.completedAt, p.timeZone) : null;
    const onTime = completedOnTime(t.dueDate, t.completedAt, p.timeZone);
    const late = due && done ? Math.round((Date.parse(`${done}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 864e5) : 0;
    return {
      title: t.title,
      href: taskLink(p.appUrl, t.id),
      key: t.key,
      project: t.projectName,
      facts: [...(t.completedAt ? [`Completed ${momentLabel(t.completedAt, p.timeZone)}`] : []), `${PRIORITY_LABEL[t.priority]} priority`, dueFact(t, p.timeZone)],
      ...(onTime === true ? { flag: { text: 'On time', tone: 'success' as const } } : onTime === false && late > 0 ? { flag: { text: `${plural(late, 'day')} late`, tone: 'warning' as const } } : {}),
    };
  });
  const label = dayLabel(p.day);
  const blocks: Block[] = [
    { kind: 'text', text: `${p.name}, here ${items.length === 1 ? 'is the task' : 'are the tasks'} assigned to you that ${items.length === 1 ? 'was' : 'were'} completed yesterday, ${label}.` },
    { kind: 'tasks', heading: 'Completed', tone: 'success', items },
    { kind: 'button', label: 'Open My Tasks', href: `${base(p.appUrl)}/my-tasks` },
    settingsNote(p.appUrl, 'this email'),
  ];
  return render(`Completed yesterday (${label}): ${plural(items.length, 'task')}`, `${plural(items.length, 'task')} done on ${label}.`, 'Completed yesterday', blocks, opts);
}
