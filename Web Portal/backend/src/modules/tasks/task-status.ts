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

/** A task is done when it sits in a DONE column or carries a completion time. */
export function isTaskDone(t: { columnCategory?: string | null; completedAt?: Date | string | null }): boolean {
  return t.columnCategory === 'DONE' || (t.completedAt !== null && t.completedAt !== undefined);
}
