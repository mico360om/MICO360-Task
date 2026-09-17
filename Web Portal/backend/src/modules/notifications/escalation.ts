const DAY_MS = 86_400_000;

/** A task considered for escalation (status comes from its column category). */
export interface EscalationTask {
  id: string;
  key: string;
  title: string;
  dueDate: Date | null;
  columnCategory: string | null;
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
}

/**
 * Decide which tasks warrant escalating to their project's owner/managers: any Blocked task, or a
 * task overdue by at least the threshold. "Blocked" wins when a task is both. Pure/deterministic.
 */
export function planEscalations(tasks: EscalationTask[], opts: PlanEscalationOptions = {}): EscalationPlan[] {
  const now = (opts.now ?? new Date()).getTime();
  const threshold = opts.overdueDays ?? 3;
  const plans: EscalationPlan[] = [];

  for (const t of tasks) {
    if (t.columnCategory === 'DONE') continue;
    if (t.columnCategory === 'BLOCKED') {
      plans.push({ taskId: t.id, projectId: t.projectId, key: t.key, title: t.title, reason: 'blocked', overdueDays: 0 });
      continue;
    }
    if (t.dueDate) {
      const daysOverdue = Math.floor((now - t.dueDate.getTime()) / DAY_MS);
      if (daysOverdue >= threshold) {
        plans.push({ taskId: t.id, projectId: t.projectId, key: t.key, title: t.title, reason: 'overdue', overdueDays: daysOverdue });
      }
    }
  }
  return plans;
}
