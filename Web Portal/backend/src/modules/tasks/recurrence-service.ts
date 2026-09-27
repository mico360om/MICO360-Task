import { isValidRule, nextOccurrence, withAnchorDay, type RecurrenceRule } from './recurrence';

export interface RecurringTask {
  id: string;
  dueDate: Date | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceParentId: string | null;
}

export interface RecurrenceTaskPort {
  /**
   * Create the next task in a recurring series, dated `nextDueDate`, carrying `rule` (the source's
   * rule with its anchor day pinned); returns the new task id and project.
   */
  spawnNext(sourceTaskId: string, nextDueDate: Date, rule: RecurrenceRule): Promise<{ id: string; projectId?: string }>;
  /** How many tasks already exist in the series identified by `parentId`. */
  countInstances(parentId: string): Promise<number>;
}

export function createRecurrenceService({ tasks }: { tasks: RecurrenceTaskPort }) {
  /**
   * Called when a task is completed. If the task recurs and the series is not
   * exhausted (count / until), create the next occurrence and return its id.
   */
  async function onTaskCompleted(task: RecurringTask): Promise<{ id: string; projectId?: string } | null> {
    const raw = task.recurrenceRule;
    if (!raw || !isValidRule(raw)) return null;
    // A paused series generates no new occurrences until it is resumed.
    if (raw.paused) return null;

    const base = task.dueDate ?? new Date();
    const rule = withAnchorDay(raw, base);
    const next = nextOccurrence(base, rule);

    if (rule.until != null && next.getTime() > new Date(rule.until).getTime()) return null;

    if (rule.count != null) {
      const parentId = task.recurrenceParentId ?? task.id;
      const soFar = await tasks.countInstances(parentId);
      if (soFar >= rule.count) return null;
    }

    return tasks.spawnNext(task.id, next, rule);
  }

  return { onTaskCompleted };
}

export type RecurrenceService = ReturnType<typeof createRecurrenceService>;
