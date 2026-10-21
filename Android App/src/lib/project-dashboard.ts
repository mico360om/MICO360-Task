/**
 * A project's dashboard, worked out from its tasks — the same rules as the web dashboard
 * (frontend lib/project-dashboard.ts and components/project-dashboard; a test keeps them equal):
 * where each task stands, the stat tiles, progress, milestones, the deadlines coming up, how far
 * through its dates the project is, who has how much on, the Tasks tab's groups and filters, and
 * what the AI status summary is asked. "Today" is a 'YYYY-MM-DD' day in company time; due dates
 * are calendar days.
 */
import type { ApiColumn, ApiTask, Priority } from './types';
import type { Tone } from './tone';
import { appTimeZone, dueDayKey, isTaskDone } from './due-date';

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);

/** The app's one "finished" rule (due-date's isTaskDone). */
export const isTaskFinished = (t: ApiTask) => isTaskDone(t);

export type MilestoneState = 'done' | 'overdue' | 'upcoming' | 'undated';

/** The project's milestones by date (undated last), with where each stands. */
export function projectMilestones(tasks: ApiTask[], today: string, timeZone: string = appTimeZone()) {
  return tasks
    .filter((t) => t.isMilestone)
    .map((t) => {
      const due = dueDayKey(t.dueDate, timeZone);
      const state: MilestoneState = isTaskFinished(t) ? 'done' : !due ? 'undated' : due < today ? 'overdue' : 'upcoming';
      return { task: t, due, state, daysLeft: due && state !== 'done' ? daysBetween(today, due) : null };
    })
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.task.title.localeCompare(b.task.title));
}

/** Open tasks due within `withinDays` (and every overdue one), soonest first. */
export function projectDeadlines(tasks: ApiTask[], today: string, withinDays = 14, timeZone: string = appTimeZone()) {
  const list: { task: ApiTask; due: string; daysLeft: number }[] = [];
  for (const t of tasks) {
    const due = dueDayKey(t.dueDate, timeZone);
    if (!due || isTaskFinished(t)) continue;
    const daysLeft = daysBetween(today, due);
    if (daysLeft <= withinDays) list.push({ task: t, due, daysLeft });
  }
  return list.sort((a, b) => a.daysLeft - b.daysLeft || a.task.title.localeCompare(b.task.title));
}

/** "Today", "Tomorrow", "In 5 days", "3 days late". */
export function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  if (daysLeft > 1) return `In ${daysLeft} days`;
  return daysLeft === -1 ? '1 day late' : `${-daysLeft} days late`;
}

// ── Where each task stands, and the stat tiles (5b) ─────────────────────────
export type TaskPhase = 'completed' | 'overdue' | 'ongoing' | 'pending';

const ONGOING = new Set(['IN_PROGRESS', 'REVIEW', 'BLOCKED']);

/** Completed; overdue (open and past its due day); ongoing (being worked on); or pending (not started). */
export function taskPhase(t: ApiTask, today: string, timeZone: string = appTimeZone()): TaskPhase {
  if (isTaskFinished(t)) return 'completed';
  const due = dueDayKey(t.dueDate, timeZone);
  if (due && due < today) return 'overdue';
  return ONGOING.has(t.columnCategory ?? '') ? 'ongoing' : 'pending';
}

export interface TaskStats {
  total: number;
  completed: number;
  overdue: number;
  ongoing: number;
  pending: number;
  /** Share of tasks finished. */
  pct: number;
  /** The tasks' average progress (finished ones count as 100%). */
  avgProgress: number;
  /** Open tasks by priority. */
  byPriority: Record<Priority, number>;
}

export function taskStats(tasks: ApiTask[], today: string, timeZone: string = appTimeZone()): TaskStats {
  const count = { completed: 0, overdue: 0, ongoing: 0, pending: 0 };
  const byPriority: Record<Priority, number> = { URGENT: 0, HIGH: 0, NORMAL: 0, LOW: 0 };
  let progress = 0;
  for (const t of tasks) {
    const phase = taskPhase(t, today, timeZone);
    count[phase] += 1;
    progress += phase === 'completed' ? 100 : Math.max(0, Math.min(100, t.progress ?? 0));
    if (phase !== 'completed') byPriority[t.priority] += 1;
  }
  const total = tasks.length;
  return {
    total,
    ...count,
    pct: total ? Math.round((count.completed / total) * 100) : 0,
    avgProgress: total ? Math.round(progress / total) : 0,
    byPriority,
  };
}

export interface StatTile {
  key: 'total' | 'completed' | 'ongoing' | 'overdue' | 'pct';
  label: string;
  value: string;
  hint?: string;
  tone: Tone;
}

/** The five tiles: "—" until the tasks arrive (a zero would read as "this project has no tasks"). */
export function statTiles(s: TaskStats, ready: boolean): StatTile[] {
  const v = (n: number | string) => (ready ? String(n) : '—');
  return [
    { key: 'total', label: 'Total tasks', value: v(s.total), ...(ready && s.pending ? { hint: `${s.pending} not started` } : {}), tone: 'neutral' },
    { key: 'completed', label: 'Completed', value: v(s.completed), tone: 'success' },
    { key: 'ongoing', label: 'Ongoing', value: v(s.ongoing), tone: 'info' },
    { key: 'overdue', label: 'Overdue', value: v(s.overdue), tone: 'danger' },
    { key: 'pct', label: 'Completion', value: v(`${s.pct}%`), tone: 'brand' },
  ];
}

/** "3 of 8 tasks · 52% overall". */
export function workDoneText(s: TaskStats, ready: boolean): string {
  return ready ? `${s.completed} of ${s.total} tasks · ${s.avgProgress}% overall` : '…';
}

export function priorityLine(s: TaskStats): string {
  const p = s.byPriority;
  return `Open by priority: ${p.URGENT} urgent · ${p.HIGH} high · ${p.NORMAL} normal · ${p.LOW} low`;
}

// ── Who has what ─────────────────────────────────────────────────────────────
/** An assignee as a task list gives it ({ id, name }), or as a full user. */
type ListedPerson = { id: string; name?: string | null; username?: string; firstName?: string | null; lastName?: string | null };

/** A task's people, named: the list's name, else the full name, else the username. */
export function taskPeople(t: ApiTask): { id: string; name: string }[] {
  const raw = (t.assignees ?? []) as unknown as ListedPerson[];
  return raw.map((a) => ({ id: a.id, name: a.name || `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.username || 'Someone' }));
}

/** Each assignee's open, overdue and completed tasks — busiest first. */
export function workload(tasks: ApiTask[], today: string, timeZone: string = appTimeZone()) {
  const people = new Map<string, { id: string; name: string; open: number; overdue: number; completed: number }>();
  for (const t of tasks) {
    const phase = taskPhase(t, today, timeZone);
    for (const a of taskPeople(t)) {
      const p = people.get(a.id) ?? { id: a.id, name: a.name, open: 0, overdue: 0, completed: 0 };
      if (phase === 'completed') p.completed += 1;
      else {
        p.open += 1;
        if (phase === 'overdue') p.overdue += 1;
      }
      people.set(a.id, p);
    }
  }
  return [...people.values()].sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.name.localeCompare(b.name));
}

// ── The project's dates ──────────────────────────────────────────────────────
export interface ProjectTimeline {
  start: string;
  end: string;
  elapsedPct: number;
  daysLeft: number;
  state: 'not-started' | 'running' | 'late';
}

/** How far through its start and target dates the project is (null without both). */
export function projectTimeline(startDate: string | null | undefined, targetDate: string | null | undefined, today: string, timeZone: string = appTimeZone()): ProjectTimeline | null {
  const start = dueDayKey(startDate, timeZone);
  const end = dueDayKey(targetDate, timeZone);
  if (!start || !end) return null;
  const span = Math.max(1, daysBetween(start, end));
  const gone = daysBetween(start, today);
  const daysLeft = daysBetween(today, end);
  const state = today < start ? 'not-started' : today > end ? 'late' : 'running';
  return { start, end, elapsedPct: Math.max(0, Math.min(100, Math.round((gone / span) * 100))), daysLeft, state };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-11-03' → '3 Nov 2026' (a calendar day, never shifted by a time zone). */
export function dayText(key: string | null | undefined): string {
  if (!key || !/^\d{4}-\d{2}-\d{2}/.test(key)) return '—';
  return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/** "today", "tomorrow", "in 3 days", "yesterday", "4 days ago". */
export function relativeDays(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** The time bar's words. */
export function timelineText(t: ProjectTimeline | null): string {
  if (!t) return 'Set a start and target date';
  if (t.state === 'not-started') return `Starts ${dayText(t.start)}`;
  if (t.state === 'late') return `${-t.daysLeft} days past the target date`;
  return `${t.daysLeft} ${t.daysLeft === 1 ? 'day' : 'days'} left · ends ${dayText(t.end)}`;
}

/** Where a milestone stands, in the website's words. */
export function milestoneNote(state: MilestoneState, daysLeft: number | null): string {
  if (state === 'done') return 'Reached';
  if (state === 'undated') return 'No date set';
  if (daysLeft === null) return '';
  if (state === 'overdue') return `Late by ${-daysLeft} ${daysLeft === -1 ? 'day' : 'days'}`;
  return daysLeft === 0 ? 'Due today' : `Due ${relativeDays(daysLeft)}`;
}

/** The owner's name from the people list: "No owner", their full name or username, or "Unknown". */
export function ownerName(ownerId: string | null | undefined, people: { id: string; username: string; firstName?: string | null; lastName?: string | null }[]): string {
  if (!ownerId) return 'No owner';
  const u = people.find((d) => d.id === ownerId);
  return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username : 'Unknown';
}

/** New meetings go only into a project that is still open (not completed or archived). */
export function canScheduleIn(project: { status: string } | null | undefined): boolean {
  return !!project && project.status !== 'ARCHIVED' && project.status !== 'COMPLETED';
}

/** "2 upcoming · 5 held · 3 open action items (2 late)". */
export function meetingsLine(stats: { upcoming: number; completed: number; openActionItems: number; overdueActionItems: number }): string {
  const items = `${stats.openActionItems} open action ${stats.openActionItems === 1 ? 'item' : 'items'}`;
  return `${stats.upcoming} upcoming · ${stats.completed} held · ${items}${stats.overdueActionItems ? ` (${stats.overdueActionItems} late)` : ''}`;
}

// ── The Tasks tab ────────────────────────────────────────────────────────────
/** Each task with its column's stage (the board's columns decide what "done" or "in progress" is). */
export function withColumnStage(tasks: ApiTask[], columns: ApiColumn[]): ApiTask[] {
  const byId = new Map(columns.map((c) => [c.id, c]));
  return tasks.map((t) => ({ ...t, columnCategory: byId.get(t.columnId)?.category ?? t.columnCategory ?? 'TODO' }));
}

export interface TaskGroup {
  id: string;
  name: string;
  /** The column's colour; null for tasks whose column is gone ("Uncategorized"). */
  color: string | null;
  category: string | null;
  tasks: ApiTask[];
}

/** The tasks by their status column, in board order, then any whose column is gone. */
export function taskGroups(columns: ApiColumn[], tasks: ApiTask[]): TaskGroup[] {
  const ordered = [...columns].sort((a, b) => a.position - b.position);
  const known = new Set(ordered.map((c) => c.id));
  const groups: TaskGroup[] = ordered.map((c) => ({ id: c.id, name: c.name, color: c.color || null, category: c.category, tasks: tasks.filter((t) => t.columnId === c.id) }));
  const strays = tasks.filter((t) => !known.has(t.columnId));
  if (strays.length) groups.push({ id: '__orphan', name: 'Uncategorized', color: null, category: null, tasks: strays });
  return groups;
}

export type TaskFilter = 'all' | TaskPhase | 'milestones';

export const TASK_FILTERS: readonly { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'milestones', label: 'Milestones' },
];

export function filterCounts(tasks: ApiTask[], today: string, timeZone: string = appTimeZone()): Record<TaskFilter, number> {
  const c: Record<TaskFilter, number> = { all: tasks.length, ongoing: 0, pending: 0, overdue: 0, completed: 0, milestones: 0 };
  for (const t of tasks) {
    c[taskPhase(t, today, timeZone)] += 1;
    if (t.isMilestone) c.milestones += 1;
  }
  return c;
}

/** The groups narrowed to a filter and to words in a task's title or key; empty groups are left out. */
export function shownGroups(groups: TaskGroup[], filter: TaskFilter, query: string, today: string, timeZone: string = appTimeZone()): TaskGroup[] {
  const words = query.trim().toLocaleLowerCase();
  const keep = (t: ApiTask) =>
    (filter === 'all' || (filter === 'milestones' ? !!t.isMilestone : taskPhase(t, today, timeZone) === filter)) &&
    (!words || t.title.toLocaleLowerCase().includes(words) || t.key.toLocaleLowerCase().includes(words));
  return groups.map((g) => ({ ...g, tasks: g.tasks.filter(keep) })).filter((g) => g.tasks.length > 0);
}

const PRIORITY_WORD: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

/** A task's progress as shown (a finished one is 100%). */
export const shownProgress = (t: ApiTask, phase: TaskPhase) => (phase === 'completed' ? 100 : Math.max(0, Math.min(100, t.progress ?? 0)));

/** What TalkBack says for a row of the Tasks tab: everything the row shows. */
export function tasksTabRowLabel(t: ApiTask, row: { statusName: string; phase: TaskPhase; dueText: string | null }): string {
  const people = taskPeople(t).map((p) => p.name);
  return [
    t.key,
    t.isMilestone ? 'milestone' : null,
    t.title,
    row.statusName,
    `${PRIORITY_WORD[t.priority] ?? 'Normal'} priority`,
    `${shownProgress(t, row.phase)}% done`,
    people.length ? people.join(', ') : 'Unassigned',
    row.phase === 'overdue' ? 'overdue' : null,
    row.dueText ? `due ${row.dueText}` : 'No due date',
  ]
    .filter(Boolean)
    .join(', ');
}

// ── The AI status summary ────────────────────────────────────────────────────
export interface SummaryRequest {
  name: string;
  stats: { total: number; completed: number; inProgress: number; overdue: number };
  sampleTitles: string[];
}

/**
 * What "Generate summary" asks the AI, as the website does: the live figures and up to eight open
 * task titles — within the server's limits (a name of 200 characters, titles of 300).
 */
export function summaryRequest(projectName: string, tasks: ApiTask[], s: TaskStats): SummaryRequest {
  return {
    name: projectName.trim().slice(0, 200) || 'Project',
    stats: { total: s.total, completed: s.completed, inProgress: s.ongoing, overdue: s.overdue },
    sampleTitles: tasks
      .filter((t) => t.columnCategory !== 'DONE')
      .slice(0, 8)
      .map((t) => t.title.slice(0, 300)),
  };
}
