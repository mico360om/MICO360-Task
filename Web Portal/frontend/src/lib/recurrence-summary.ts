import type { RecurrenceRule } from '../api/tasks';

const UNIT: Record<RecurrenceRule['freq'], string> = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
  QUARTERLY: 'quarter',
  YEARLY: 'year',
};
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A short human-readable description of a recurrence rule (for the task drawer badge). */
export function recurrenceSummary(rule: RecurrenceRule): string {
  const unit = UNIT[rule.freq];
  const every = rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}s`;
  let s = `Repeats ${every}`;

  if (rule.freq === 'WEEKLY' && rule.weekdays && rule.weekdays.length > 0) {
    const days = [...rule.weekdays].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ');
    s += ` on ${days}`;
  } else if ((rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') && rule.dayOfMonth) {
    s += ` on day ${rule.dayOfMonth}`;
  }

  if (rule.count != null) s += `, ${rule.count} times`;
  if (rule.until) s += `, until ${rule.until.slice(0, 10)}`;
  if (rule.paused) s += ' (paused)';
  return s;
}
