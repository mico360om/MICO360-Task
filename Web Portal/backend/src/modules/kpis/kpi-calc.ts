/**
 * Project KPIs and User KPIs — the counting. One pass over a window's tasks gives, per project and per
 * (project, person), counters that add up: a period's figures, a drill-down's totals and a stored
 * snapshot slice are the same counters, so they can never disagree. Pure.
 *
 * Definitions (design + owner answers; working days from the Notification & Scheduling helper):
 *   - Completed: tasks done in the window — done when completed, or when handed in for approval.
 *   - On time: of those with an agreed due day (task-history baselineAsOf, as of the finish), finished on
 *     or before it. Days late: working days from the agreed due day to the finish day.
 *   - Overdue (point in time, at the window's end): open tasks past their agreed due day, of open tasks
 *     with one (a task due today is not overdue).
 *   - Cycle time: working days from the start day (else the creation day) to the finish day.
 *   - Approval turnaround: working hours from a hand-in to its decision, in the window of the decision;
 *     for people, the approver's.
 *   - Completion at the window's end: tasks (and weights) existing then, done by then.
 *   - People (call 2): "completed" for everyone on it at completion; on time / late for everyone on it on
 *     its agreed due day (task-history judgedPeople); overdue for whoever is on it at the end.
 *   - The task archive: an archived open task leaves every figure; an archived Done task still counts.
 * Binned and merged tasks are never read (the source leaves out deleted rows).
 */
import { workingDaysBetween, workingDaysLate, type WorkCalendar, type WorkHours } from '../../lib/working-days';
import { dueDayKey, shiftDayKey, zonedDayKey, zonedStartOfDay } from '../../lib/due-date';
import { effectiveWeight, type WeightDefaults } from '../project-health/completion';
import { approvalCycles, assignedAt, baselineAsOf, completedMoment, doneMoment, judgedPeople, responsibleAt, type BaselineRules, type KpiTask } from './task-history';
import { median, workingHoursBetween } from './working-time';
import { countsInKpis } from './kpi-task-scope';

export interface ProjectCalc {
  calendar: WorkCalendar;
  hours: WorkHours;
  weights: WeightDefaults;
  rules: BaselineRules;
}

export interface CalcContext {
  timeZone: string;
  project(projectId: string): ProjectCalc;
}

/** A window of days (both included) as instants; `end` is when its point-in-time figures are read (its end, or now). */
export interface CalcWindow {
  fromDay: string;
  toDay: string;
  from: Date;
  /** Exclusive. */
  to: Date;
}

export function windowOf(fromDay: string, toDay: string, timeZone: string, now: Date): CalcWindow {
  const from = zonedStartOfDay(fromDay, timeZone);
  const after = zonedStartOfDay(shiftDayKey(toDay, 1), timeZone);
  return { fromDay, toDay, from, to: after.getTime() > now.getTime() ? now : after };
}

/** Counts that add up across slices; `openDue` and `overdue` are read at the window's end. */
export interface Counters {
  completed: number;
  dueDone: number;
  onTime: number;
  lateCount: number;
  lateDays: number;
  cycleCount: number;
  cycleDays: number;
  approvalCount: number;
  approvalHours: number;
  openDue: number;
  overdue: number;
}

/** A project's counters and its completion at the window's end (from the tasks read). */
export interface ProjectCounters extends Counters {
  total: number;
  done: number;
  weightTotal: number;
  weightDone: number;
}

export const emptyCounters = (): Counters => ({ completed: 0, dueDone: 0, onTime: 0, lateCount: 0, lateDays: 0, cycleCount: 0, cycleDays: 0, approvalCount: 0, approvalHours: 0, openDue: 0, overdue: 0 });
const emptyProject = (): ProjectCounters => ({ ...emptyCounters(), total: 0, done: 0, weightTotal: 0, weightDone: 0 });

const ADDITIVE: (keyof Counters)[] = ['completed', 'dueDone', 'onTime', 'lateCount', 'lateDays', 'cycleCount', 'cycleDays', 'approvalCount', 'approvalHours'];

/** Two slices one after the other: counts add; the point-in-time ones are the later slice's. */
export function addCounters<T extends Counters>(a: T, b: T): T {
  const out = { ...a };
  for (const k of ADDITIVE) (out as Counters)[k] = a[k] + b[k];
  out.openDue = b.openDue;
  out.overdue = b.overdue;
  return out;
}

const ms = (d: Date) => d.getTime();
const inWindow = (d: Date, w: CalcWindow) => ms(d) >= ms(w.from) && ms(d) < ms(w.to);

export interface WindowCounts {
  projects: Map<string, ProjectCounters>;
  /** projectId → userId → counters. */
  people: Map<string, Map<string, Counters>>;
}

/** Every counter of a window, for the projects the tasks are in. */
export function countWindow(tasks: readonly KpiTask[], w: CalcWindow, ctx: CalcContext): WindowCounts {
  const projects = new Map<string, ProjectCounters>();
  const people = new Map<string, Map<string, Counters>>();
  const proj = (id: string) => {
    let p = projects.get(id);
    if (!p) projects.set(id, (p = emptyProject()));
    return p;
  };
  const person = (projectId: string, userId: string) => {
    let m = people.get(projectId);
    if (!m) people.set(projectId, (m = new Map()));
    let c = m.get(userId);
    if (!c) m.set(userId, (c = emptyCounters()));
    return c;
  };
  const tz = ctx.timeZone;
  const endDay = zonedDayKey(new Date(ms(w.to) - 1), tz);
  const endAt = new Date(ms(w.to) - 1);

  for (const t of tasks) {
    const doneAt = doneMoment(t);
    const doneByEnd = doneAt !== null && ms(doneAt) < ms(w.to);
    if (!countsInKpis(t, doneAt !== null)) continue;
    const pc = ctx.project(t.projectId);
    const p = proj(t.projectId);

    // Finished in the window.
    if (doneAt && inWindow(doneAt, w)) {
      p.completed += 1;
      for (const u of assignedAt(t, doneAt)) person(t.projectId, u).completed += 1;
      const doneDay = zonedDayKey(doneAt, tz);
      const baseline = baselineAsOf(t, doneAt, pc.rules, tz);
      if (baseline) {
        // Late = finished one working day or more after the agreed day (a Thursday task finished on Friday,
        // a day off, is not late — days late count working days).
        const late = doneDay > baseline ? workingDaysLate(baseline, doneDay, pc.calendar) : 0;
        const onTime = late === 0;
        p.dueDone += 1;
        if (onTime) p.onTime += 1;
        else {
          p.lateCount += 1;
          p.lateDays += late;
        }
        for (const u of judgedPeople(t, baseline, doneAt, tz, pc.rules)) {
          const c = person(t.projectId, u);
          c.dueDone += 1;
          if (onTime) c.onTime += 1;
          else {
            c.lateCount += 1;
            c.lateDays += late;
          }
        }
      }
      const startDay = dueDayKey(t.startDate, tz) ?? zonedDayKey(t.createdAt, tz);
      p.cycleCount += 1;
      p.cycleDays += Math.max(0, workingDaysBetween(startDay, doneDay, pc.calendar));
    }

    // Decisions on hand-ins in the window.
    for (const cycle of approvalCycles(t)) {
      if (!inWindow(cycle.decidedAt, w)) continue;
      const hours = workingHoursBetween(cycle.requestedAt, cycle.decidedAt, tz, pc.calendar, pc.hours);
      p.approvalCount += 1;
      p.approvalHours += hours;
      const c = person(t.projectId, cycle.decidedBy);
      c.approvalCount += 1;
      c.approvalHours += hours;
    }

    // At the window's end: existing tasks, completed by then (the project's own completion rule: a task
    // waiting for approval is not complete), and open work (a handed-in task is no work in hand).
    if (ms(t.createdAt) >= ms(w.to)) continue;
    const weight = effectiveWeight(t, pc.weights);
    p.total += 1;
    p.weightTotal += weight;
    const completed = completedMoment(t);
    if (completed && ms(completed) < ms(w.to)) {
      p.done += 1;
      p.weightDone += weight;
    }
    if (doneByEnd) continue;
    const baseline = baselineAsOf(t, endAt, pc.rules, tz);
    if (!baseline) continue;
    const overdue = baseline < endDay && workingDaysLate(baseline, endDay, pc.calendar) > 0;
    p.openDue += 1;
    if (overdue) p.overdue += 1;
    // Everyone answerable for it then: taking yourself off doesn't hide overdue work (review I2).
    for (const u of responsibleAt(t, endAt, pc.rules)) {
      const c = person(t.projectId, u);
      c.openDue += 1;
      if (overdue) c.overdue += 1;
    }
  }
  return { projects, people };
}

// ── Update responsiveness (call 3) ───────────────────────────────────────────

/** A task's comments and status changes (oldest first), each with who it was by and whom it @mentions. */
export interface Conversation {
  task: KpiTask;
  items: { at: Date; userId: string; kind: 'comment' | 'status'; mentions: string[] }[];
}

/**
 * Each person's response times (working hours) answered in the window, per project: a prompt is an
 * @mention of them or someone else's comment on a task assigned to them; a response is their next
 * comment or status change on that task. Prompts while one is waiting don't restart the clock.
 */
/** A prompt this long before a window may still be answered inside it (the same for live figures and snapshots). */
export const PROMPT_LOOKBACK_MS = 30 * 86_400_000;

export function countResponses(conversations: readonly Conversation[], w: CalcWindow, ctx: CalcContext): Map<string, Map<string, number[]>> {
  const out = new Map<string, Map<string, number[]>>();
  const earliest = ms(w.from) - PROMPT_LOOKBACK_MS;
  for (const { task, items } of conversations) {
    const pc = ctx.project(task.projectId);
    const pending = new Map<string, Date>();
    for (const it of [...items].sort((a, b) => ms(a.at) - ms(b.at))) {
      // Their own comment or status change answers what was waiting for them.
      const waiting = pending.get(it.userId);
      if (waiting) {
        pending.delete(it.userId);
        if (inWindow(it.at, w) && ms(waiting) >= earliest) {
          let m = out.get(task.projectId);
          if (!m) out.set(task.projectId, (m = new Map()));
          m.set(it.userId, [...(m.get(it.userId) ?? []), workingHoursBetween(waiting, it.at, ctx.timeZone, pc.calendar, pc.hours)]);
        }
      }
      if (it.kind !== 'comment') continue;
      const prompted = new Set([...it.mentions, ...assignedAt(task, it.at)]);
      prompted.delete(it.userId);
      for (const u of prompted) if (!pending.has(u)) pending.set(u, it.at);
    }
  }
  return out;
}

// ── Figures ──────────────────────────────────────────────────────────────────

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const one = (v: number) => Math.round(v * 10) / 10;

export interface ProjectFigures {
  onTime: number | null;
  overdue: number | null;
  daysLate: number | null;
  progress: number | null;
  throughput: number;
  cycleTime: number | null;
  approvalTurnaround: number | null;
  blocked: number | null;
}

/** A project's KPIs from its counters (progress and blocked are worked out elsewhere and passed in). */
export function projectFigures(c: Counters, extra: { weeks: number; blocked: number | null; progress: number | null }): ProjectFigures {
  return {
    onTime: pct(c.onTime, c.dueDone),
    overdue: pct(c.overdue, c.openDue),
    daysLate: c.dueDone ? (c.lateCount ? one(c.lateDays / c.lateCount) : 0) : null,
    progress: extra.progress,
    throughput: one(c.completed / Math.max(extra.weeks, 1 / 7)),
    cycleTime: c.cycleCount ? one(c.cycleDays / c.cycleCount) : null,
    approvalTurnaround: c.approvalCount ? one(c.approvalHours / c.approvalCount) : null,
    blocked: extra.blocked,
  };
}

export interface UserFigures {
  completed: number;
  onTime: number | null;
  daysLate: number | null;
  userOverdue: number;
  workload: number | null;
  approvalTurnaround: number | null;
  responsiveness: number | null;
  actionItems: number;
}

export function userFigures(c: Counters, extra: { responses: number[]; actionItems: number; workload: number | null }): UserFigures {
  const m = median(extra.responses);
  return {
    completed: c.completed,
    onTime: pct(c.onTime, c.dueDone),
    daysLate: c.dueDone ? (c.lateCount ? one(c.lateDays / c.lateCount) : 0) : null,
    userOverdue: c.overdue,
    workload: extra.workload,
    approvalTurnaround: c.approvalCount ? one(c.approvalHours / c.approvalCount) : null,
    responsiveness: m === null ? null : one(m),
    actionItems: extra.actionItems,
  };
}

/** Progress against time: completion ÷ the share of planned time used, as a percentage (≥ 100 ahead). Null without a usable plan. */
export function progressRatio(completionPct: number, timeUsedPct: number | null): number | null {
  if (timeUsedPct === null || timeUsedPct <= 0) return null;
  return Math.min(999, Math.round((completionPct / timeUsedPct) * 100));
}
