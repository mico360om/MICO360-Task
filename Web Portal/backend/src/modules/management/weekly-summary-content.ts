import { renderEmail, type Block, type EmailChip } from '../email/email-layout';
import type { EmailContent, TemplateOptions } from '../email/email-templates';
import type { WeeklyDigest } from './management-service';

const base = (appUrl: string) => appUrl.replace(/\/+$/, '');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Sunday 25 October" for a 'YYYY-MM-DD' day. */
const longDay = (key: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`)).replace(',', '');
/** "18 Oct" for a 'YYYY-MM-DD' day. */
const shortDate = (key: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
const WORD = { RED: 'Red', AMBER: 'Amber', GREEN: 'Green' } as const;

/**
 * The weekly management summary (the daily emails' card design): how the person's projects are doing
 * — red and amber counts with the worst projects and why, late tasks, missing checks, last week's
 * checks done late and pass rate, the people with the most late work — and a button to the dashboard.
 */
export function weeklySummaryEmail(p: { name: string; digest: WeeklyDigest; week: string; appUrl: string }, opts: TemplateOptions = {}): EmailContent {
  const d = p.digest;
  const app = base(p.appUrl);
  const chips: EmailChip[] = [
    ...(d.red ? [{ text: `${d.red} red`, tone: 'danger' as const }] : []),
    ...(d.amber ? [{ text: `${d.amber} amber`, tone: 'warning' as const }] : []),
    ...(d.green ? [{ text: `${d.green} green`, tone: 'success' as const }] : []),
  ];
  const blocks: Block[] = [
    { kind: 'text', text: `Here is how ${d.scope === 'ALL' ? 'all projects' : 'the projects you run'} (${plural(d.projects, 'project')}) are doing.` },
    ...(chips.length ? [{ kind: 'chips' as const, items: chips }] : []),
    ...(d.worst.length
      ? d.worst.map((w): Block => ({ kind: 'callout', tone: w.rag === 'RED' ? 'danger' : 'warning', text: `${WORD[w.rag]}: ${w.name} (${w.code}): ${w.reasons.map((r) => r.text).join('; ')}` }))
      : [{ kind: 'callout' as const, tone: 'success' as const, text: 'Every project is on track.' }]),
    {
      kind: 'details',
      rows: [
        ['Late tasks', String(d.lateTasks)],
        ['Missing checks', String(d.missingChecks)],
        [`Checks done late last week (${shortDate(d.lastWeek.start)} – ${shortDate(d.lastWeek.end)})`, String(d.doneLateLastWeek)],
        ['Pass rate last week', d.passRateLastWeek === null ? 'No inspections finished' : `${d.passRateLastWeek}%`],
      ],
    },
    ...(d.mostLate.length
      ? [
          { kind: 'text' as const, text: 'Most late work:' },
          { kind: 'list' as const, items: d.mostLate.map((m) => `${m.name}: ${plural(m.lateTasks, 'late task')}`) },
        ]
      : []),
    { kind: 'button', label: 'Open the dashboard', href: `${app}/management` },
    { kind: 'text', text: `You get this summary on the first working day of each week, at your daily email time. To turn it off, open Settings → Weekly management summary: ${app}/settings` },
  ];
  const subject = d.red || d.amber ? `Weekly summary: ${d.red} red, ${d.amber} amber · ${plural(d.lateTasks, 'late task')}` : `Weekly summary: all ${plural(d.projects, 'project')} on track`;
  const preheader = `${d.red} red, ${d.amber} amber · ${plural(d.lateTasks, 'late task')} · ${plural(d.missingChecks, 'missing check')}`;
  const { html, text } = renderEmail({ preheader, heading: `Hello, ${p.name}`, headerNote: `Week of ${longDay(p.week)}`, blocks, brand: opts.brand, locale: opts.locale });
  return { subject, html, text };
}
