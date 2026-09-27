import { daysUntilDue } from '../../lib/due-date';
import { defaultCompanyTimeZone, isTaskDone } from '../tasks/task-status';

/** A task considered for escalation (status comes from its column category). */
export interface EscalationTask {
  id: string;
  key: string;
  title: string;
  dueDate: Date | null;
  columnCategory: string | null;
  /** A completed task never escalates, whatever column it sits in. */
  completedAt?: Date | null;
  projectId: string;
}

export interface EscalationPlan {
  taskId: string;
  projectId: string;
  key: string;
  title: string;
  reason: 'overdue' | 'blocked';
  /** Whole days overdue (0 for a purely-blocked escalation). */
  overdueDays: number;
}

export interface PlanEscalationOptions {
  now?: Date;
  /** How many days a task must be overdue before it escalates (default 3). */
  overdueDays?: number;
  /** Company time zone: days overdue are counted in calendar days there (defaults to COMPANY_TIMEZONE). */
  timeZone?: string;
}

/**
 * Decide which tasks warrant escalating to their project's owner/managers: any Blocked task, or a
 * task overdue by at least the threshold (whole company-time calendar days past its due day).
 * "Blocked" wins when a task is both. Pure/deterministic.
 */
export function planEscalations(tasks: EscalationTask[], opts: PlanEscalationOptions = {}): EscalationPlan[] {
  const now = opts.now ?? new Date();
  const threshold = opts.overdueDays ?? 3;
  const timeZone = opts.timeZone ?? defaultCompanyTimeZone();
  const plans: EscalationPlan[] = [];

  for (const t of tasks) {
    if (isTaskDone(t)) continue;
    if (t.columnCategory === 'BLOCKED') {
      plans.push({ taskId: t.id, projectId: t.projectId, key: t.key, title: t.title, reason: 'blocked', overdueDays: 0 });
      continue;
    }
    const days = daysUntilDue(t.dueDate, timeZone, now);
    if (days !== null && -days >= threshold) {
      plans.push({ taskId: t.id, projectId: t.projectId, key: t.key, title: t.title, reason: 'overdue', overdueDays: -days });
    }
  }
  return plans;
}
