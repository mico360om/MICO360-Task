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
}

export interface SpawnedTask {
  id: string;
  projectId?: string;
}

export interface RecurrenceTaskPort {
  /**
   * Create the next task in a recurring series, dated `nextDueDate`, carrying `rule` (the source's
   * rule with its anchor day pinned); returns the new task id and project. Each task gets at most
   * one next copy: null when `sourceTaskId` already has one (a repeat or concurrent call).
   */
  spawnNext(sourceTaskId: string, nextDueDate: Date, rule: RecurrenceRule): Promise<SpawnedTask | null>;
  /** How many tasks already exist in the series identified by `parentId`. */
  countInstances(parentId: string): Promise<number>;
  /** The live tasks that carry a recurrence rule — the newest copy of each series. */
  listSeriesHeads(): Promise<RecurringTask[]>;
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

  /** Make the copy that follows `task`: the next date that isn't already past. */
  async function spawnFollowing(task: RecurringTask, raw: RecurrenceRule): Promise<SpawnedTask | null> {
    const today = todayKey();
    const base = task.dueDate ?? dayStart(today);
    const rule = withAnchorDay(raw, base);
    const next = nextDueDate(base, rule, today);
    if (!next) return null; // the series has ended (until)
    if (await seriesFull(task, rule)) return null;
    return tasks.spawnNext(task.id, next, rule);
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
        const base = head.dueDate ?? (head.startDate ? dayStart(boardDateKey(head.startDate, timeZone)) : null);
        if (!base) continue;
        const rule = withAnchorDay(raw, base);
        const owed = scheduledOccurrence(base, rule, today);
        if (!owed || (await seriesFull(head, rule))) continue;
        const next = await tasks.spawnNext(head.id, owed, rule);
        if (next) made.push(next);
      } catch (err) {
        // One broken series must not stop the others; the next sweep retries it.
        onError?.(err, head.id);
      }
    }
    return made;
  }

  return { onTaskCompleted, onTaskSkipped, runSchedule };
}

export type RecurrenceService = ReturnType<typeof createRecurrenceService>;
