/**
 * The Projects page's list rules, as the website's (Web Portal/frontend/src/lib/project-list.ts —
 * same names, parameters and answers; a drift test runs both on the same rows): which tab a project
 * sits under, search, the owner and "only mine" filters, sorting, "needs attention", and the card's
 * wording. Days are 'YYYY-MM-DD' keys; "today" is the company's. Dates are written through day-words
 * (the website's own en-US parts read the same: "30 Nov", "Mon 26", "Friday 30 October 2026").
 * The website's readListState/writeListState are left out: the phone has no address bar.
 */
import { dueDayKey, zonedDayKey } from './due-date';
import { shiftDayKey } from './calendar';
import { dayText } from './day-words';
import type { ProjectOverview, ProjectStats } from './types';

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
export const STATUS_TABS: { value: StatusTab; label: string; status: string | null }[] = [
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

/** Every word must appear in the name, code, client or project number; case doesn't matter. */
export function matchesSearch(p: Pick<ProjectOverview, 'name' | 'code' | 'clientName' | 'number'>, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [p.name, p.code, p.clientName, p.number].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}

export function inTab(p: Pick<ProjectOverview, 'status'>, tab: StatusTab): boolean {
  if (tab === 'all') return p.status !== 'ARCHIVED';
  return STATUS_TABS.find((t) => t.value === tab)?.status === p.status;
}

export function tabCounts(projects: readonly Pick<ProjectOverview, 'status'>[]): Record<StatusTab, number> {
  const out = Object.fromEntries(STATUS_TABS.map((t) => [t.value, 0])) as Record<StatusTab, number>;
  for (const p of projects) for (const t of STATUS_TABS) if (inTab(p, t.value)) out[t.value] += 1;
  return out;
}

/**
 * Search, owner and "only mine" — everything but the tab, so the tab counts can follow them. "Mine"
 * (I own it, manage it or am on its team; having created it is not enough) comes from the server.
 */
export function filterProjects(projects: readonly ProjectOverview[], state: ProjectListState): ProjectOverview[] {
  return projects.filter((p) => matchesSearch(p, state.q) && (!state.owner || p.ownerId === state.owner) && (!state.mine || p.mine));
}

/** Names in order, numbers as numbers ("Delta 9" before "Delta 10"), case and accents aside. */
const compareNames = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export function ownerOptions(projects: readonly ProjectOverview[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of projects) if (p.owner && !seen.has(p.owner.id)) seen.set(p.owner.id, p.owner.name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => compareNames(a.name, b.name));
}

/** The target day: a date-only value keeps its day; a moment is read in the company zone. */
const targetKey = (p: Pick<ProjectOverview, 'targetDate'>, timeZone: string) => dueDayKey(p.targetDate, timeZone);
const finished = (status: string) => status === 'COMPLETED' || status === 'ARCHIVED';

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
export function headerSummary(projects: readonly ProjectOverview[], today: string, timeZone = 'UTC'): string {
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

const byName = (a: ProjectOverview, b: ProjectOverview) => compareNames(a.name, b.name);
/** Ascending, with the missing ones last. */
const keyOrder = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
const doneShare = (s: ProjectStats) => (s.total ? s.done / s.total : Infinity);
const targetGroup = (p: ProjectOverview, tz: string) => (targetKey(p, tz) === null ? 2 : finished(p.status) ? 1 : 0);

const SORTERS: Record<ProjectSort, (today: string, timeZone: string) => (a: ProjectOverview, b: ProjectOverview) => number> = {
  attention: (today, tz) => (a, b) =>
    b.stats.overdue - a.stats.overdue ||
    Number(targetPassed(b, today, tz)) - Number(targetPassed(a, today, tz)) ||
    keyOrder(a.stats.nextDue, b.stats.nextDue) ||
    byName(a, b),
  name: () => byName,
  updated: () => (a, b) => Date.parse(b.stats.lastActivityAt) - Date.parse(a.stats.lastActivityAt) || byName(a, b),
  // Open projects with a target, nearest first; then finished ones (Completed, Archived); then those without one.
  target: (_today, tz) => (a, b) => targetGroup(a, tz) - targetGroup(b, tz) || keyOrder(targetKey(a, tz), targetKey(b, tz)) || byName(a, b),
  progress: () => (a, b) => {
    const x = doneShare(a.stats);
    const y = doneShare(b.stats);
    return (x === y ? 0 : x < y ? -1 : 1) || byName(a, b);
  },
};

/** A sorted copy of the list. */
export function sortProjects(projects: readonly ProjectOverview[], sort: ProjectSort, today: string, timeZone = 'UTC'): ProjectOverview[] {
  return [...projects].sort(SORTERS[sort](today, timeZone));
}

/** "63% done · 25 of 40 tasks". Rounded as on the Dashboard and in Reports, but 100% only once every task is done. */
export function progressOf(s: Pick<ProjectStats, 'total' | 'done'>): { pct: number; text: string } {
  if (!s.total) return { pct: 0, text: 'No tasks yet' };
  const pct = s.done >= s.total ? 100 : Math.min(99, Math.round((s.done / s.total) * 100));
  return { pct, text: `${pct}% done · ${s.done} of ${plural(s.total, 'task')}` };
}

const noon = (key: string) => Date.parse(`${key}T12:00:00.000Z`);
const daysBetween = (from: string, to: string) => Math.round((noon(to) - noon(from)) / 86_400_000);
/** "30 Nov", or "15 Jan 2027" in another year. */
const dayMonth = (key: string, today: string) => dayText(key, { year: key.slice(0, 4) !== today.slice(0, 4) });
/** "Friday 30 October 2026". */
const longDay = (key: string) => dayText(key, { weekday: 'long', month: 'long' });
/** "Mon 26". */
const weekdayDay = (key: string) => dayText(key, { weekday: 'short', year: false }).split(' ').slice(0, 2).join(' ');

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

/** The "Next due" figure: "Today", "Tomorrow", "Mon 26" this week, else "12 Nov"; `long` is the full day for TalkBack. */
export function nextDueLabel(key: string | null, today: string): { short: string; long: string } {
  if (!key) return { short: '—', long: 'No upcoming due date' };
  const days = daysBetween(today, key);
  if (days === 0) return { short: 'Today', long: `Today, ${longDay(key)}` };
  if (days === 1) return { short: 'Tomorrow', long: `Tomorrow, ${longDay(key)}` };
  const short = days > 1 && days <= 6 ? weekdayDay(key) : dayMonth(key, today);
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

// ── The page's words (website pages/ProjectsPage.tsx, components/projects/ProjectCard.tsx) ──

export const PROJECTS_TEXT = {
  search: 'Search name, code, client or project number…',
  searchLabel: 'Search projects',
  owner: 'Owner',
  anyone: 'Anyone',
  sort: 'Sort',
  onlyMine: 'Only my projects',
  tabs: 'Project status',
  noMatch: 'No projects match',
  noMatchBody: 'Try other words or another owner, or clear the filters to see every project.',
  clear: 'Clear filters',
  firstRun: 'No projects yet',
  firstRunAdmin: 'A project holds one piece of work — a contract, a client job or an in-house task list — with its board, people, meetings and inspections. Create the first one to get started.',
  firstRunOther: 'Projects you’re part of will appear here — or create one with “New project”.',
  another: 'Start another project',
  anotherBody: 'Keep each job, client or site in a project of its own.',
  archivedNote: 'Archived projects are kept here, out of the other lists.',
  noOwner: 'No owner',
  open: 'Open',
  overdue: 'Overdue',
  nextDue: 'Next due',
  edit: 'Edit',
  openBoard: 'Open board',
  archive: 'Archive…',
} as const;

/** What an empty tab says when nothing is filtered. */
export const EMPTY_TAB: Record<StatusTab, string> = {
  all: 'No open projects',
  active: 'No active projects',
  planning: 'No projects in planning',
  'on-hold': 'No projects on hold',
  completed: 'No completed projects',
  archived: 'No archived projects',
};

/** The card's ⋯ button: "More actions for Rig". */
export const moreActionsLabel = (name: string): string => `More actions for ${name}`;

/** How many team faces a card shows before "+N". */
export const TEAM_FACES = 4;

/** What TalkBack says for the faces: "Team: Ann Lee, Omar Said and 3 more". */
export function teamLabel(p: Pick<ProjectOverview, 'team' | 'teamCount'>): string {
  const faces = p.team.slice(0, TEAM_FACES);
  const more = Math.max(0, p.teamCount - faces.length);
  return `Team: ${faces.map((m) => m.name).join(', ')}${more ? ` and ${more} more` : ''}`;
}

/** A status change that didn't go through (the website's words). */
export const statusChangeFailed = (name: string): string => `Couldn’t change the status of ${name}. Try again.`;

/**
 * "Start another project" under the list: no filters, an open tab (All, Active, Planning) and ONE
 * card — the website offers it beside one or two cards, but hides it beside two below a laptop's
 * width (alone on a row it would just be a hole), so on a phone it is one card only.
 */
export function showAnotherProjectTile(o: { filtered: boolean; shown: number; tab: StatusTab }): boolean {
  return !o.filtered && o.shown === 1 && (o.tab === 'all' || o.tab === 'active' || o.tab === 'planning');
}

/** The list with one project's status changed (a new list; the one given is left as it was). */
export function withProjectStatus(list: readonly ProjectOverview[], id: string, status: string): ProjectOverview[] {
  return list.map((p) => (p.id === id ? { ...p, status } : p));
}
