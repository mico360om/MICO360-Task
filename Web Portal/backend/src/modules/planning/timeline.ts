import { dueDayKey, shiftDayKey, todayKey, zonedDayKey } from '../../lib/due-date';
import type { ProjectRecord } from '../projects/project-repository';

/** The first day of a week: 0 = Sunday, 1 = Monday, 6 = Saturday (as on the calendar). */
export type WeekStart = 0 | 1 | 6;

/** Where a project stands against its dates. */
export type ProjectHealth = 'on-track' | 'at-risk' | 'late' | 'no-target';

/** A person as the timeline shows them (a project's owner). */
export interface TimelinePerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface TimelineMilestoneRow {
  id: string;
  key: string;
  title: string;
  projectId: string;
  dueDate: Date | null;
  done: boolean;
}

/** The moments a timeline reads between (each from inclusive, to exclusive). */
export interface TimelineWindow {
  shownFrom: Date;
  shownTo: Date;
  soonFrom: Date;
  soonTo: Date;
  weekFrom: Date;
  weekTo: Date;
}

/** What the database hands back for the shown projects — grouped rows, never one query per project. */
export interface TimelineRows {
  /** Every live task per project. */
  totals: { projectId: string; total: number }[];
  /** Open (not done) tasks per project and due date (null: no due date), counted. */
  openByDue: { projectId: string; dueDate: Date | null; count: number }[];
  /** Per project, its live tasks' (done or not) earliest start date, earliest and latest due date. */
  taskDates: { projectId: string; minStart: Date | null; minDue: Date | null; maxDue: Date | null }[];
  /** Milestones (tasks marked as milestones) due in the shown weeks, done or not: the markers. */
  milestones: TimelineMilestoneRow[];
  /** Each project's earliest milestone not reached yet (all of them on that day), or its undated ones when none has a date. */
  nextMilestones: TimelineMilestoneRow[];
  /** Milestones not reached yet due around the next 30 days (the builder keeps today to 30 days on). */
  soonMilestones: { projectId: string; dueDate: Date | null }[];
  /** How many milestones each project has. */
  milestoneCounts: { projectId: string; count: number }[];
  /** Meetings (not cancelled) in the shown weeks: the markers. */
  meetings: { id: string; title: string; projectId: string; startAt: Date; endAt: Date | null }[];
  /** Meetings (not cancelled) in the current week, per project. */
  meetingsThisWeek: { projectId: string; count: number }[];
  owners: TimelinePerson[];
}

export interface TimelineSource {
  /**
   * Figures for these projects in a fixed number of queries: markers between `shownFrom` and
   * `shownTo`, milestones due soon between `soonFrom` and `soonTo`, meetings this week between
   * `weekFrom` and `weekTo`. Nothing is capped, so no project can lose its next milestone or its last meetings.
   */
  load(projectIds: string[], ownerIds: string[], window: TimelineWindow): Promise<TimelineRows>;
  /**
   * One project's task rows: the tasks with a due date from `from` on that are due or start before
   * `to`, the open ones due before `before` (most recent first, at most a page), and the counts.
   */
  projectTasks(projectId: string, window: { from: Date; to: Date; before: Date }): Promise<TimelineTasksRows>;
}

/** A task as the timeline's task rows read it. */
export interface TimelineTaskRow {
  id: string;
  key: string;
  title: string;
  startDate: Date | null;
  dueDate: Date | null;
  done: boolean;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  isMilestone: boolean;
  assignees: { id: string; name: string }[];
}

export interface TimelineTasksRows {
  inRange: TimelineTaskRow[];
  before: TimelineTaskRow[];
  /** Every live task of the project. */
  total: number;
  /** Its live tasks without a due date. */
  undated: number;
}

export interface TimelineTask {
  id: string;
  key: string;
  title: string;
  /** Its start day when it has one (on or before its due day), else null: drawn as a marker. */
  start: string | null;
  due: string;
  done: boolean;
  /** Open and due before today. */
  overdue: boolean;
  priority: TimelineTaskRow['priority'];
  isMilestone: boolean;
  assignees: { id: string; name: string }[];
}

export interface TimelineTasksData {
  projectId: string;
  from: string;
  to: string;
  today: string;
  total: number;
  undated: number;
  tasks: TimelineTask[];
}

/** The weeks a timeline shows: `from` is a week's first day, `to` a week's last day. */
export interface TimelineRange {
  from: string;
  to: string;
  /** Each week's first day, in order. */
  weeks: string[];
}

export interface TimelineMilestone {
  id: string;
  key: string;
  title: string;
  /** Its due day ('YYYY-MM-DD'), or null when it has none. */
  date: string | null;
  /** Reached: its task is done. */
  done: boolean;
}

export interface TimelineMeeting {
  id: string;
  title: string;
  startAt: Date;
  /** Its day in company time. */
  day: string;
}

export interface TimelineProject {
  id: string;
  code: string;
  name: string;
  color: string;
  icon: string | null;
  imageUrl: string | null;
  status: ProjectRecord['status'];
  owner: TimelinePerson | null;
  /** The first day of its bar: its start date, else its tasks' earliest date, else the day it was created. */
  start: string;
  /** Where `start` comes from. */
  startFrom: 'project' | 'tasks' | 'created';
  /** Kept for older clients: `startFrom === 'created'`. */
  startIsCreated: boolean;
  /** Its target day, else its tasks' latest due day, or null. */
  target: string | null;
  /** Where `target` comes from (null without one). */
  targetFrom: 'project' | 'tasks' | null;
  tasks: { total: number; done: number; open: number; overdue: number };
  /** Share of tasks done, as the Projects page rounds it (99 until every task is done). */
  progress: number;
  /** Share of the time from start to target already gone (0–100); null without a target. */
  timeUsed: number | null;
  health: ProjectHealth;
  /** Days past its target (late projects only, else 0). */
  daysLate: number;
  /** Open tasks due in each shown week, in the order of `weeks`. */
  dueByWeek: number[];
  milestones: TimelineMilestone[];
  /** The first milestone not reached yet (by date, undated last). */
  nextMilestone: TimelineMilestone | null;
  /** How many milestones it has (shown or not). */
  milestoneCount: number;
  /** Milestones not reached yet that are due from today to 30 days on. */
  milestonesSoon: number;
  /** Meetings in the shown weeks. */
  meetings: TimelineMeeting[];
  /** Meetings in the current week. */
  meetingsThisWeek: number;
}

export interface TimelineData {
  from: string;
  to: string;
  weekStart: WeekStart;
  today: string;
  /** The first day of the week today is in. */
  currentWeek: string;
  weeks: string[];
  projects: TimelineProject[];
}

/** The longest range one request may ask for: a year and a week. */
export const MAX_TIMELINE_WEEKS = 53;

const DAY_MS = 86_400_000;
const noon = (key: string) => Date.parse(`${key}T12:00:00.000Z`);
/** Whole days from one 'YYYY-MM-DD' day to another. */
export const daysBetween = (from: string, to: string): number => Math.round((noon(to) - noon(from)) / DAY_MS);
const weekdayOf = (key: string) => new Date(`${key}T12:00:00.000Z`).getUTCDay();

/** Share of tasks done: rounded, but 100% only once every task is done (as on the Projects page). */
export function progressPct(total: number, done: number): number {
  if (!total) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.round((done / total) * 100));
}

/** The first day of the week `day` is in. */
export function weekOf(day: string, weekStart: WeekStart): string {
  return shiftDayKey(day, -((weekdayOf(day) - weekStart + 7) % 7));
}

/** The weeks covering `from`…`to`, widened to whole weeks; null when the range is reversed or too long. */
export function timelineRange(from: string, to: string, weekStart: WeekStart): TimelineRange | null {
  if (to < from) return null;
  const first = weekOf(from, weekStart);
  const last = shiftDayKey(weekOf(to, weekStart), 6);
  const count = (daysBetween(first, last) + 1) / 7;
  if (count > MAX_TIMELINE_WEEKS) return null;
  return { from: first, to: last, weeks: Array.from({ length: count }, (_, i) => shiftDayKey(first, i * 7)) };
}

/** At risk: this many points (or more) less done than the share of time used. */
export const AT_RISK_GAP = 20;

/** On track, at risk (20 points or more less done than time used), late (target passed) or without a target. */
export function projectHealth({ start, target, today, progress, finished = false }: { start: string; target: string | null; today: string; progress: number; finished?: boolean }): {
  health: ProjectHealth;
  timeUsed: number | null;
  daysLate: number;
} {
  if (!target) return { health: 'no-target', timeUsed: null, daysLate: 0 };
  if (target < today) return finished ? { health: 'on-track', timeUsed: 100, daysLate: 0 } : { health: 'late', timeUsed: 100, daysLate: daysBetween(target, today) };
  // As the project dashboard works it out: the days gone over the days from start to target.
  const span = Math.max(1, daysBetween(start, target));
  const timeUsed = Math.max(0, Math.min(100, Math.round((daysBetween(start, today) / span) * 100)));
  return { health: timeUsed - progress >= AT_RISK_GAP ? 'at-risk' : 'on-track', timeUsed, daysLate: 0 };
}

/** Milestones by date (undated last), then by title. */
const byDate = (a: TimelineMilestone, b: TimelineMilestone) =>
  (a.date ?? '9999-99-99').localeCompare(b.date ?? '9999-99-99') || a.title.localeCompare(b.title);

/** How many days ahead "Milestones in 30 days" looks. */
export const MILESTONE_HORIZON_DAYS = 30;

/** The timeline's rows: one per project, with its bar, figures, milestones and meetings. */
export function buildTimeline(
  projects: ProjectRecord[],
  rows: TimelineRows,
  { timeZone, now = new Date(), range, weekStart }: { timeZone: string; now?: Date; range: TimelineRange; weekStart: WeekStart },
): TimelineData {
  const today = todayKey(timeZone, now);
  const currentWeek = weekOf(today, weekStart);
  const soonEnd = shiftDayKey(today, MILESTONE_HORIZON_DAYS);
  const totals = new Map(rows.totals.map((t) => [t.projectId, t.total]));
  const owners = new Map(rows.owners.map((o) => [o.id, o]));

  const open = new Map<string, { open: number; overdue: number; weeks: number[] }>();
  for (const g of rows.openByDue) {
    const s = open.get(g.projectId) ?? { open: 0, overdue: 0, weeks: range.weeks.map(() => 0) };
    s.open += g.count;
    const due = dueDayKey(g.dueDate, timeZone);
    if (due !== null && due < today) s.overdue += g.count;
    if (due !== null && due >= range.from && due <= range.to) s.weeks[Math.floor(daysBetween(range.from, due) / 7)]! += g.count;
    open.set(g.projectId, s);
  }

  const toMilestone = (m: TimelineMilestoneRow): TimelineMilestone => ({ id: m.id, key: m.key, title: m.title, date: dueDayKey(m.dueDate, timeZone), done: m.done });
  const next = new Map<string, TimelineMilestone>();
  for (const m of rows.nextMilestones.map((x) => ({ projectId: x.projectId, m: toMilestone(x) }))) {
    const best = next.get(m.projectId);
    if (!best || byDate(m.m, best) < 0) next.set(m.projectId, m.m);
  }
  const soon = new Map<string, number>();
  for (const r of rows.soonMilestones) {
    const day = dueDayKey(r.dueDate, timeZone);
    if (day !== null && day >= today && day <= soonEnd) soon.set(r.projectId, (soon.get(r.projectId) ?? 0) + 1);
  }
  const milestoneCounts = new Map(rows.milestoneCounts.map((c) => [c.projectId, c.count]));
  const taskDates = new Map(rows.taskDates.map((d) => [d.projectId, d]));
  const thisWeek = new Map(rows.meetingsThisWeek.map((c) => [c.projectId, c.count]));
  const milestones = new Map<string, TimelineMilestone[]>();
  for (const m of rows.milestones) {
    const date = dueDayKey(m.dueDate, timeZone);
    if (date === null || date < range.from || date > range.to) continue;
    const list = milestones.get(m.projectId) ?? [];
    list.push(toMilestone(m));
    milestones.set(m.projectId, list);
  }

  const meetings = new Map<string, TimelineMeeting[]>();
  for (const m of [...rows.meetings].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    const meetingDay = zonedDayKey(m.startAt, timeZone);
    if (meetingDay < range.from || meetingDay > range.to) continue;
    meetings.set(m.projectId, [...(meetings.get(m.projectId) ?? []), { id: m.id, title: m.title, startAt: m.startAt, day: meetingDay }]);
  }

  return {
    from: range.from,
    to: range.to,
    weekStart,
    today,
    currentWeek,
    weeks: range.weeks,
    projects: projects.map((p): TimelineProject => {
      const total = totals.get(p.id) ?? 0;
      const o = open.get(p.id) ?? { open: 0, overdue: 0, weeks: range.weeks.map(() => 0) };
      const done = Math.max(0, total - o.open);
      const progress = progressPct(total, done);
      // The project's own dates win, field by field; missing ones come from its tasks.
      const dates = taskDates.get(p.id);
      const ownStart = dueDayKey(p.startDate, timeZone);
      const ownTarget = dueDayKey(p.targetDate, timeZone);
      const fromTasks = [dates?.minStart, dates?.minDue].map((d) => dueDayKey(d ?? null, timeZone)).filter((d): d is string => d !== null).sort()[0] ?? null;
      const start = ownStart ?? fromTasks ?? zonedDayKey(p.createdAt, timeZone);
      const startFrom = ownStart ? 'project' : fromTasks ? 'tasks' : 'created';
      const lastDue = dueDayKey(dates?.maxDue ?? null, timeZone);
      // A task-derived end before the start says nothing about when the project ends.
      const target = ownTarget ?? (lastDue !== null && lastDue >= start ? lastDue : null);
      const targetFrom = ownTarget ? 'project' : target ? 'tasks' : null;
      const list = (milestones.get(p.id) ?? []).sort(byDate);

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        color: p.color,
        icon: p.icon,
        imageUrl: p.imageUrl,
        status: p.status,
        owner: p.ownerId ? owners.get(p.ownerId) ?? null : null,
        start,
        startFrom,
        startIsCreated: startFrom === 'created',
        target,
        targetFrom,
        tasks: { total, done, open: o.open, overdue: o.overdue },
        progress,
        // Dates taken from its tasks are over, not late, once every task is done.
        ...projectHealth({ start, target, today, progress, finished: targetFrom === 'tasks' && total > 0 && o.open === 0 }),
        dueByWeek: o.weeks,
        milestones: list,
        nextMilestone: next.get(p.id) ?? null,
        milestoneCount: milestoneCounts.get(p.id) ?? 0,
        milestonesSoon: soon.get(p.id) ?? 0,
        meetings: meetings.get(p.id) ?? [],
        meetingsThisWeek: thisWeek.get(p.id) ?? 0,
      };
    }),
  };
}

/** How many task rows a project shows; the rest are on its board. */
export const TIMELINE_TASK_LIMIT = 30;

/**
 * A project's task rows for the shown weeks: the tasks that fall in them (by their first day), then
 * its open tasks due before them (overdue, most recent first) — at most TIMELINE_TASK_LIMIT.
 */
export function buildTimelineTasks(
  projectId: string,
  rows: TimelineTasksRows,
  { from, to, timeZone, now = new Date() }: { from: string; to: string; timeZone: string; now?: Date },
): TimelineTasksData {
  const today = todayKey(timeZone, now);
  const toTask = (t: TimelineTaskRow): TimelineTask | null => {
    const due = dueDayKey(t.dueDate, timeZone);
    if (!due) return null;
    const start = dueDayKey(t.startDate, timeZone);
    return {
      id: t.id,
      key: t.key,
      title: t.title,
      start: start !== null && start <= due ? start : null,
      due,
      done: t.done,
      overdue: !t.done && due < today,
      priority: t.priority,
      isMilestone: t.isMilestone,
      assignees: t.assignees,
    };
  };
  const shown = rows.inRange
    .map(toTask)
    .filter((t): t is TimelineTask => t !== null && (t.start ?? t.due) <= to && t.due >= from)
    .sort((a, b) => (a.start ?? a.due).localeCompare(b.start ?? b.due) || a.due.localeCompare(b.due) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  const before = rows.before
    .map(toTask)
    .filter((t): t is TimelineTask => t !== null && !t.done && t.due < from)
    .sort((a, b) => b.due.localeCompare(a.due) || a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { projectId, from, to, today, total: rows.total, undated: rows.undated, tasks: [...shown, ...before].slice(0, TIMELINE_TASK_LIMIT) };
}
