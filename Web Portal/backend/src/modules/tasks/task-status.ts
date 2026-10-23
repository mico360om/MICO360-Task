/**
 * Shared task-status rules, so boards, filters, reminders and reports never disagree.
 */

/** Resolve the company time zone from COMPANY_TIMEZONE (validated), falling back to Asia/Muscat. */
export function defaultCompanyTimeZone(): string {
  const tz = process.env.COMPANY_TIMEZONE || 'Asia/Muscat';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Asia/Muscat';
  }
}

/**
 * What entering a column of `category` does to a task's completion — the same for a column move and a
 * move to another project. A DONE column completes it, once: an already-completed task keeps its
 * completion time (reordering or replaying a move must not rewrite history), and a newly completed one
 * stays on its completion day's board (completed tasks never carry forward). Leaving DONE re-opens it:
 * completing forced progress to 100%, so it goes back to what its checklist says (0% without one).
 */
export async function columnEntryChange(
  current: { id: string; completedAt: Date | null },
  category: string,
  opts: { at: Date; todayAnchor: Date; reopenedProgress?: (taskId: string) => Promise<number> },
): Promise<{ progress?: number; completedAt?: Date | null; boardDate?: Date }> {
  if (category === 'DONE') return current.completedAt ? { progress: 100 } : { progress: 100, completedAt: opts.at, boardDate: opts.todayAnchor };
  if (current.completedAt) return { completedAt: null, progress: opts.reopenedProgress ? await opts.reopenedProgress(current.id) : 0 };
  return {};
}

/** A task is done when it sits in a DONE column or carries a completion time. */
export function isTaskDone(t: { columnCategory?: string | null; completedAt?: Date | string | null }): boolean {
  return t.columnCategory === 'DONE' || (t.completedAt !== null && t.completedAt !== undefined);
}
