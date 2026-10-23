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

/** What the database hands back for the shown projects — grouped rows, never one query per project. */
export interface TimelineRows {
  /** Every live task per project. */
  totals: { projectId: string; total: number }[];
  /** Open (not done) tasks per project and due date (null: no due date), counted. */
  openByDue: { projectId: string; dueDate: Date | null; count: number }[];
  /** The projects' milestones (tasks marked as milestones), done or not. */
  milestones: { id: string; key: string; title: string; projectId: string; dueDate: Date | null; done: boolean }[];
  /** The projects' meetings (not cancelled) in the asked window. */
  meetings: { id: string; title: string; projectId: string; startAt: Date; endAt: Date | null }[];
  owners: TimelinePerson[];
}

export interface TimelineSource {
  /** Figures for these projects in a fixed number of queries; meetings between `meetingsFrom` and `meetingsTo`. */
  load(projectIds: string[], ownerIds: string[], window: { meetingsFrom: Date; meetingsTo: Date }): Promise<TimelineRows>;
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
  /** The first day of its bar: its start date, else the day it was created. */
  start: string;
  startIsCreated: boolean;
  /** Its target day, or null. */
  target: string | null;
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
export function projectHealth({ start, target, today, progress }: { start: string; target: string | null; today: string; progress: number }): {
  health: ProjectHealth;
  timeUsed: number | null;
  daysLate: number;
} {
  if (!target) return { health: 'no-target', timeUsed: null, daysLate: 0 };
  if (target < today) return { health: 'late', timeUsed: 100, daysLate: daysBetween(target, today) };
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
  const weekEnd = shiftDayKey(currentWeek, 6);
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

  const milestones = new Map<string, TimelineMilestone[]>();
  for (const m of rows.milestones) {
    const list = milestones.get(m.projectId) ?? [];
    list.push({ id: m.id, key: m.key, title: m.title, date: dueDayKey(m.dueDate, timeZone), done: m.done });
    milestones.set(m.projectId, list);
  }

  const meetings = new Map<string, { shown: TimelineMeeting[]; thisWeek: number }>();
  for (const m of [...rows.meetings].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    const s = meetings.get(m.projectId) ?? { shown: [], thisWeek: 0 };
    const meetingDay = zonedDayKey(m.startAt, timeZone);
    if (meetingDay >= range.from && meetingDay <= range.to) s.shown.push({ id: m.id, title: m.title, startAt: m.startAt, day: meetingDay });
    if (meetingDay >= currentWeek && meetingDay <= weekEnd) s.thisWeek += 1;
    meetings.set(m.projectId, s);
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
      const own = dueDayKey(p.startDate, timeZone);
      const start = own ?? zonedDayKey(p.createdAt, timeZone);
      const target = dueDayKey(p.targetDate, timeZone);
      const list = (milestones.get(p.id) ?? []).sort(byDate);
      const m = meetings.get(p.id) ?? { shown: [], thisWeek: 0 };
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
        startIsCreated: own === null,
        target,
        tasks: { total, done, open: o.open, overdue: o.overdue },
        progress,
        ...projectHealth({ start, target, today, progress }),
        dueByWeek: o.weeks,
        milestones: list,
        nextMilestone: list.find((x) => !x.done) ?? null,
        milestonesSoon: list.filter((x) => !x.done && x.date !== null && x.date >= today && x.date <= soonEnd).length,
        meetings: m.shown,
        meetingsThisWeek: m.thisWeek,
      };
    }),
  };
}
