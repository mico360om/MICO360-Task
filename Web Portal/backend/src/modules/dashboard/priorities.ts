import { dueDayKey } from '../../lib/due-date';

/**
 * 1.23.4 Smarter Dashboard — "My Priorities Today": why a row is there and in what order (pure).
 *
 * The sources (priority-sources.ts) gather the facts — the person's own open tasks, the approvals waiting
 * for them, their meeting action items (and, from 1.23.3, checklist items), and for the people who run
 * projects the tasks there that need them — and this decides each row's reasons, its strongest one, the
 * filter chips it counts under, and the order: most urgent first (design §Order).
 */

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
const PRIORITY_RANK: Record<Priority, number> = { URGENT: 3, HIGH: 2, NORMAL: 1, LOW: 0 };

/** Why a row is on the list. Days are whole company-calendar days. */
export type Reason =
  | { code: 'overdue'; days: number }
  | { code: 'approval'; since: string | null }
  | { code: 'blocking'; count: number }
  | { code: 'due-today' }
  | { code: 'urgent' }
  | { code: 'team-overdue'; days: number }
  | { code: 'team-blocked' }
  | { code: 'unassigned' }
  | { code: 'blocked-status' }
  | { code: 'blocked-by'; blockers: { id: string; key: string }[] }
  | { code: 'due-soon'; days: number };
export type ReasonCode = Reason['code'];

/**
 * The order of the groups (design §Order): 1 overdue · 2 waiting for your approval · 3 blocks others ·
 * 4 due today · 5 urgent · 6 managers: overdue 3+ days or blocked in your projects · 7 managers: no one
 * assigned · 8 blocked (a Blocked column, or waiting on another task) · 9 due in the next 3 days.
 */
export const REASON_GROUP: Readonly<Record<ReasonCode, number>> = {
  overdue: 1,
  approval: 2,
  blocking: 3,
  'due-today': 4,
  urgent: 5,
  'team-overdue': 6,
  'team-blocked': 6,
  unassigned: 7,
  'blocked-status': 8,
  'blocked-by': 8,
  'due-soon': 9,
};

/** The filter chips above the list (All is every row). */
export const CHIPS = ['overdue', 'today', 'approvals', 'blocked', 'upcoming', 'team'] as const;
export type Chip = (typeof CHIPS)[number];
const CHIP_OF: Readonly<Record<ReasonCode, Chip | null>> = {
  overdue: 'overdue',
  'team-overdue': 'overdue',
  approval: 'approvals',
  blocking: null,
  'due-today': 'today',
  urgent: null,
  'team-blocked': 'blocked',
  unassigned: 'team',
  'blocked-status': 'blocked',
  'blocked-by': 'blocked',
  'due-soon': 'upcoming',
};
const TEAM_CODES: ReadonlySet<ReasonCode> = new Set(['team-overdue', 'team-blocked', 'unassigned']);

/** How far ahead "Upcoming" looks, and how late another person's task must be before it escalates (escalation.ts). */
export const UPCOMING_DAYS = 3;
export const TEAM_OVERDUE_DAYS = 3;

interface Base {
  id: string;
  /** The task's number (RIG-4); null for an action item. */
  key: string | null;
  priority: Priority;
  dueDate: Date | null;
  createdAt: Date;
}

/** An open task (not done, not waiting for approval) the person may open. */
export interface TaskCandidate extends Base {
  kind: 'task';
  key: string;
  /** Its column's stage (BLOCKED is the board's Blocked flag). */
  columnCategory: string | null;
  assigneeIds: string[];
  /** Assigned to the person: judged as their own. */
  mine: boolean;
  /** In a project the person runs (administrators: their list scope): judged as a team row when not theirs. */
  team: boolean;
  /** Its open blockers the person may open (a hidden blocker counts for nothing, as on the task panel). */
  blockers: { id: string; key: string }[];
  /** How many open tasks the person may open wait on it. */
  dependents: number;
}

/** A task waiting for the person's approval (the To approve list). */
export interface ApprovalCandidate extends Base {
  kind: 'approval';
  requestedAt: Date | null;
}

/** A meeting action item assigned to the person, or (1.23.3) a checklist item: only its date counts. */
export interface DatedCandidate extends Base {
  kind: 'action-item' | 'checklist-item';
}

export type Candidate = TaskCandidate | ApprovalCandidate | DatedCandidate;

export interface RankContext {
  /** Today, 'YYYY-MM-DD' in the company time zone. */
  today: string;
  timeZone: string;
}

export interface Ranked<C extends Candidate = Candidate> {
  candidate: C;
  /** The strongest reason (its group places the row). */
  reason: Reason;
  /** The other reasons, strongest first (small tags beside the first). */
  also: Reason[];
  group: number;
  /** The chips the row counts under, in chip order. */
  chips: Chip[];
}

/** Whole days from today to the due day (negative: late), or null without a date. */
function daysUntil(due: Date | null, ctx: RankContext): number | null {
  const key = dueDayKey(due, ctx.timeZone);
  if (!key) return null;
  return Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${ctx.today}T12:00:00Z`)) / 86_400_000);
}

/** The date reasons an item of the person's own has: overdue, due today, due in the next 3 days. */
function dateReasons(days: number | null): Reason[] {
  if (days === null) return [];
  if (days < 0) return [{ code: 'overdue', days: -days }];
  if (days === 0) return [{ code: 'due-today' }];
  if (days <= UPCOMING_DAYS) return [{ code: 'due-soon', days }];
  return [];
}

const byGroup = (a: Reason, b: Reason) => REASON_GROUP[a.code] - REASON_GROUP[b.code];

/** Every reason the row has, strongest first (none: it isn't on the list). */
export function reasonsOf(c: Candidate, ctx: RankContext): Reason[] {
  const days = daysUntil(c.dueDate, ctx);
  const out: Reason[] = [];
  if (c.kind === 'approval') {
    out.push({ code: 'approval', since: c.requestedAt ? c.requestedAt.toISOString() : null });
  } else if (c.kind === 'task' && c.mine) {
    out.push(...dateReasons(days));
    if (c.priority === 'URGENT') out.push({ code: 'urgent' });
    if (c.dependents > 0) out.push({ code: 'blocking', count: c.dependents });
    if (c.columnCategory === 'BLOCKED') out.push({ code: 'blocked-status' });
    if (c.blockers.length > 0) out.push({ code: 'blocked-by', blockers: c.blockers });
  } else if (c.kind === 'task') {
    // Someone else's (or no one's) task, only in a project the person runs: the escalation rule in full
    // (a Blocked column, or 3+ days late), and no one assigned.
    if (!c.team) return [];
    if (days !== null && -days >= TEAM_OVERDUE_DAYS) out.push({ code: 'team-overdue', days: -days });
    if (c.columnCategory === 'BLOCKED') out.push({ code: 'team-blocked' });
    if (c.assigneeIds.length === 0) out.push({ code: 'unassigned' });
  } else {
    out.push(...dateReasons(days));
  }
  return out.sort(byGroup);
}

const prio = (c: Candidate) => PRIORITY_RANK[c.priority] ?? 0;
const dueTime = (c: Candidate) => (c.dueDate ? c.dueDate.getTime() : Number.POSITIVE_INFINITY);
const reasonNumber = (r: Reason): number => (r.code === 'overdue' || r.code === 'team-overdue' ? r.days : r.code === 'blocking' ? r.count : 0);

/**
 * Most urgent first: by group, then the group's own measure, then priority, the earlier due date, the oldest.
 * 1.23.5: the project page's Next actions sort with it too.
 */
export function compare(a: Ranked, b: Ranked): number {
  if (a.group !== b.group) return a.group - b.group;
  if (a.reason.code === 'approval' && b.reason.code === 'approval') {
    const at = (r: Ranked) => (r.reason.code === 'approval' && r.reason.since ? Date.parse(r.reason.since) : Number.POSITIVE_INFINITY);
    const d = at(a) - at(b);
    if (d !== 0) return d;
  }
  // Overdue: most days late first; Blocks others: most blocked first.
  const measure = reasonNumber(b.reason) - reasonNumber(a.reason);
  if (measure !== 0) return measure;
  return (
    prio(b.candidate) - prio(a.candidate) ||
    dueTime(a.candidate) - dueTime(b.candidate) ||
    a.candidate.createdAt.getTime() - b.candidate.createdAt.getTime() ||
    (a.candidate.key ?? '').localeCompare(b.candidate.key ?? '', 'en', { numeric: true }) ||
    a.candidate.id.localeCompare(b.candidate.id, 'en')
  );
}

/** The chips a row counts under (in chip order), from all its reasons. */
function chipsOf(reasons: Reason[]): Chip[] {
  const set = new Set<Chip>();
  for (const r of reasons) {
    const chip = CHIP_OF[r.code];
    if (chip) set.add(chip);
    if (TEAM_CODES.has(r.code)) set.add('team');
  }
  return CHIPS.filter((c) => set.has(c));
}

/** The rows with a reason, each once with its strongest reason, most urgent first. */
export function rankPriorities<C extends Candidate>(candidates: C[], ctx: RankContext): Ranked<C>[] {
  const ranked: Ranked<C>[] = [];
  for (const candidate of candidates) {
    const reasons = reasonsOf(candidate, ctx);
    if (reasons.length === 0) continue;
    const [reason, ...also] = reasons as [Reason, ...Reason[]];
    ranked.push({ candidate, reason, also, group: REASON_GROUP[reason.code], chips: chipsOf(reasons) });
  }
  return ranked.sort(compare as (a: Ranked<C>, b: Ranked<C>) => number);
}

/** How many rows each chip shows (All: every row). */
export function chipCounts(ranked: readonly Ranked[]): Record<'all' | Chip, number> {
  const counts = { all: ranked.length, overdue: 0, today: 0, approvals: 0, blocked: 0, upcoming: 0, team: 0 };
  for (const r of ranked) for (const c of r.chips) counts[c] += 1;
  return counts;
}
