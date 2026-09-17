export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface RecurrenceRule {
  freq: Frequency;
  /** Weeks/days/months/quarters/years between occurrences (>= 1). */
  interval: number;
  /** Optional cap on the total number of occurrences (including the first). */
  count?: number | null;
  /** Optional ISO end date; no occurrence is generated after it. */
  until?: string | null;
  /** WEEKLY only: days of the week (0 = Sunday … 6 = Saturday). */
  weekdays?: number[];
  /** MONTHLY/QUARTERLY only: day of month (1–31), clamped to the month's length. */
  dayOfMonth?: number;
  /** When true the series is paused — no new occurrences are generated until resumed. */
  paused?: boolean;
}

const FREQS: Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];

/** Validate a recurrence rule's shape (used before persisting or computing). */
export function isValidRule(rule: RecurrenceRule): boolean {
  if (!FREQS.includes(rule.freq)) return false;
  if (!Number.isInteger(rule.interval) || rule.interval < 1) return false;
  if (rule.count != null && (!Number.isInteger(rule.count) || rule.count < 1)) return false;
  if (rule.weekdays && rule.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return false;
  if (rule.dayOfMonth != null && (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) return false;
  if (rule.until != null && Number.isNaN(Date.parse(rule.until))) return false;
  return true;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** Add months (or years, monthsPerStep=12), clamping the day to the target month's length. */
function addMonthsClamped(d: Date, months: number, dayOfMonth?: number): Date {
  const targetDay = dayOfMonth ?? d.getUTCDate();
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(targetDay, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/** The next occurrence strictly after `from`, per the rule. */
export function nextOccurrence(from: Date, rule: RecurrenceRule): Date {
  const interval = Math.max(1, rule.interval);
  switch (rule.freq) {
    case 'DAILY':
      return addDays(from, interval);
    case 'WEEKLY': {
      if (rule.weekdays && rule.weekdays.length > 0) {
        const set = new Set(rule.weekdays);
        for (let i = 1; i <= 7; i++) {
          const candidate = addDays(from, i);
          if (set.has(candidate.getUTCDay())) return candidate;
        }
        return addDays(from, 7); // unreachable given a non-empty set, but safe
      }
      return addDays(from, 7 * interval);
    }
    case 'MONTHLY':
      return addMonthsClamped(from, interval, rule.dayOfMonth);
    case 'QUARTERLY':
      return addMonthsClamped(from, 3 * interval, rule.dayOfMonth);
    case 'YEARLY':
      return addMonthsClamped(from, 12 * interval);
  }
}

/** The occurrences of a rule, starting AT `start`, bounded by count / until / a hard limit. */
export function generateOccurrences(start: Date, rule: RecurrenceRule, limit: number): Date[] {
  const until = rule.until != null ? new Date(rule.until) : null;
  const max = rule.count != null ? Math.min(rule.count, limit) : limit;
  const out: Date[] = [];
  let current = start;
  while (out.length < max) {
    if (until && current.getTime() > until.getTime()) break;
    out.push(current);
    current = nextOccurrence(current, rule);
  }
  return out;
}
