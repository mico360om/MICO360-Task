import { isTaskDone } from '../tasks/task-status';

/**
 * 1.23 Client sign-off: on a shared task in a Done column, a client may Accept it or Send it back. An
 * acceptance belongs to the finish it was given for: once the task is re-opened it no longer counts,
 * and if it is finished again later the old acceptance stays in history but isn't shown — derived
 * here, so no path that re-opens a task has to remember to clear it.
 */
export interface SignOffFacts {
  columnCategory?: string | null;
  completedAt: Date | null;
  approvalRequestedAt?: Date | null;
}

/** May a client sign this task off now? Done (and not waiting for a manager's approval). */
export function canSignOff(t: SignOffFacts): boolean {
  return isTaskDone(t) && !t.approvalRequestedAt;
}

/** The acceptance that applies to the task as it is now ("Client accepted · date"), else null. */
export function currentAcceptance(t: SignOffFacts & { clientAcceptedAt: Date | null }): Date | null {
  if (!t.clientAcceptedAt || !isTaskDone(t)) return null;
  if (t.completedAt && t.clientAcceptedAt.getTime() < t.completedAt.getTime()) return null;
  return t.clientAcceptedAt;
}
