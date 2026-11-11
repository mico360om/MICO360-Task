/**
 * KPIs: what a task's history says — when it counted as done, its agreed due date (the baseline) at any
 * moment, who was on it when, and its approval hand-ins with their decisions. Pure: the facts are read
 * once (kpi-source) and every figure is worked out from them, the same way for the live numbers, the
 * drill-down lists and the snapshots.
 *
 * Owner, 11 Nov (after the builder check):
 *   - The due date set when the task was assigned is the baseline. A change by whoever runs the project
 *     or an administrator re-baselines it (an agreed extension); a change by the assignee doesn't — the
 *     task is judged against the earlier date. Baselines are worked out from history (each UPDATED line's
 *     dueDate from → to and who made it).
 *   - A task needing approval counts as done when it was handed in.
 *
 * Rulings (gaming resistance, ledger R2–R5): a project manager moving a task assigned to themselves does
 * not re-baseline it (only an administrator's change always does); a colleague's change doesn't either;
 * an assignee clearing the date can't escape it; changes made before anyone was assigned are planning
 * (they set the baseline whoever made them); a first due date where none was agreed is the first
 * commitment, whoever sets it.
 */
import { dueDayKey, zonedDayKey, zonedStartOfDay, shiftDayKey } from '../../lib/due-date';

export interface HistoryEvent {
  at: Date;
  action: string;
  /** Who did it. */
  userId: string;
  meta: unknown;
}

export type KpiPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/** A task as the KPIs read it: its row and its history (oldest first). */
export interface KpiTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  /** Its column's kind (BACKLOG, TODO, IN_PROGRESS, BLOCKED, REVIEW, DONE). */
  columnCategory: string;
  approvalRequestedAt: Date | null;
  priority: KpiPriority;
  weight: number | null;
  /** Its people now, and when each was put on it. */
  assignees: { userId: string; assignedAt: Date }[];
  /** Its timeline lines the KPIs read (UPDATED, ASSIGNED, UNASSIGNED, approvals, moves), oldest first. */
  events: HistoryEvent[];
  /** The task archive (bulk release): null when not archived. */
  archivedAt?: Date | null;
  /**
   * Owner, 11 Nov ("late stays counted"): when the task was sent to the Recycle Bin or merged into another
   * (its deletedAt / mergedAt), and which. Such a task is read only to keep a late mark it already had.
   */
  removedAt?: Date | null;
  removedHow?: 'binned' | 'merged';
}

/** Who may agree a new due date: administrators, and the people who run the task's project. */
export interface BaselineRules {
  isAdmin(userId: string): boolean;
  runsProject(userId: string): boolean;
}

const ms = (d: Date) => d.getTime();

/** Done now: in a Done column or completed (the shared rule). */
export function isDoneNow(t: Pick<KpiTask, 'columnCategory' | 'completedAt'>): boolean {
  return t.columnCategory === 'DONE' || t.completedAt !== null;
}

/** When it was completed (its completion time, else its last move into Done, else its last change); null unless done now. */
export function completedMoment(t: KpiTask): Date | null {
  if (!isDoneNow(t)) return null;
  if (t.completedAt) return t.completedAt;
  // A Done column without a completion time (older rows): its last move into Done, else its last change.
  const last = [...t.events].reverse().find((e) => e.action === 'COMPLETED' || e.action === 'MOVED' || e.action === 'APPROVED');
  return last?.at ?? t.updatedAt;
}

/**
 * When the task counted as done for the people doing it: its hand-in for approval (the last one that
 * led to its completion, or the one it is waiting on), else when it was completed. Null while open.
 */
export function doneMoment(t: KpiTask): Date | null {
  const completed = completedMoment(t);
  if (!completed) return t.approvalRequestedAt;
  let handIn: Date | null = null;
  for (const e of t.events) {
    if (ms(e.at) > ms(completed)) break;
    if (e.action === 'APPROVAL_REQUESTED') handIn = e.at;
    else if (e.action === 'SENT_BACK' || e.action === 'APPROVAL_WITHDRAWN' || e.action === 'REOPENED') handIn = null;
  }
  return handIn ?? completed;
}

type Interval = { start: number; end: number | null };

const who = (e: HistoryEvent) => {
  const id = (e.meta as { assigneeId?: unknown } | null)?.assigneeId;
  return typeof id === 'string' ? id : null;
};

/**
 * Was this taking-off a release (review I2)? Stamped when it happened (`released`); for older lines:
 * only whoever runs the project or an administrator taking someone ELSE off releases them — someone
 * taking themselves off, or a colleague taking them off, leaves them answerable for the task.
 */
function releases(e: HistoryEvent, rules: BaselineRules): boolean {
  const stamped = (e.meta as { released?: unknown } | null)?.released;
  if (typeof stamped === 'boolean') return stamped;
  return who(e) !== e.userId && (rules.isAdmin(e.userId) || rules.runsProject(e.userId));
}

/** Spells from the history; `sticky`: a taking-off that isn't a release keeps the spell open. */
function buildIntervals(t: KpiTask, sticky: ((e: HistoryEvent) => boolean) | null): Map<string, Interval[]> {
  const out = new Map<string, Interval[]>();
  const open = new Map<string, number>();
  const held = new Set<string>();
  const push = (userId: string, iv: Interval) => out.set(userId, [...(out.get(userId) ?? []), iv]);
  for (const e of t.events) {
    if (e.action !== 'ASSIGNED' && e.action !== 'UNASSIGNED') continue;
    const userId = who(e);
    if (!userId) continue;
    if (e.action === 'ASSIGNED') {
      if (!open.has(userId)) open.set(userId, ms(e.at));
    } else if (sticky && sticky(e)) {
      // Still answerable: the spell stays open (from its start, else the task's creation).
      if (!open.has(userId)) open.set(userId, ms(t.createdAt));
      held.add(userId);
    } else {
      push(userId, { start: open.get(userId) ?? ms(t.createdAt), end: ms(e.at) });
      open.delete(userId);
      held.delete(userId);
    }
  }
  const current = new Map(t.assignees.map((a) => [a.userId, ms(a.assignedAt)]));
  for (const [userId, start] of open) {
    // On it now: from the recorded assignment (or its row's time, if earlier). Held by a non-release: open.
    // Taken off without a line: until its last change.
    if (current.has(userId)) push(userId, { start: Math.min(start, current.get(userId)!), end: null });
    else if (held.has(userId)) push(userId, { start, end: null });
    else push(userId, { start, end: ms(t.updatedAt) });
  }
  for (const [userId, assignedAtMs] of current) if (!open.has(userId)) push(userId, { start: assignedAtMs, end: null });
  return out;
}

/** Worked out once per task (a snapshot rebuild asks about the same task for every slice). */
const intervalCache = new WeakMap<KpiTask, Map<string, Interval[]>>();
const responsibleCache = new WeakMap<KpiTask, WeakMap<BaselineRules, Map<string, Interval[]>>>();

/** Each person's spells on the task (start inclusive, end exclusive; null: still on it). */
export function assignmentIntervals(t: KpiTask): Map<string, Interval[]> {
  let hit = intervalCache.get(t);
  if (!hit) intervalCache.set(t, (hit = buildIntervals(t, null)));
  return hit;
}

/** Each person's spells of being answerable for the task: as assigned, but taking yourself off (or a colleague taking you off) doesn't end it. */
export function responsibilityIntervals(t: KpiTask, rules: BaselineRules): Map<string, Interval[]> {
  let byRules = responsibleCache.get(t);
  if (!byRules) responsibleCache.set(t, (byRules = new WeakMap()));
  let hit = byRules.get(rules);
  if (!hit) byRules.set(rules, (hit = buildIntervals(t, (e) => !releases(e, rules))));
  return hit;
}

const onAt = (ivs: Map<string, Interval[]>, x: number) => [...ivs].filter(([, list]) => list.some((iv) => iv.start <= x && (iv.end === null || x < iv.end))).map(([u]) => u);
const onDuring = (ivs: Map<string, Interval[]>, a: number, b: number) => [...ivs].filter(([, list]) => list.some((iv) => iv.start <= b && (iv.end === null || iv.end > a))).map(([u]) => u);

/** The people on the task at an instant. */
export function assignedAt(t: KpiTask, instant: Date): string[] {
  return onAt(assignmentIntervals(t), ms(instant));
}

/** The people on the task at any moment from `from` to `to` (both included). */
export function assignedDuring(t: KpiTask, from: Date, to: Date): string[] {
  return onDuring(assignmentIntervals(t), ms(from), ms(to));
}

/** The people answerable for the task at an instant (overdue counts for them). */
export function responsibleAt(t: KpiTask, instant: Date, rules: BaselineRules): string[] {
  return onAt(responsibilityIntervals(t, rules), ms(instant));
}

/** The first moment anyone was put on the task (null: never). */
function firstAssigned(t: KpiTask): number | null {
  let first: number | null = null;
  for (const ivs of assignmentIntervals(t).values()) for (const iv of ivs) if (first === null || iv.start < first) first = iv.start;
  return first;
}

/** Was this person ever on the task up to an instant? */
function everOn(t: KpiTask, userId: string, instant: Date): boolean {
  return (assignmentIntervals(t).get(userId) ?? []).some((iv) => iv.start <= ms(instant));
}

export interface DueChange {
  at: Date;
  by: string;
  from: string | null;
  to: string | null;
  /** Stamped when it was made: an agreed change (an extension) or not; absent on older lines. */
  agreed?: boolean;
  /** A date the system filled in (a move to a project whose tasks are due today), not someone's commitment. */
  auto?: boolean;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The task's recorded due-date changes, oldest first. */
export function dueChanges(t: KpiTask): DueChange[] {
  const out: DueChange[] = [];
  for (const e of t.events) {
    if (e.action !== 'UPDATED') continue;
    const changes = (e.meta as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;
    const c = changes.find((x) => (x as { field?: unknown } | null)?.field === 'dueDate') as { from?: unknown; to?: unknown; agreed?: unknown; auto?: unknown } | undefined;
    if (!c) continue;
    const day = (v: unknown) => (typeof v === 'string' && DAY_KEY.test(v) ? v : null);
    out.push({ at: e.at, by: e.userId, from: day(c.from), to: day(c.to), ...(typeof c.agreed === 'boolean' ? { agreed: c.agreed } : {}), ...(c.auto === true ? { auto: true } : {}) });
  }
  return out;
}

/**
 * Is this due-date change an agreed one (re-baselines)? As stamped when it was made (review I1); for
 * older lines: an administrator's, or one by whoever runs the project who has never been on the task.
 */
export function agreedChange(t: KpiTask, c: DueChange, rules: BaselineRules): boolean {
  if (c.agreed !== undefined) return c.agreed;
  return rules.isAdmin(c.by) || (rules.runsProject(c.by) && !everOn(t, c.by, c.at));
}

/** The agreed due day ('YYYY-MM-DD', company time) as of an instant; null when none was agreed by then. */
export function baselineAsOf(t: KpiTask, instant: Date, rules: BaselineRules, timeZone: string): string | null {
  const changes = dueChanges(t);
  if (changes.length === 0) return dueDayKey(t.dueDate, timeZone);
  const assignedFrom = firstAssigned(t);
  let baseline = changes[0]!.from;
  // A date filled in when the task was made ("new tasks due today") is no one's commitment (review I6).
  let provisional = t.events.some((e) => e.action === 'CREATED' && (e.meta as { autoDue?: unknown } | null)?.autoDue === true);
  for (const c of changes) {
    if (ms(c.at) > ms(instant)) break;
    if (c.auto) {
      baseline = c.to;
      provisional = true;
      continue;
    }
    if (assignedFrom === null || ms(c.at) < assignedFrom || baseline === null || provisional) {
      // Planning before anyone was on it, the first date anyone committed to, or the first set after an automatic one.
      baseline = c.to;
      provisional = false;
      continue;
    }
    if (agreedChange(t, c, rules)) baseline = c.to;
  }
  return baseline;
}

/**
 * Who an on-time or late finish counts for (call 2): everyone answerable for the task at any moment of
 * its agreed due day (up to its finish) — so a late task can't be escaped by handing it on or taking
 * yourself off; a task finished before its due day counts for whoever was on it when it was finished.
 */
export function judgedPeople(t: KpiTask, baselineDay: string, doneAt: Date, timeZone: string, rules: BaselineRules): string[] {
  const dayStart = zonedStartOfDay(baselineDay, timeZone);
  if (ms(doneAt) < ms(dayStart)) return assignedAt(t, doneAt);
  const dayEnd = new Date(ms(zonedStartOfDay(shiftDayKey(baselineDay, 1), timeZone)) - 1);
  return onDuring(responsibilityIntervals(t, rules), ms(dayStart), Math.min(ms(doneAt), ms(dayEnd)));
}

export interface ApprovalCycle {
  requestedAt: Date;
  decidedAt: Date;
  /** The approver who approved it or sent it back. */
  decidedBy: string;
  outcome: 'APPROVED' | 'SENT_BACK';
}

/** Each hand-in for approval that was decided (approved or sent back); withdrawn and waiting ones left out. */
export function approvalCycles(t: KpiTask): ApprovalCycle[] {
  const out: ApprovalCycle[] = [];
  let asked: Date | null = null;
  for (const e of t.events) {
    if (e.action === 'APPROVAL_REQUESTED') asked = e.at;
    else if (asked && (e.action === 'APPROVED' || (e.action === 'COMPLETED' && (e.meta as { approved?: unknown } | null)?.approved === true))) {
      out.push({ requestedAt: asked, decidedAt: e.at, decidedBy: e.userId, outcome: 'APPROVED' });
      asked = null;
    } else if (asked && e.action === 'SENT_BACK') {
      out.push({ requestedAt: asked, decidedAt: e.at, decidedBy: e.userId, outcome: 'SENT_BACK' });
      asked = null;
    } else if (e.action === 'APPROVAL_WITHDRAWN' || e.action === 'REOPENED') asked = null;
  }
  return out;
}

/** The task's day in company time of an instant (helper for callers). */
export const dayOf = (instant: Date, timeZone: string) => zonedDayKey(instant, timeZone);
