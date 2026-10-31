/**
 * The Timeline's phone list (Stage 3): a behaviour copy of the website's frontend/src/lib/timeline.ts
 * — its views, sorting, the owner and status filters, the five cards' sums and the words — without
 * its address functions and chart geometry. lib/timeline.test.ts runs the website's module on the
 * same fixtures. Days are 'YYYY-MM-DD' keys; "today" is the company's. Dates are written by
 * lib/day-words; the website's "◆" and "✓" are drawn icons here (milestoneParts, phoneTaskParts).
 *
 * Every number on a row is the server's (Review Focus 5): only the website's own sums are added up.
 */
import type { ProjectHealth, TimelineProject, TimelineTask, TimelineTasksData } from './planning-api';
import type { WeekStart } from './calendar';
import { shiftDayKey } from './calendar';
import { dayText } from './day-words';
import { healthLook, type HealthLook } from './planning-look';

export type TimelineView = 'month' | 'quarter' | 'half';
export type TimelineSort = 'attention' | 'name' | 'target';
/** The status a summary card narrows the rows to ('' = all). */
export type TimelineShow = '' | 'late' | 'at-risk';

export interface TimelineState {
  view: TimelineView;
  /** The week the view is placed around ('YYYY-MM-DD'); null = this week. */
  at: string | null;
  /** An owner's id; '' = anyone. */
  owner: string;
  sort: TimelineSort;
  show: TimelineShow;
}

/** Each view: how many weeks it shows, how many of them come before the anchor week, and how far Earlier / Later move. */
export const TIMELINE_VIEWS: { value: TimelineView; label: string; weeks: number; before: number; step: number }[] = [
  { value: 'month', label: 'Month', weeks: 6, before: 1, step: 4 },
  { value: 'quarter', label: 'Quarter', weeks: 13, before: 2, step: 13 },
  { value: 'half', label: 'Half year', weeks: 26, before: 4, step: 26 },
];

export const TIMELINE_SORTS: { value: TimelineSort; label: string }[] = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'name', label: 'Name' },
  { value: 'target', label: 'Target date' },
];

export const DEFAULT_TIMELINE_STATE: TimelineState = { view: 'quarter', at: null, owner: '', sort: 'attention', show: '' };

const viewOf = (view: TimelineView) => TIMELINE_VIEWS.find((v) => v.value === view)!;

/** The days a view shows around the anchor week (its first day). */
export function rangeFor(view: TimelineView, anchorWeek: string): { from: string; to: string } {
  const v = viewOf(view);
  const from = shiftDayKey(anchorWeek, -7 * v.before);
  return { from, to: shiftDayKey(from, 7 * v.weeks - 1) };
}

/** The anchor week one page earlier (-1) or later (1). */
export function shiftAnchor(view: TimelineView, anchorWeek: string, by: -1 | 1): string {
  return shiftDayKey(anchorWeek, by * 7 * viewOf(view).step);
}

/** Names in English order on every phone, never in the phone's language (the website sorts in the browser's). */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const byName = (a: TimelineProject, b: TimelineProject) => collator.compare(a.name, b.name);
const RANK: Record<ProjectHealth, number> = { late: 0, 'at-risk': 1, 'on-track': 2, 'no-target': 3 };
/** How badly: days late, or how far less is done than the time used. */
const severity = (p: TimelineProject) => (p.health === 'late' ? p.daysLate : p.health === 'at-risk' ? (p.timeUsed ?? 0) - p.progress : 0);

const SORTERS: Record<TimelineSort, (a: TimelineProject, b: TimelineProject) => number> = {
  attention: (a, b) => RANK[a.health] - RANK[b.health] || severity(b) - severity(a) || b.tasks.overdue - a.tasks.overdue || byName(a, b),
  name: byName,
  target: (a, b) => (a.target === b.target ? 0 : a.target === null ? 1 : b.target === null ? -1 : a.target < b.target ? -1 : 1) || byName(a, b),
};

/** A sorted copy. */
export function sortTimeline(projects: TimelineProject[], sort: TimelineSort): TimelineProject[] {
  return [...projects].sort(SORTERS[sort]);
}

export function filterTimeline(projects: TimelineProject[], { owner, show }: { owner: string; show: TimelineShow }): TimelineProject[] {
  return projects.filter((p) => (!owner || p.owner?.id === owner) && (!show || p.health === show));
}

/** Each owner once, by name. */
export function ownerOptions(projects: TimelineProject[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const p of projects) if (p.owner && !seen.has(p.owner.id)) seen.set(p.owner.id, p.owner.name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => collator.compare(a.name, b.name));
}

export interface TimelineSummary {
  open: number;
  late: number;
  atRisk: number;
  milestonesSoon: number;
  meetingsThisWeek: number;
}

/** The five cards, for the projects shown (before a card narrows them) — the website's own sums. */
export function timelineSummary(projects: TimelineProject[]): TimelineSummary {
  return {
    open: projects.length,
    late: projects.filter((p) => p.health === 'late').length,
    atRisk: projects.filter((p) => p.health === 'at-risk').length,
    milestonesSoon: projects.reduce((n, p) => n + p.milestonesSoon, 0),
    meetingsThisWeek: projects.reduce((n, p) => n + p.meetingsThisWeek, 0),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What is shown, announced as the filters change. */
export function statusLine(s: TimelineSummary, show: TimelineShow, shown: number): string {
  if (show === 'late') return `Showing the ${plural(shown, 'late project')}`;
  if (show === 'at-risk') return `Showing the ${plural(shown, 'project')} at risk`;
  if (s.open === 0) return 'No open projects';
  const base = plural(s.open, 'open project');
  return s.late || s.atRisk ? `${base} · ${s.late} late · ${s.atRisk} at risk` : `${base} · none late or at risk`;
}

/** "6 Nov", or "3 Feb 2027" in another year than `today`'s. */
export function shortDay(key: string, today: string): string {
  return dayText(key, { year: key.slice(0, 4) !== today.slice(0, 4) });
}

/** The page's period: "4 Oct 2026 – 2 Jan 2027". */
export function periodText(from: string, to: string): string {
  return `${shortDay(from, '0000')} – ${shortDay(to, '0000')}`;
}

export const HEALTH_LABEL: Record<ProjectHealth, string> = { 'on-track': 'On track', 'at-risk': 'At risk', late: 'Late', 'no-target': 'No target' };

/**
 * A phone row's milestone line, the website's `milestoneLine` without its "◆": with `next`, the row
 * draws the milestone icon and "Next" before `text` ("Beta build · 6 Nov"); else `text` is all of it
 * ("Every milestone reached", "No milestones").
 */
export function milestoneParts(p: TimelineProject, today: string): { next: boolean; text: string } {
  const m = p.nextMilestone;
  if (!m) return { next: false, text: p.milestoneCount ? 'Every milestone reached' : 'No milestones' };
  // Waiting for approval: never overdue while it waits (owner, 30 Oct).
  const when = !m.date ? 'no date' : m.waiting ? 'waiting for approval' : m.date < today ? 'overdue' : shortDay(m.date, today);
  return { next: true, text: `${m.title} · ${when}` };
}

/** "Target 21 Oct · 3 days late"; when the end comes from its tasks, "Last task was due 21 Oct · 3 days ago". */
export function lateNote(p: Pick<TimelineProject, 'target' | 'daysLate'> & { targetFrom?: TimelineProject['targetFrom'] }, today: string): string {
  const day = p.target ? shortDay(p.target, today) : '—';
  if (p.targetFrom === 'tasks') return `Last task was due ${day} · ${p.daysLate === 1 ? 'yesterday' : `${plural(p.daysLate, 'day')} ago`}`;
  return `Target ${day} · ${plural(p.daysLate, 'day')} late`;
}

/** A phone row's target: "Target 10 Dec", "Target 21 Oct · 3 days late", "No target date". */
export function targetLine(p: TimelineProject, today: string): string {
  if (!p.target) return 'No target date';
  if (p.health === 'late') return lateNote(p, today);
  return p.targetFrom === 'tasks' ? `Last task due ${shortDay(p.target, today)}` : `Target ${shortDay(p.target, today)}`;
}

/**
 * A task on a phone, the website's `phoneTaskLine` in parts: `due` ("due 20 Oct") and its state —
 * the row draws a tick before "done", or writes "waiting for approval" / "overdue". Waiting comes
 * before overdue: a task waiting for approval is never late.
 */
export function phoneTaskParts(t: Pick<TimelineTask, 'due' | 'done' | 'overdue' | 'waiting'>, today: string): { due: string; state: 'done' | 'waiting' | 'overdue' | null } {
  return { due: `due ${shortDay(t.due, today)}`, state: t.done ? 'done' : t.waiting ? 'waiting' : t.overdue ? 'overdue' : null };
}

/** "Show all 12 open tasks", on the project's own page. */
const allOpenText = (n: number) => (n === 0 ? 'Open its tasks' : n === 1 ? 'Show its 1 open task' : `Show all ${n} open tasks`);

/** Under a project's task rows (TimelineTasks.tsx footerParts): none in these weeks, how many show when some were cut, and the undated ones. */
export function tasksFooter(d: TimelineTasksData): { none: boolean; shown: string | null; allOpen: string | null; undated: string | null } {
  const cut = d.matched > d.tasks.length;
  return {
    none: d.tasks.length === 0,
    shown: cut ? `${d.tasks.length} of ${d.matched} shown` : null,
    allOpen: cut ? allOpenText(d.open) : null,
    undated: d.undated ? (d.undated === 1 ? '1 open task has no due date' : `${d.undated} open tasks have no due date`) : null,
  };
}

/** One phone row, as the server sent it: progress never recounted, the health pill, the milestone and target lines. */
export function timelineRow(
  p: TimelineProject,
  today: string,
): { progress: number; progressLabel: string; health: HealthLook; milestone: { next: boolean; text: string }; target: string; targetLate: boolean } {
  return {
    progress: p.progress,
    progressLabel: `${p.name}: ${p.progress}% done`,
    health: healthLook(p.health),
    milestone: milestoneParts(p, today),
    target: targetLine(p, today),
    targetLate: p.health === 'late' && !!p.target,
  };
}

/** Everything Timeline and Workload keep, per person (sign-out's cache clear drops it). */
export const planningRoot = (userId: string) => ['planning', userId] as const;
export const timelineKey = (userId: string, from: string, to: string, weekStart: WeekStart, today: string) =>
  [...planningRoot(userId), 'timeline', from, to, weekStart, today] as const;
export const timelineTasksKey = (userId: string, projectId: string, from: string, to: string, today: string) =>
  [...planningRoot(userId), 'timeline', 'tasks', projectId, from, to, today] as const;
