/**
 * The Management page's words and its filters in the address (?projects=a,b&owner=…&status=…&weeks=…),
 * kept short: the defaults (every project, anyone, the statuses still going, 12 weeks) are left out.
 */
import type { ManagementFilters, ProjectStatus, Rag } from '../api/management';
import { zonedDayKey } from './due-date';

export const PROJECT_STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'];
export const DEFAULT_STATUSES: ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD'];
export const PERIODS = [4, 12, 26] as const;
export const STATUS_LABEL: Record<ProjectStatus, string> = { PLANNING: 'Planning', ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', ARCHIVED: 'Archived' };
export const RAG_WORD: Record<Rag, string> = { RED: 'Red', AMBER: 'Amber', GREEN: 'Green' };

const KEYS = ['projects', 'owner', 'status', 'weeks'] as const;
const list = (v: string | null) => [...new Set((v ?? '').split(',').map((x) => x.trim()).filter(Boolean))];
const sameStatuses = (a: ProjectStatus[], b: ProjectStatus[]) => a.length === b.length && a.every((s) => b.includes(s));

export function filtersFromParams(params: URLSearchParams): ManagementFilters {
  const statuses = PROJECT_STATUSES.filter((s) => list(params.get('status')).includes(s));
  const weeks = Number(params.get('weeks'));
  return {
    projectIds: list(params.get('projects')),
    ownerId: params.get('owner') || null,
    statuses: statuses.length ? statuses : [...DEFAULT_STATUSES],
    weeks: (PERIODS as readonly number[]).includes(weeks) ? (weeks as ManagementFilters['weeks']) : 12,
  };
}

/** The address with these filters (only what differs from the defaults); everything else in it is kept. */
export function withFilters(params: URLSearchParams, f: ManagementFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of KEYS) next.delete(k);
  if (f.projectIds.length) next.set('projects', f.projectIds.join(','));
  if (f.ownerId) next.set('owner', f.ownerId);
  if (!sameStatuses(f.statuses, DEFAULT_STATUSES)) next.set('status', f.statuses.join(','));
  if (f.weeks !== 12) next.set('weeks', String(f.weeks));
  return next;
}

export const isDefaultFilters = (f: ManagementFilters) => f.projectIds.length === 0 && !f.ownerId && sameStatuses(f.statuses, DEFAULT_STATUSES) && f.weeks === 12;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 days late", "Due today", "Due tomorrow", "In 19 days", "No date". */
export function milestoneText(m: { due: string | null; daysLeft: number | null }): string {
  if (!m.due || m.daysLeft === null) return 'No date';
  if (m.daysLeft < 0) return `${plural(-m.daysLeft, 'day')} late`;
  if (m.daysLeft === 0) return 'Due today';
  if (m.daysLeft === 1) return 'Due tomorrow';
  return `In ${m.daysLeft} days`;
}

const noon = (key: string) => Date.parse(`${key}T12:00:00Z`);
/** "Today", "Yesterday", "26 days ago" — company days. */
export function idleText(at: string, today: string, timeZone: string): string {
  const days = Math.round((noon(today) - noon(zonedDayKey(new Date(at), timeZone))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/** "Wed 28 Oct" for a 'YYYY-MM-DD' day. */
export const shortDay = (key: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00.000Z`)).replace(',', '');
/** "9 Aug" for a 'YYYY-MM-DD' day. */
export const dayMonth = (key: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00.000Z`));
