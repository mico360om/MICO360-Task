import { dueDayKey } from '../../lib/due-date';
import { recurrenceSummary } from './recurrence-summary';
import type { TaskRecord } from './task-repository';

/** One field an edit changed, as the activity timeline shows it ("changed priority Normal → High"). */
export type TaskChange =
  | { field: 'title' | 'priority' | 'dueDate' | 'repeat' | 'inspectionForm' | 'inspectionPlace'; from: string | null; to: string | null }
  /** The text itself is left out: it can be long, and the task shows the current one. */
  | { field: 'description' };

/**
 * What an edit changed in the fields people care about. Moves (column) and progress are left out —
 * moves have their own timeline entry. Due dates are compared as calendar days in the company zone.
 */
export function taskChanges(before: TaskRecord, after: TaskRecord, timeZone: string): TaskChange[] {
  const changes: TaskChange[] = [];
  if (before.title !== after.title) changes.push({ field: 'title', from: before.title, to: after.title });
  if ((before.description ?? '') !== (after.description ?? '')) changes.push({ field: 'description' });
  if (before.priority !== after.priority) changes.push({ field: 'priority', from: before.priority, to: after.priority });
  const dueBefore = dueDayKey(before.dueDate, timeZone);
  const dueAfter = dueDayKey(after.dueDate, timeZone);
  if (dueBefore !== dueAfter) changes.push({ field: 'dueDate', from: dueBefore, to: dueAfter });
  const repeatBefore = before.recurrenceRule ? recurrenceSummary(before.recurrenceRule) : null;
  const repeatAfter = after.recurrenceRule ? recurrenceSummary(after.recurrenceRule) : null;
  if (repeatBefore !== repeatAfter) changes.push({ field: 'repeat', from: repeatBefore, to: repeatAfter });
  // A scheduled check: the form it is carried out with (by id) and where.
  if ((before.inspectionFormId ?? null) !== (after.inspectionFormId ?? null)) changes.push({ field: 'inspectionForm', from: before.inspectionFormId ?? null, to: after.inspectionFormId ?? null });
  if ((before.inspectionPlace ?? null) !== (after.inspectionPlace ?? null)) changes.push({ field: 'inspectionPlace', from: before.inspectionPlace ?? null, to: after.inspectionPlace ?? null });
  return changes;
}

/** What an edit's UPDATED timeline line holds (its changes), or null when nothing worth a line changed. */
export function updateActivity(before: TaskRecord, after: TaskRecord, timeZone: string): { changes: TaskChange[] } | null {
  const changes = taskChanges(before, after, timeZone);
  return changes.length ? { changes } : null;
}
