import { isValidRule, nextDueDate, scheduledOccurrence, withAnchorDay, type RecurrenceRule } from './recurrence';
import { boardDateKey } from './board-date';
import { defaultCompanyTimeZone } from './task-status';

export interface RecurringTask {
  id: string;
  dueDate: Date | null;
  /** Dates an on-schedule series that has no due date. */
  startDate?: Date | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string | null;
  /** #14 repair: its version when the sweep read it (a change since, e.g. Pause, and no copy is made this time). */
  version?: number;
}

export interface SpawnedTask {
  id: string;
  projectId?: string;
}

export interface SpawnOptions {
  /** #14 repair: make it only if the source is still done (and not in the Recycle Bin) when it is held. */
  onlyIfDone?: boolean;
  /** #14 repair: …and only if its version is still this one (nobody changed it, or its repeat, since it was read). */
  version?: number;
}

export interface RecurrenceTaskPort {
  /**
   * Create the next task in a recurring series, dated `nextDueDate`, carrying `rule` (the source's
   * rule with its anchor day pinned); returns the new task id and project. Each task gets at most
   * one next copy: null when `sourceTaskId` already has one (a repeat or concurrent call).
   */
  spawnNext(sourceTaskId: string, nextDueDate: Date, rule: RecurrenceRule, opts?: SpawnOptions): Promise<SpawnedTask | null>;
  /**
   * Review fix #14: on-completion series whose next copy was never made — finished tasks (in a Done
   * column, completed at `since` or later) of live projects that still carry their rule and have no copy
   * at all: none in the Recycle Bin, archived, merged or moved to another project. Absent: no repairs.
   */
  listMissedCopies?(since: Date): Promise<RecurringTask[]>;
  /** How many tasks already exist in the series identified by `parentId`. */
  countInstances(parentId: string): Promise<number>;
  /** The live tasks that carry a recurrence rule — the newest copy of each series. */
  listSeriesHeads(): Promise<RecurringTask[]>;
}

/**
 * Review fix #14 (ruling): how far back the hourly sweep looks for a finished task whose next copy was
 * never made. Two weeks: a failure is repaired within the hour, and a series broken longer ago (or long
 * forgotten) is never brought back on its own.
 */
export const REPAIR_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RepairedCopy {
  /** The finished task whose next copy was missing. */
  headId: string;
  copy: SpawnedTask;
}

export interface RecurrenceServiceDeps {
  tasks: RecurrenceTaskPort;
  now?: () => Date;
  /** Company time zone: "today" for skipping past dates and for on-schedule copies. */
  timeZone?: string;
  /** Told about a series the schedule sweep couldn't advance (it is retried on the next run). */
  onError?: (err: unknown, taskId: string) => void;
}

export function createRecurrenceService({ tasks, now = () => new Date(), timeZone = defaultCompanyTimeZone(), onError }: RecurrenceServiceDeps) {
  const todayKey = () => boardDateKey(now(), timeZone);
  /** A calendar day as a stored due date (UTC midnight). */
  const dayStart = (key: string) => new Date(`${key}T00:00:00.000Z`);

  /** The series' rule, if it may produce copies at all (valid and not paused). */
  function activeRule(task: RecurringTask): RecurrenceRule | null {
    const raw = task.recurrenceRule;
    if (!raw || !isValidRule(raw) || raw.paused) return null;
    return raw;
  }

  async function seriesFull(task: RecurringTask, rule: RecurrenceRule): Promise<boolean> {
    if (rule.count == null) return false;
    return (await tasks.countInstances(task.recurrenceParentId ?? task.id)) >= rule.count;
  }

  /**
   * Where the series continues from: the day a copy moved on its own replaced ("this occurrence
   * only"), else the copy's own due date.
   */
  const baseOf = (task: RecurringTask, rule: RecurrenceRule, fallback: Date | null): Date | null =>
    rule.resumeFrom ? dayStart(rule.resumeFrom) : (task.dueDate ?? fallback);

  /** The rule the next copy carries: a moved copy's note stays with that copy. */
  function forNextCopy(rule: RecurrenceRule): RecurrenceRule {
    const next = { ...rule };
    delete next.resumeFrom;
    return next;
  }

  /** Make the copy that follows `task`: the next date that isn't already past. */
  async function spawnFollowing(task: RecurringTask, raw: RecurrenceRule, opts?: SpawnOptions): Promise<SpawnedTask | null> {
    const today = todayKey();
    const base = baseOf(task, raw, dayStart(today))!;
    const rule = withAnchorDay(raw, base);
    const next = nextDueDate(base, rule, today);
    if (!next) return null; // the series has ended (until)
    if (await seriesFull(task, rule)) return null;
    return opts ? tasks.spawnNext(task.id, next, forNextCopy(rule), opts) : tasks.spawnNext(task.id, next, forNextCopy(rule));
  }

  /**
   * Called when a task is completed. If it recurs (and makes its next copy on completion) and the
   * series hasn't ended, create the next copy and return it.
   */
  async function onTaskCompleted(task: RecurringTask): Promise<SpawnedTask | null> {
    const rule = activeRule(task);
    // An on-schedule series makes its copies on their dates, done or not (runSchedule).
    if (!rule || rule.createNext === 'ON_SCHEDULE') return null;
    return spawnFollowing(task, rule);
  }

  /**
   * Called before the newest copy of a series is deleted on its own ("just this occurrence"): the
   * series carries on with the next copy instead of ending with it.
   */
  async function onTaskSkipped(task: RecurringTask): Promise<SpawnedTask | null> {
    const rule = activeRule(task);
    return rule ? spawnFollowing(task, rule) : null;
  }

  /**
   * On-schedule series: make each copy that is due by today — one per series, for the latest date
   * when days were missed. Safe to re-run: a task never gets a second next copy.
   */
  async function runSchedule(): Promise<SpawnedTask[]> {
    const today = todayKey();
    const made: SpawnedTask[] = [];
    for (const head of await tasks.listSeriesHeads()) {
      const raw = activeRule(head);
      if (!raw || raw.createNext !== 'ON_SCHEDULE') continue;
      try {
        const base = baseOf(head, raw, head.startDate ? dayStart(boardDateKey(head.startDate, timeZone)) : null);
        if (!base) continue;
        const rule = withAnchorDay(raw, base);
        const owed = scheduledOccurrence(base, rule, today);
        if (!owed || (await seriesFull(head, rule))) continue;
        const next = await tasks.spawnNext(head.id, owed, forNextCopy(rule));
        if (next) made.push(next);
      } catch (err) {
        // One broken series must not stop the others; the next sweep retries it.
        onError?.(err, head.id);
      }
    }
    return made;
  }

  /**
   * Review fix #14: an on-completion series whose next copy failed at completion (the move was saved, the
   * copy wasn't — a retry changes nothing, the column being the same) gets it here, as completing it would
   * have made it: the next date that isn't past. Strictly: only finished in the last REPAIR_WINDOW_DAYS,
   * only with no copy anywhere (the port; and the database's unique source guard), only while the rule
   * still runs (not paused, not past its end date or count), and only if the task is still done when held.
   */
  async function repairMissedCopies(): Promise<RepairedCopy[]> {
    if (!tasks.listMissedCopies) return [];
    const made: RepairedCopy[] = [];
    for (const head of await tasks.listMissedCopies(new Date(now().getTime() - REPAIR_WINDOW_DAYS * DAY_MS))) {
      const raw = activeRule(head);
      // Switched off, or an on-schedule series (the schedule makes its copies): nothing to repair.
      if (!raw || raw.createNext === 'ON_SCHEDULE') continue;
      try {
        const copy = await spawnFollowing(head, raw, { onlyIfDone: true, ...(head.version !== undefined ? { version: head.version } : {}) });
        if (copy) made.push({ headId: head.id, copy });
      } catch (err) {
        // One broken series must not stop the others; the next sweep tries it again.
        onError?.(err, head.id);
      }
    }
    return made;
  }

  return { onTaskCompleted, onTaskSkipped, runSchedule, repairMissedCopies };
}

export type RecurrenceService = ReturnType<typeof createRecurrenceService>;
