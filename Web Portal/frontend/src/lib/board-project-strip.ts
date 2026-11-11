import { dueDayKey } from './due-date';

/**
 * The Kanban board's project strip (owner, 10 Nov 2026): when one project is chosen, a slim line of its
 * basics above the columns. These are its words — its dates and the days left, its client or company,
 * its project managers — pure, so the strip and its tests agree. Days are the company's ('YYYY-MM-DD').
 */

const noon = (key: string) => new Date(`${key}T12:00:00.000Z`);
const part = (key: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(noon(key));
const daysBetween = (from: string, to: string) => Math.round((noon(to).getTime() - noon(from).getTime()) / 86_400_000);
/** "12 Oct", or "15 Jan 2027" in another year (the site's dates). */
const dayMonth = (key: string, today: string) =>
  `${part(key, { day: 'numeric' })} ${part(key, { month: 'short' })}${key.slice(0, 4) === today.slice(0, 4) ? '' : ` ${key.slice(0, 4)}`}`;
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/**
 * Its dates ("12 Oct – 20 Dec", "From 12 Oct", "Until 20 Dec") and, for an open project with an end
 * date, how long is left ("40 days left", "Ends today", "3 days late" — late). A finished project
 * (completed or archived) shows its dates only.
 */
export function projectDates(
  p: { startDate: string | null; targetDate: string | null; status: string },
  today: string,
  timeZone: string,
): { range: string | null; left: { text: string; late: boolean } | null } {
  const start = dueDayKey(p.startDate, timeZone);
  const end = dueDayKey(p.targetDate, timeZone);
  const range = start && end ? `${dayMonth(start, today)} – ${dayMonth(end, today)}` : start ? `From ${dayMonth(start, today)}` : end ? `Until ${dayMonth(end, today)}` : null;
  if (!end || p.status === 'COMPLETED' || p.status === 'ARCHIVED') return { range, left: null };
  const n = daysBetween(today, end);
  const left = n > 0 ? { text: `${days(n)} left`, late: false } : n === 0 ? { text: 'Ends today', late: false } : { text: `${days(-n)} late`, late: true };
  return { range, left };
}

/** Who it is for: its client when it names one, else its main company (null: neither). */
export function projectPlace(p: { clientName: string | null; companies?: { name: string; isMain: boolean }[] }): { label: 'Client' | 'Company'; name: string } | null {
  const client = p.clientName?.trim();
  if (client) return { label: 'Client', name: client };
  const company = (p.companies ?? []).find((c) => c.isMain) ?? p.companies?.[0];
  return company ? { label: 'Company', name: company.name } : null;
}

/** Who runs it: its project managers (the one named, then the team's managers), else its owner. */
export function projectPeople(o: { managers: { name: string }[]; owner: { name: string } | null }): { label: string; names: string } | null {
  if (o.managers.length > 0) return { label: o.managers.length === 1 ? 'Project manager' : 'Project managers', names: o.managers.map((m) => m.name).join(', ') };
  return o.owner ? { label: 'Owner', names: o.owner.name } : null;
}
