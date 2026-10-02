// Recurring tasks: describing and editing a task's repeat rule. The rule's shape is the API's (see
// the backend's src/modules/tasks/recurrence.ts); the server works out every date. Pure, so the
// task-detail editor stays thin and this is unit-testable.

export const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
export const FREQ_LABEL = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', YEARLY: 'Yearly' };
export const UNIT_LABEL = { DAILY: 'day(s)', WEEKLY: 'week(s)', MONTHLY: 'month(s)', QUARTERLY: 'quarter(s)', YEARLY: 'year(s)' };
const UNIT = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', QUARTERLY: 'quarter', YEARLY: 'year' };
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "the 2nd Tuesday": week 1–4, or -1 for the last. */
export const WEEK_OF_MONTH = [
  { week: 1, label: '1st' },
  { week: 2, label: '2nd' },
  { week: 3, label: '3rd' },
  { week: 4, label: '4th' },
  { week: -1, label: 'last' },
];

/** A short description of a rule — the same wording as the web and Android apps. */
export function recurrenceSummary(rule) {
  const unit = UNIT[rule.freq] || 'period';
  let s = `Repeats ${rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}s`}`;
  if (rule.freq === 'WEEKLY' && Array.isArray(rule.weekdays) && rule.weekdays.length > 0) {
    s += ` on ${[...rule.weekdays].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ')}`;
  } else if (rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') {
    if (rule.nthWeekday) {
      const week = (WEEK_OF_MONTH.find((w) => w.week === rule.nthWeekday.week) || {}).label || '';
      s += ` on the ${week} ${WEEKDAY_NAMES[rule.nthWeekday.day] || ''}`;
    } else if (rule.dayOfMonth === 31) {
      s += ' on the last day'; // clamped to each month's length
    } else if (rule.dayOfMonth) {
      s += ` on day ${rule.dayOfMonth}`;
    }
  }
  if (rule.count != null) s += `, ${rule.count} times`;
  if (rule.until) s += `, until ${String(rule.until).slice(0, 10)}`;
  if (rule.createNext === 'ON_SCHEDULE') s += ' · new copy on each date';
  if (rule.paused) s += ' (paused)';
  return s;
}

/** The newest copy of a series carries the rule. */
export function isRecurring(task) {
  return Boolean(task && task.recurrenceRule);
}

/**
 * An earlier copy of a series — one whose next copy already exists. Its repeat can't be changed
 * (that would start a second, parallel series); the newest copy can always change or restart it.
 */
export function isEarlierCopy(task) {
  return Boolean(task && task.recurrenceNextId);
}

/** Every copy of a series links to it. */
export function inSeries(task) {
  return Boolean(task && (task.recurrenceRule || task.recurrenceParentId));
}

function without(rule, ...keys) {
  const copy = { ...rule };
  for (const k of keys) delete copy[k];
  return copy;
}

/** Start, change or stop ('NONE') repeating — keeping how it ends and when copies are made. */
export function withFreq(rule, freq) {
  if (!FREQS.includes(freq)) return null;
  const next = { freq, interval: (rule && rule.interval) || 1 };
  if (rule && rule.count != null) next.count = rule.count;
  if (rule && rule.until != null) next.until = rule.until;
  if (rule && rule.createNext) next.createNext = rule.createNext;
  if (rule && rule.paused) next.paused = rule.paused;
  return next;
}

export function withInterval(rule, n) {
  const v = Number(n);
  return { ...rule, interval: Number.isInteger(v) && v >= 1 ? v : 1 };
}

export function toggleWeekday(rule, day) {
  const set = new Set(rule.weekdays || []);
  if (set.has(day)) set.delete(day);
  else set.add(day);
  return { ...rule, weekdays: [...set].sort((a, b) => a - b) };
}

/** "The 2nd Tuesday" for a due date ('YYYY-MM-DD'): its weekday, and which one of the month (5th → last). */
export function nthWeekdayOf(dueKey) {
  const d = new Date(`${dueKey}T00:00:00.000Z`);
  if (!dueKey || Number.isNaN(d.getTime())) return { week: 1, day: 1 };
  const week = Math.ceil(d.getUTCDate() / 7);
  return { week: week >= 5 ? -1 : week, day: d.getUTCDay() };
}

/** Monthly/quarterly on a date of the month ('DATE') or on "the 2nd Tuesday" ('WEEKDAY'). */
export function withMonthlyMode(rule, mode, dueKey) {
  if (mode === 'DATE') return without(rule, 'nthWeekday');
  return { ...without(rule, 'dayOfMonth', 'anchorDay'), nthWeekday: rule.nthWeekday || nthWeekdayOf(dueKey) };
}

export function withNth(rule, patch) {
  return { ...rule, nthWeekday: { ...(rule.nthWeekday || { week: 1, day: 1 }), ...patch } };
}

export function withDayOfMonth(rule, n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) return without(rule, 'dayOfMonth');
  return { ...rule, dayOfMonth: Math.min(31, v) };
}

/** How the series ends: 'NEVER', after a number of copies ('COUNT') or on a date ('UNTIL'). */
export function withEnds(rule, mode, until) {
  if (mode === 'COUNT') return { ...rule, count: rule.count != null ? rule.count : 10, until: null };
  if (mode === 'UNTIL') return { ...rule, until: until || rule.until || null, count: null };
  return { ...rule, count: null, until: null };
}

export function endsMode(rule) {
  return rule.count != null ? 'COUNT' : rule.until != null ? 'UNTIL' : 'NEVER';
}

/** When the next copy is made: when this one is done (the default) or on each date ('ON_SCHEDULE'). */
export function withCreateNext(rule, mode) {
  return mode === 'ON_SCHEDULE' ? { ...rule, createNext: 'ON_SCHEDULE' } : without(rule, 'createNext');
}

export function togglePaused(rule) {
  return { ...rule, paused: !rule.paused };
}
