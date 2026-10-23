import type { ProjectOverview, ProjectStats, ProjectStatus } from '../api/projects';
import { dueDayKey, shiftDayKey, zonedDayKey } from './due-date';

/**
 * The Projects page's list rules: which tab a project sits under, search, the owner and "only
 * mine" filters, sorting, "needs attention", and the card's wording. Pure, so the page and its
 * tests agree. Days are 'YYYY-MM-DD' keys; "today" is the company's (see lib/due-date).
 */

export type StatusTab = 'all' | 'active' | 'planning' | 'on-hold' | 'completed' | 'archived';
export type ProjectSort = 'attention' | 'name' | 'updated' | 'target' | 'progress';

export interface ProjectListState {
  status: StatusTab;
  /** The search words. */
  q: string;
  /** An owner's id; '' = anyone. */
  owner: string;
  sort: ProjectSort;
  /** Only projects I own, manage or am on the team of. */
  mine: boolean;
}

/** The tabs in order. "All" is every project except the archived ones, which only show under their own tab. */
export const STATUS_TABS: { value: StatusTab; label: string; status: ProjectStatus | null }[] = [
  { value: 'all', label: 'All', status: null },
  { value: 'active', label: 'Active', status: 'ACTIVE' },
  { value: 'planning', label: 'Planning', status: 'PLANNING' },
  { value: 'on-hold', label: 'On hold', status: 'ON_HOLD' },
  { value: 'completed', label: 'Completed', status: 'COMPLETED' },
  { value: 'archived', label: 'Archived', status: 'ARCHIVED' },
];

export const PROJECT_SORTS: { value: ProjectSort; label: string; phrase: string }[] = [
  { value: 'attention', label: 'Needs attention', phrase: 'most overdue first' },
  { value: 'name', label: 'Name', phrase: 'A to Z' },
  { value: 'updated', label: 'Recently updated', phrase: 'recently updated first' },
  { value: 'target', label: 'Target date', phrase: 'nearest target date first' },
  { value: 'progress', label: 'Progress', phrase: 'least done first' },
];

export const DEFAULT_LIST_STATE: ProjectListState = { status: 'all', q: '', owner: '', sort: 'attention', mine: false };

const isTab = (v: string | null): v is StatusTab => STATUS_TABS.some((t) => t.value === v);
const isSort = (v: string | null): v is ProjectSort => PROJECT_SORTS.some((s) => s.value === v);

/** The list's state from the address (`?status=…&q=…&owner=…&sort=…&mine=1`); unknown values fall back to the defaults. */
export function readListState(params: URLSearchParams): ProjectListState {
  const status = params.get('status');
  const sort = params.get('sort');
  return {
    status: isTab(status) ? status : 'all',
    q: params.get('q') ?? '',
    owner: params.get('owner') ?? '',
    sort: isSort(sort) ? sort : 'attention',
    mine: params.get('mine') === '1',
  };
}

/** The address after a change: defaults are left out, anything else already there is kept. */
export function writeListState(prev: URLSearchParams, changes: Partial<ProjectListState>): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const [key, value] of Object.entries(changes) as [keyof ProjectListState, ProjectListState[keyof ProjectListState]][]) {
    const text = key === 'mine' ? (value ? '1' : '') : String(value ?? '');
    if (!text || value === DEFAULT_LIST_STATE[key]) next.delete(key);
    else next.set(key, text);
  }
  return next;
}

/** Every word must appear in the name, code, client or project number; case doesn't matter. */
export function matchesSearch(p: Pick<ProjectOverview, 'name' | 'code' | 'clientName' | 'number'>, q: string): boolean {
  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [p.name, p.code, p.clientName, p.number].filter(Boolean).join(' ').toLocaleLowerCase();
  return words.every((w) => text.includes(w));
}

export function inTab(p: Pick<ProjectOverview, 'status'>, tab: StatusTab): boolean {
  if (tab === 'all') return p.status !== 'ARCHIVED';
  return STATUS_TABS.find((t) => t.value === tab)?.status === p.status;
}

export function tabCounts(projects: Pick<ProjectOverview, 'status'>[]): Record<StatusTab, number> {
  const out = Object.fromEntries(STATUS_TABS.map((t) => [t.value, 0])) as Record<StatusTab, number>;
  for (const p of projects) for (const t of STATUS_TABS) if (inTab(p, t.value)) out[t.value] += 1;
  return out;
}

/** I own it, manage it, or am on its team. (Having created it is not enough.) */
export function isMine(p: Pick<ProjectOverview, 'ownerId' | 'managerId' | 'team'>, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return p.ownerId === userId || p.managerId === userId || p.team.some((m) => m.id === userId);
}

/** Search, owner and "only mine" — everything but the tab, so the tab counts can follow them. */
export function filterProjects(projects: ProjectOverview[], state: ProjectListState, userId: string | null | undefined): ProjectOverview[] {
  return projects.filter(
    (p) => matchesSearch(p, state.q) && (!state.owner || p.ownerId === state.owner) && (!state.mine || isMine(p, userId)),
  );
}

export function ownerOptions(projects: ProjectOverview[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of projects) if (p.owner && !seen.has(p.owner.id)) seen.set(p.owner.id, p.owner.name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => compareNames(a.name, b.name));
}

/** The target day: a date-only value keeps its day; a moment is read in the company zone (as the project dashboard does). */
const targetKey = (p: Pick<ProjectOverview, 'targetDate'>, timeZone: string) => dueDayKey(p.targetDate, timeZone);
const finished = (status: ProjectStatus) => status === 'COMPLETED' || status === 'ARCHIVED';

/** Past its target date while still going (not Completed or Archived). */
export function targetPassed(p: Pick<ProjectOverview, 'targetDate' | 'status'>, today: string, timeZone = 'UTC'): boolean {
  const key = targetKey(p, timeZone);
  return key !== null && key < today && !finished(p.status);
}

/** An overdue task, or past its target date while still going. Archived projects never need attention. */
export function needsAttention(p: ProjectOverview, today: string, timeZone = 'UTC'): boolean {
  if (p.status === 'ARCHIVED') return false;
  return p.stats.overdue > 0 || targetPassed(p, today, timeZone);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 projects · 3 need attention" — open projects (not archived) and how many of them need attention. */
export function headerSummary(projects: ProjectOverview[], today: string, timeZone = 'UTC'): string {
  if (projects.length === 0) return 'No projects yet';
  const open = projects.filter((p) => p.status !== 'ARCHIVED');
  const attention = open.filter((p) => needsAttention(p, today, timeZone)).length;
  const base = plural(open.length, 'project');
  return attention ? `${base} · ${attention} ${attention === 1 ? 'needs' : 'need'} attention` : base;
}

/** "8 projects · most overdue first" — announced as the filters change. */
export function countLine(n: number, sort: ProjectSort): string {
  if (n === 0) return 'No projects';
  return `${plural(n, 'project')} · ${PROJECT_SORTS.find((s) => s.value === sort)!.phrase}`;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const compareNames = (a: string, b: string) => collator.compare(a, b);
const byName = (a: ProjectOverview, b: ProjectOverview) => compareNames(a.name, b.name);
/** Ascending, with the missing ones last. */
const keyOrder = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
const doneShare = (s: ProjectStats) => (s.total ? s.done / s.total : Infinity);

const SORTERS: Record<ProjectSort, (today: string, timeZone: string) => (a: ProjectOverview, b: ProjectOverview) => number> = {
  attention: (today, tz) => (a, b) =>
    b.stats.overdue - a.stats.overdue ||
    Number(targetPassed(b, today, tz)) - Number(targetPassed(a, today, tz)) ||
    keyOrder(a.stats.nextDue, b.stats.nextDue) ||
    byName(a, b),
  name: () => byName,
  updated: () => (a, b) => Date.parse(b.stats.lastActivityAt) - Date.parse(a.stats.lastActivityAt) || byName(a, b),
  target: (_today, tz) => (a, b) => keyOrder(targetKey(a, tz), targetKey(b, tz)) || byName(a, b),
  progress: () => (a, b) => {
    const x = doneShare(a.stats);
    const y = doneShare(b.stats);
    return (x === y ? 0 : x < y ? -1 : 1) || byName(a, b);
  },
};

/** A sorted copy of the list. */
export function sortProjects(projects: ProjectOverview[], sort: ProjectSort, today: string, timeZone = 'UTC'): ProjectOverview[] {
  return [...projects].sort(SORTERS[sort](today, timeZone));
}

/** "62% done · 25 of 40 tasks". The share is rounded down, so 100% means every task is done. */
export function progressOf(s: Pick<ProjectStats, 'total' | 'done'>): { pct: number; text: string } {
  if (!s.total) return { pct: 0, text: 'No tasks yet' };
  const pct = s.done >= s.total ? 100 : Math.floor((s.done / s.total) * 100);
  return { pct, text: `${pct}% done · ${s.done} of ${plural(s.total, 'task')}` };
}

const noon = (key: string) => new Date(`${key}T12:00:00.000Z`);
const part = (key: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(noon(key));
const daysBetween = (from: string, to: string) => Math.round((noon(to).getTime() - noon(from).getTime()) / 86_400_000);
/** "30 Nov", or "15 Jan 2027" in another year. */
const dayMonth = (key: string, today: string) =>
  `${part(key, { day: 'numeric' })} ${part(key, { month: 'short' })}${key.slice(0, 4) === today.slice(0, 4) ? '' : ` ${key.slice(0, 4)}`}`;
const longDay = (key: string) =>
  `${part(key, { weekday: 'long' })} ${part(key, { day: 'numeric' })} ${part(key, { month: 'long' })} ${key.slice(0, 4)}`;

/** "Target 30 Nov · 38 days", "Target passed 3 days ago" (late), "No target date". A finished project shows just the day. */
export function targetLabel(p: Pick<ProjectOverview, 'targetDate' | 'status'>, today: string, timeZone = 'UTC'): { text: string; late: boolean } {
  const key = targetKey(p, timeZone);
  if (!key) return { text: 'No target date', late: false };
  if (finished(p.status)) return { text: `Target ${dayMonth(key, today)}`, late: false };
  const days = daysBetween(today, key);
  if (days === 0) return { text: 'Target today', late: false };
  if (days === -1) return { text: 'Target passed yesterday', late: true };
  if (days < 0) return { text: `Target passed ${-days} days ago`, late: true };
  return { text: `Target ${dayMonth(key, today)} · ${plural(days, 'day')}`, late: false };
}

/** The "Next due" figure: "Today", "Tomorrow", "Mon 26" this week, else "12 Nov"; `long` is the full day for screen readers. */
export function nextDueLabel(key: string | null, today: string): { short: string; long: string } {
  if (!key) return { short: '—', long: 'No upcoming due date' };
  const days = daysBetween(today, key);
  if (days === 0) return { short: 'Today', long: `Today, ${longDay(key)}` };
  if (days === 1) return { short: 'Tomorrow', long: `Tomorrow, ${longDay(key)}` };
  const short = days > 1 && days <= 6 ? `${part(key, { weekday: 'short' })} ${part(key, { day: 'numeric' })}` : dayMonth(key, today);
  return { short, long: longDay(key) };
}

/** "Updated 2 h ago", "Updated yesterday", "Updated 3 days ago", "Updated 10 Oct" — days counted in the company zone. */
export function updatedLabel(iso: string, now: Date, timeZone: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const today = zonedDayKey(now, timeZone);
  const day = zonedDayKey(then, timeZone);
  if (day === today) return `Updated ${Math.floor(minutes / 60)} h ago`;
  if (day === shiftDayKey(today, -1)) return 'Updated yesterday';
  const days = daysBetween(day, today);
  if (days < 7) return `Updated ${days} days ago`;
  return `Updated ${dayMonth(day, today)}`;
}
