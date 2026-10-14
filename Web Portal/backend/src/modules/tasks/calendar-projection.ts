import { isValidRule, nextDueDate, nextOccurrence, withAnchorDay, type RecurrenceRule } from './recurrence';

/** Safety bound on the dates looked at for one series. */
const MAX_STEPS = 1000;

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const dayStart = (key: string) => new Date(`${key}T00:00:00.000Z`);

export interface SeriesHead {
  id: string;
  dueDate: Date | null;
  recurrenceRule: RecurrenceRule | null;
}

/**
 * The days a recurring series will produce copies on, within `from`–`to` ('YYYY-MM-DD'), without
 * creating anything: the calendar shows them as projected. They follow the same rules the server
 * uses when it makes the copies — the first is the next date that isn't already past (missed dates
 * are skipped), a copy moved on its own keeps the series on its days (`resumeFrom`), and the
 * series' end date and number of occurrences are respected (`existing` = copies already made).
 * Paused, invalid or undated series project nothing.
 */
export function projectOccurrences(head: SeriesHead, range: { from: string; to: string; today: string }, existing: number): string[] {
  const raw = head.recurrenceRule;
  if (!raw || !isValidRule(raw) || raw.paused) return [];
  const base = raw.resumeFrom ? dayStart(raw.resumeFrom) : head.dueDate;
  if (!base) return [];
  const rule = withAnchorDay(raw, base);
  let remaining = rule.count != null ? rule.count - existing : Number.POSITIVE_INFINITY;
  const until = rule.until != null ? dayOf(new Date(rule.until)) : null;
  const days: string[] = [];
  let next = remaining > 0 ? nextDueDate(base, rule, range.today) : null;
  for (let i = 0; next && remaining > 0 && i < MAX_STEPS; i++) {
    const key = dayOf(next);
    if (key > range.to || (until && key > until)) break;
    if (key >= range.from) days.push(key);
    remaining -= 1;
    next = nextOccurrence(next, rule);
  }
  return days;
}
