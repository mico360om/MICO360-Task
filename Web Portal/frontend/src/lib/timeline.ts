import type { ProjectHealth, TimelineMeeting, TimelineMilestone, TimelineProject } from '../api/planning';
import { shiftDayKey } from './due-date';

/**
 * The Timeline page's rules: which weeks a view shows, sorting, the owner and status filters, the
 * summary cards, the busy-week steps, where bars and markers sit, and the words. Pure, so the page
 * and its tests agree. Days are 'YYYY-MM-DD' keys; "today" is the company's.
 */

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

/** Each view: how many weeks it shows, how many of them come before the anchor week, and how far ‹ › move. */
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

const isView = (v: string | null): v is TimelineView => TIMELINE_VIEWS.some((x) => x.value === v);
const isSort = (v: string | null): v is TimelineSort => TIMELINE_SORTS.some((x) => x.value === v);
const isShow = (v: string | null): v is TimelineShow => v === 'late' || v === 'at-risk';
const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** The page's state from the address (`?view=…&at=…&owner=…&sort=…&show=…`); unknown values fall back to the defaults. */
export function readTimelineState(params: URLSearchParams): TimelineState {
  const view = params.get('view');
  const at = params.get('at');
  const sort = params.get('sort');
  const show = params.get('show');
  return {
    view: isView(view) ? view : 'quarter',
    at: isDay(at) ? at : null,
    owner: params.get('owner') ?? '',
    sort: isSort(sort) ? sort : 'attention',
    show: isShow(show) ? show : '',
  };
}

/** The address after a change: defaults are left out, anything else already there is kept. */
export function writeTimelineState(prev: URLSearchParams, changes: Partial<TimelineState>): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const [key, value] of Object.entries(changes) as [keyof TimelineState, TimelineState[keyof TimelineState]][]) {
    if (!value || value === DEFAULT_TIMELINE_STATE[key]) next.delete(key);
    else next.set(key, String(value));
  }
  return next;
}

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

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
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

/** The five cards, for the projects shown (before a card narrows them). */
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

/** Open tasks due each week across the projects shown. */
export function busyTotals(projects: TimelineProject[], weeks: number): number[] {
  const out = Array.from({ length: weeks }, () => 0);
  for (const p of projects) {
    p.dueByWeek.forEach((n, i) => {
      if (i < weeks) out[i] = out[i]! + n;
    });
  }
  return out;
}

/** Four steps that grow with the busiest week: a quarter of it each (at least 1). */
export function heatScale(totals: number[]): { size: number; labels: string[] } {
  const size = Math.max(1, Math.ceil(Math.max(0, ...totals) / 4));
  const labels = [1, 2, 3, 4].map((i) => {
    const from = (i - 1) * size + 1;
    if (i === 4) return `${from}+`;
    return size === 1 ? `${from}` : `${from}–${i * size}`;
  });
  return { size, labels };
}

/** 0 for none, else 1–4. */
export function heatLevel(n: number, size: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  return Math.min(4, Math.ceil(n / size)) as 1 | 2 | 3 | 4;
}

const DAY_MS = 86_400_000;
const noon = (key: string) => Date.parse(`${key}T12:00:00.000Z`);
export const daysBetween = (from: string, to: string) => Math.round((noon(to) - noon(from)) / DAY_MS);

/** Where a day begins, as a share (0–100) of the shown days. */
export function xOf(day: string, from: string, totalDays: number): number {
  return (daysBetween(from, day) / totalDays) * 100;
}

export interface BarSpan {
  left: number;
  width: number;
  /** It starts before the shown weeks (no rounded start). */
  startsBefore: boolean;
  /** It ends after them. */
  endsAfter: boolean;
  /** No target: it fades out. */
  open: boolean;
  /** How much of the shown bar is filled (0–100): the share done of the whole bar, start to target. */
  fill: number;
}

/** A project's bar (start to the end of its target day, or open-ended) and, when late, the part past the target up to today. */
export function barShape(
  p: Pick<TimelineProject, 'start' | 'target' | 'health' | 'progress'>,
  range: { from: string; to: string },
  today: string,
): { bar: BarSpan | null; over: { left: number; width: number } | null } {
  const total = daysBetween(range.from, range.to) + 1;
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  /** From the start of one day to the start of another, cut to the shown weeks. */
  const span = (from: string, to: string) => {
    const a = xOf(from, range.from, total);
    const b = xOf(to, range.from, total);
    if (b <= 0 || a >= 100 || b <= a) return null;
    return { left: clamp(a), width: clamp(b) - clamp(a), startsBefore: a < 0, endsAfter: b > 100, a, b };
  };
  // Without a target the bar runs on past the last shown day.
  const s = span(p.start, p.target ? shiftDayKey(p.target, 1) : shiftDayKey(range.to, 2));
  // Without a target there is no whole to take a share of: the shown part is filled to the share done.
  const fill = (x: NonNullable<typeof s>) =>
    p.target ? Math.max(0, Math.min(100, ((x.a + ((x.b - x.a) * p.progress) / 100 - x.left) / x.width) * 100)) : p.progress;
  const bar = s ? { left: s.left, width: s.width, startsBefore: s.startsBefore, endsAfter: s.endsAfter, open: !p.target, fill: fill(s) } : null;
  const late = p.health === 'late' && p.target ? span(shiftDayKey(p.target, 1), shiftDayKey(today, 1)) : null;
  return { bar, over: late ? { left: late.left, width: late.width } : null };
}

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const monthName = (key: string) => MONTH.format(new Date(`${key}T12:00:00.000Z`));
const nextMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

/** The month labels over the weeks: where each month begins, the year on the first and on January. */
export function monthMarks(from: string, to: string): { key: string; label: string; left: number }[] {
  const total = daysBetween(from, to) + 1;
  const marks: { key: string; label: string; left: number }[] = [];
  let day = `${from.slice(0, 7)}-01`;
  if (day < from) {
    day = nextMonth(from);
    // The month the range starts in keeps its label only when enough of it shows.
    if (daysBetween(from, day) >= 10) marks.push({ key: from.slice(0, 7), label: `${monthName(from)} ${from.slice(0, 4)}`, left: 0 });
  }
  for (; day <= to; day = nextMonth(day)) {
    const withYear = marks.length === 0 || day.slice(5, 7) === '01';
    marks.push({ key: day.slice(0, 7), label: withYear ? `${monthName(day)} ${day.slice(0, 4)}` : monthName(day), left: xOf(day, from, total) });
  }
  return marks;
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "6 Nov", or "3 Feb 2027" in another year than `today`'s. */
export function shortDay(key: string, today: string): string {
  const text = SHORT.format(new Date(`${key}T12:00:00.000Z`)).replace('Sept', 'Sep');
  return key.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${key.slice(0, 4)}`;
}
/** "10 Dec 2026". */
const fullDay = (key: string) => `${shortDay(key, key)} ${key.slice(0, 4)}`;

export const HEALTH_LABEL: Record<ProjectHealth, string> = { 'on-track': 'On track', 'at-risk': 'At risk', late: 'Late', 'no-target': 'No target' };

function milestoneWords(p: TimelineProject, today: string): string {
  const m = p.nextMilestone;
  if (!m) return p.milestoneCount ? 'every milestone reached' : 'no milestones';
  const when = !m.date ? 'no date' : m.date < today ? 'overdue' : shortDay(m.date, today);
  return `next ◆ ${m.title} · ${when}`;
}

/** "62% · next ◆ Pilot on rig 3 · 12 Nov" — under the project's name. */
export function subline(p: TimelineProject, today: string): string {
  return `${p.progress}% · ${milestoneWords(p, today)}`;
}

/** Its start or end (or both) comes from its tasks, the project having no date of its own. */
export const datesFromTasks = (p: Pick<TimelineProject, 'startFrom' | 'targetFrom'>) => p.startFrom === 'tasks' || p.targetFrom === 'tasks';

/** On the bar: "62%", "9% done · 45% of the time used", with " · dates from tasks" when they are. */
export function barLabel(p: TimelineProject): string {
  const base = p.health === 'at-risk' ? riskLabel(p) : `${p.progress}%`;
  return datesFromTasks(p) ? `${base} · dates from tasks` : base;
}

/** "Next ◆ Beta build · 6 Nov", "No milestones" — a phone row's milestone line. */
export function milestoneLine(p: TimelineProject, today: string): string {
  const words = milestoneWords(p, today);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "9% done · 45% of the time used" — on an at-risk bar. */
export function riskLabel(p: Pick<TimelineProject, 'progress' | 'timeUsed'>): string {
  return `${p.progress}% done · ${p.timeUsed ?? 0}% of the time used`;
}

/** "Target 21 Oct · 3 days late"; when the end comes from its tasks, "Last task was due 21 Oct · 3 days ago". */
export function lateNote(p: Pick<TimelineProject, 'target' | 'daysLate'> & { targetFrom?: TimelineProject['targetFrom'] }, today: string): string {
  const day = p.target ? shortDay(p.target, today) : '—';
  if (p.targetFrom === 'tasks') return `Last task was due ${day} · ${p.daysLate === 1 ? 'yesterday' : `${plural(p.daysLate, 'day')} ago`}`;
  return `Target ${day} · ${plural(p.daysLate, 'day')} late`;
}

/** "1 Oct → 10 Dec 2026". */
export function datesLine(p: Pick<TimelineProject, 'start' | 'startIsCreated' | 'target'> & Partial<Pick<TimelineProject, 'startFrom' | 'targetFrom'>>): string {
  const sameYear = p.target !== null && p.target.slice(0, 4) === p.start.slice(0, 4);
  const start = `${sameYear ? shortDay(p.start, p.start) : fullDay(p.start)}${p.startIsCreated ? ' (created)' : ''}`;
  const [a, b] = [p.startFrom === 'tasks', p.targetFrom === 'tasks'];
  const from = a && b ? ' (from its tasks)' : a ? ' (start from its tasks)' : b ? ' (end from its tasks)' : '';
  return `${start} → ${p.target ? fullDay(p.target) : 'no target date'}${from}`;
}

/** "1 of 11 tasks (9%) · 45% of the time used". */
export function doneLine(p: Pick<TimelineProject, 'tasks' | 'progress' | 'timeUsed' | 'health'>): string {
  if (!p.tasks.total) return 'No tasks yet';
  const base = `${p.tasks.done} of ${plural(p.tasks.total, 'task')} (${p.progress}%)`;
  return p.timeUsed !== null && p.health !== 'late' ? `${base} · ${p.timeUsed}% of the time used` : base;
}

/** "◆ Beta build, 6 Nov" — the next milestone in the details. */
export function nextLine(p: TimelineProject, today: string): string {
  const m = p.nextMilestone;
  if (!m) return p.milestoneCount ? 'Every milestone reached' : 'No milestones';
  if (!m.date) return `◆ ${m.title}, no date`;
  return `◆ ${m.title}, ${shortDay(m.date, today)}${m.date < today ? ' (overdue)' : ''}`;
}

/** A phone row's target: "Target 10 Dec", "Target 21 Oct · 3 days late", "No target date". */
export function targetLine(p: TimelineProject, today: string): string {
  if (!p.target) return 'No target date';
  if (p.health === 'late') return lateNote(p, today);
  return p.targetFrom === 'tasks' ? `Last task due ${shortDay(p.target, today)}` : `Target ${shortDay(p.target, today)}`;
}

const WEEKDAY_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/** "Thu 22 Oct". */
export const weekdayDay = (key: string) => WEEKDAY_DAY.format(new Date(`${key}T12:00:00.000Z`)).replace(',', '').replace('Sept', 'Sep');

/** How far apart (in days) markers start, so each stays a full 24px target that never overlaps the next — at the chart's narrowest. */
export function markerSpanDays(weeks: number): number {
  return weeks <= 6 ? 2 : weeks <= 13 ? 7 : 14;
}

export interface Marker<T> {
  key: string;
  first: string;
  last: string;
  items: T[];
}

/** Clusters that each start at least `span` days after the one before (sorted by day). */
function clusters<T>(items: T[], dayOf: (x: T) => string, span: number, order: (a: T, b: T) => number): Marker<T>[] {
  const out: Marker<T>[] = [];
  for (const x of [...items].sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || order(a, b))) {
    const day = dayOf(x);
    const last = out[out.length - 1];
    if (last && daysBetween(last.first, day) < span) {
      last.items.push(x);
      last.last = day;
    } else out.push({ key: day, first: day, last: day, items: [x] });
  }
  return out;
}

export type MeetingMarker = Marker<TimelineMeeting>;
export type MilestoneMarker = Marker<TimelineMilestone> & { done: boolean };

/** A project's meetings as markers (see markerSpanDays). */
export function meetingMarkers(meetings: TimelineMeeting[], span: number): MeetingMarker[] {
  return clusters(meetings, (m) => m.day, span, (a, b) => a.startAt.localeCompare(b.startAt));
}

/** A project's dated milestones as markers; one is filled once every milestone in it is reached. */
export function milestoneMarkers(milestones: TimelineMilestone[], span: number): MilestoneMarker[] {
  return clusters(milestones.filter((m) => m.date !== null), (m) => m.date!, span, (a, b) => collator.compare(a.title, b.title)).map((g) => ({
    ...g,
    done: g.items.every((m) => m.done),
  }));
}

const dayRange = (g: Pick<Marker<unknown>, 'first' | 'last'>, single: string) => {
  if (g.first === g.last) return single;
  const [a, b] = [shortDay(g.first, g.first), shortDay(g.last, g.last)];
  return g.first.slice(0, 7) === g.last.slice(0, 7) ? `${a.split(' ')[0]}–${b}` : `${a} – ${b}`;
};

/** "Thu 22 Oct", "20–22 Oct" or "30 Oct – 1 Nov". */
export function markerDays(g: Pick<Marker<unknown>, 'first' | 'last'>): string {
  return dayRange(g, weekdayDay(g.first));
}

/** "Meeting Design review, Tue 27 Oct", "3 meetings, 20–22 Oct". */
export function markerLabel(g: MeetingMarker): string {
  return g.items.length === 1 ? `Meeting ${g.items[0]!.title}, ${markerDays(g)}` : `${g.items.length} meetings, ${markerDays(g)}`;
}

/** "Milestone Beta build, 6 Nov, not reached yet", "2 milestones, 6–7 Nov, 1 reached". */
export function milestoneMarkerLabel(g: MilestoneMarker, today: string): string {
  if (g.items.length === 1) {
    const m = g.items[0]!;
    return `Milestone ${m.title}, ${shortDay(m.date!, today)}, ${m.done ? 'reached' : 'not reached yet'}`;
  }
  const reached = g.items.filter((m) => m.done).length;
  const state = reached === g.items.length ? 'all reached' : reached ? `${reached} reached` : 'not reached yet';
  return `${g.items.length} milestones, ${dayRange(g, shortDay(g.first, today))}, ${state}`;
}

/** A task row's days: "12 → 20 Oct", "30 Oct → 2 Nov", or "due 22 Oct" (no start). */
export function taskWhen(t: { start: string | null; due: string }, today: string): string {
  if (!t.start) return `due ${shortDay(t.due, today)}`;
  const [a, b] = [shortDay(t.start, today), shortDay(t.due, today)];
  return t.start.slice(0, 7) === t.due.slice(0, 7) ? `${a.split(' ')[0]} → ${b}` : `${a} → ${b}`;
}

/** What a screen reader hears for a task row: "MOB-11 Login screen, 12 → 20 Oct, overdue". */
export function taskLabel(t: { key: string; title: string; start: string | null; due: string; done: boolean; overdue: boolean }, today: string): string {
  return `${t.key} ${t.title}, ${taskWhen(t, today)}${t.done ? ', done' : t.overdue ? ', overdue' : ''}`;
}

/** A task on a phone: "due 20 Oct · overdue", "due 22 Oct · ✓ done". */
export function phoneTaskLine(t: { due: string; done: boolean; overdue: boolean }, today: string): string {
  return `due ${shortDay(t.due, today)}${t.done ? ' · ✓ done' : t.overdue ? ' · overdue' : ''}`;
}

export type TaskShape =
  | { kind: 'bar'; left: number; width: number; startsBefore: boolean; endsAfter: boolean }
  | { kind: 'marker'; x: number }
  | { kind: 'before' }
  | { kind: 'after' };

/** A task row's mark: a bar from its start to the end of its due day, else a marker on its due day — or before or after the shown weeks. */
export function taskShape(t: { start: string | null; due: string }, range: { from: string; to: string }): TaskShape {
  const total = daysBetween(range.from, range.to) + 1;
  if (t.start && t.start <= t.due) {
    const a = xOf(t.start, range.from, total);
    const b = xOf(shiftDayKey(t.due, 1), range.from, total);
    if (b <= 0) return { kind: 'before' };
    if (a >= 100) return { kind: 'after' };
    const [l, r] = [Math.max(0, a), Math.min(100, b)];
    return { kind: 'bar', left: l, width: r - l, startsBefore: a < 0, endsAfter: b > 100 };
  }
  if (t.due < range.from) return { kind: 'before' };
  if (t.due > range.to) return { kind: 'after' };
  return { kind: 'marker', x: xOf(t.due, range.from, total) + 50 / total };
}

/** "Sara Ahmed" → "SA". */
export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** "Today · 24 Oct". */
export const todayLabel = (today: string) => `Today · ${shortDay(today, today)}`;
