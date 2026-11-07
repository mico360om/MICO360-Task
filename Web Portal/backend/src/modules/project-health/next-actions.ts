/**
 * 1.23.5 Project overview & health — "Next actions": the project's next things to do, pure.
 *
 * Its open tasks (not waiting for approval) that are overdue, due today or within 7 days, blocked (a
 * Blocked column, or waiting on a blocker once that is a real hold-up — design call 2: a planned sequence is
 * not a thing to do yet), or have a date and no one assigned; and (1.23.3) overdue or due-soon checklist
 * items. Each row with its strongest reason and the others as tags, in the 1.23.4 priorities order
 * (dashboard/priorities.ts: overdue · blocks others · due today · urgent · no one assigned · blocked · due
 * soon; within a group the same measure, priority, date and age).
 */
import { dueDayKey } from '../../lib/due-date';
import { compare, REASON_GROUP, type Priority, type Ranked, type Reason } from '../dashboard/priorities';

/** The Overview tab shows the first seven ("Show all" for the rest). */
export const NEXT_ACTIONS_SHOWN = 7;
/** "Due within 7 days". */
export const NEXT_SOON_DAYS = 7;

interface Base {
  id: string;
  key: string | null;
  priority: Priority;
  dueDate: Date | null;
  createdAt: Date;
}

export interface TaskActionCandidate extends Base {
  kind: 'task';
  key: string;
  columnCategory: string | null;
  assigneeIds: string[];
  /** Waiting on an open blocker of the project, and that is a real hold-up (call 2). */
  heldByBlockers: boolean;
  /** Its open blockers (same project). */
  blockers: { id: string; key: string }[];
  /** How many open tasks of the project wait on it. */
  dependents: number;
}

/** 1.23.3: an assigned checklist item (a leaf) — only its date counts. */
export interface ItemActionCandidate extends Base {
  kind: 'checklist-item';
}

export type ActionCandidate = TaskActionCandidate | ItemActionCandidate;

const daysUntil = (due: Date | null, ctx: { today: string; timeZone: string }) => {
  const key = dueDayKey(due, ctx.timeZone);
  return key ? Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${ctx.today}T12:00:00Z`)) / 86_400_000) : null;
};

/** What puts a row on the list (the rest — urgent, blocks others — are only tags). */
const INCLUDING = new Set<Reason['code']>(['overdue', 'due-today', 'due-soon', 'unassigned', 'blocked-status', 'blocked-by']);

/** Every reason the row has, strongest first (none that includes it: it isn't a next action). */
export function nextActionReasons(c: ActionCandidate, ctx: { today: string; timeZone: string }): Reason[] {
  const days = daysUntil(c.dueDate, ctx);
  const out: Reason[] = [];
  if (days !== null) {
    if (days < 0) out.push({ code: 'overdue', days: -days });
    else if (days === 0) out.push({ code: 'due-today' });
    else if (days <= NEXT_SOON_DAYS) out.push({ code: 'due-soon', days });
  }
  if (c.kind === 'task') {
    if (c.priority === 'URGENT') out.push({ code: 'urgent' });
    if (c.dependents > 0) out.push({ code: 'blocking', count: c.dependents });
    if (c.assigneeIds.length === 0 && days !== null) out.push({ code: 'unassigned' });
    if (c.columnCategory === 'BLOCKED') out.push({ code: 'blocked-status' });
    if (c.heldByBlockers && c.blockers.length > 0) out.push({ code: 'blocked-by', blockers: c.blockers });
  }
  if (!out.some((r) => INCLUDING.has(r.code))) return [];
  return out.sort((a, b) => REASON_GROUP[a.code] - REASON_GROUP[b.code]);
}

export interface RankedAction<C extends ActionCandidate = ActionCandidate> {
  candidate: C;
  /** The strongest reason (its group places the row). */
  reason: Reason;
  /** The other reasons, strongest first. */
  also: Reason[];
  group: number;
}

/** The project's next actions, most urgent first (the 1.23.4 comparator reads only the fields both kinds share). */
export function rankNextActions<C extends ActionCandidate>(candidates: C[], ctx: { today: string; timeZone: string }): RankedAction<C>[] {
  const ranked: RankedAction<C>[] = [];
  for (const candidate of candidates) {
    const reasons = nextActionReasons(candidate, ctx);
    if (reasons.length === 0) continue;
    const [reason, ...also] = reasons as [Reason, ...Reason[]];
    ranked.push({ candidate, reason, also, group: REASON_GROUP[reason.code] });
  }
  const asRanked = (r: RankedAction<C>) => ({ ...r, chips: [] }) as unknown as Ranked;
  return ranked.sort((a, b) => compare(asRanked(a), asRanked(b)));
}
