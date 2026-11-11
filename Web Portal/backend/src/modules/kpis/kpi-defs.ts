/**
 * Project KPIs and User KPIs — the catalogue: each KPI's words, unit and direction, the company's
 * default targets (owner 3: e.g. on time 85%, days late ≤ 2), the lights (always with words), the
 * periods a page may show (owner 3: this month by default; a week, a quarter or a custom range) and
 * the snapshot slices (each week cut at month ends, so a 12-week weekly trend and a 6-month monthly
 * trend both add up exactly from the same stored rows). Pure.
 */
import { formatDay } from '../../lib/export-format';
import { daysBetween, shiftDay, weekdayOf } from '../../lib/working-days';
import { ValidationError } from '../../lib/http-errors';

export type MetricKey =
  | 'onTime'
  | 'overdue'
  | 'daysLate'
  | 'progress'
  | 'throughput'
  | 'cycleTime'
  | 'approvalTurnaround'
  | 'blocked'
  | 'completed'
  | 'userOverdue'
  | 'workload'
  | 'responsiveness'
  | 'actionItems';

export type Unit = 'percent' | 'days' | 'hours' | 'tasks' | 'perWeek' | 'items';
export type Direction = 'higher' | 'lower';

export interface MetricDef {
  key: MetricKey;
  label: string;
  /** One line under the figure: what it counts. */
  help: string;
  unit: Unit;
  direction: Direction;
  /** Which pages show it. */
  scopes: readonly ('project' | 'user')[];
  /** It can have a target (and so a light). */
  targeted: boolean;
}

/** In the order the pages show them. */
export const METRICS: readonly MetricDef[] = [
  { key: 'completed', label: 'Tasks completed', help: 'Finished in the period (handed in for approval counts)', unit: 'tasks', direction: 'higher', scopes: ['user'], targeted: false },
  { key: 'onTime', label: 'On-time completion', help: 'Finished on or before the agreed due day, of those finished with one', unit: 'percent', direction: 'higher', scopes: ['project', 'user'], targeted: true },
  { key: 'overdue', label: 'Overdue', help: 'Open tasks past their agreed due day, of open tasks with one', unit: 'percent', direction: 'lower', scopes: ['project'], targeted: true },
  { key: 'daysLate', label: 'Average days late', help: 'Working days late, of tasks finished late', unit: 'days', direction: 'lower', scopes: ['project', 'user'], targeted: true },
  { key: 'userOverdue', label: 'Overdue now', help: 'Their open tasks past the agreed due day', unit: 'tasks', direction: 'lower', scopes: ['user'], targeted: true },
  { key: 'workload', label: 'Workload', help: 'Planned hours against the hours they have', unit: 'percent', direction: 'lower', scopes: ['user'], targeted: true },
  { key: 'progress', label: 'Progress vs time', help: 'Completion against the share of planned time used', unit: 'percent', direction: 'higher', scopes: ['project'], targeted: true },
  { key: 'throughput', label: 'Tasks finished per week', help: 'Average over the period', unit: 'perWeek', direction: 'higher', scopes: ['project'], targeted: true },
  { key: 'cycleTime', label: 'Start to done', help: 'Average working days from start (or creation) to done', unit: 'days', direction: 'lower', scopes: ['project'], targeted: true },
  { key: 'approvalTurnaround', label: 'Approval turnaround', help: 'Average working hours from handed in to approved or sent back', unit: 'hours', direction: 'lower', scopes: ['project', 'user'], targeted: true },
  { key: 'responsiveness', label: 'Update responsiveness', help: 'Median working hours to answer a comment or @mention', unit: 'hours', direction: 'lower', scopes: ['user'], targeted: true },
  { key: 'blocked', label: 'Open blocked', help: 'Tasks in a Blocked column now', unit: 'tasks', direction: 'lower', scopes: ['project'], targeted: true },
  { key: 'actionItems', label: 'Action items closed', help: 'Meeting action items they closed in the period', unit: 'items', direction: 'higher', scopes: ['user'], targeted: false },
];

const PROJECT_ORDER: MetricKey[] = ['onTime', 'overdue', 'daysLate', 'progress', 'throughput', 'cycleTime', 'approvalTurnaround', 'blocked'];
const USER_ORDER: MetricKey[] = ['completed', 'onTime', 'daysLate', 'userOverdue', 'workload', 'approvalTurnaround', 'responsiveness', 'actionItems'];
export const PROJECT_METRICS: readonly MetricKey[] = PROJECT_ORDER;
export const USER_METRICS: readonly MetricKey[] = USER_ORDER;

export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, MetricDef>;
export const TARGET_METRICS: readonly MetricKey[] = METRICS.filter((m) => m.targeted).map((m) => m.key);

/** The company defaults until an administrator sets their own (null: no target, no light). */
export const DEFAULT_TARGETS: Readonly<Record<MetricKey, number | null>> = {
  onTime: 85,
  overdue: 10,
  daysLate: 2,
  progress: 100,
  throughput: null,
  cycleTime: 5,
  approvalTurnaround: 16,
  blocked: 0,
  completed: null,
  userOverdue: 0,
  workload: 100,
  responsiveness: 8,
  actionItems: null,
};

export type Light = 'green' | 'amber' | 'red' | 'none' | 'nodata';
export const LIGHT_WORDS: Readonly<Record<Light, string>> = { green: 'On target', amber: 'Close', red: 'Off target', none: 'No target', nodata: 'No data yet' };

export interface Target {
  target: number | null;
  /** Null: 10% of the target (one unit for a target of 0). */
  amberBand: number | null;
}

/** The amber band: its own, else 10% of the target (my call), one unit when that is 0. */
export function amberBandOf(target: number, amberBand: number | null): number {
  if (amberBand !== null && amberBand >= 0) return amberBand;
  const tenth = Math.abs(target) * 0.1;
  return tenth > 0 ? tenth : 1;
}

/** Rounded as shown (percentages and counts whole, days and hours to one decimal) — figures are judged as shown. */
export function roundFor(metric: MetricKey, value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const unit = METRIC[metric].unit;
  if (unit === 'days' || unit === 'hours' || unit === 'perWeek') return Math.round(value * 10) / 10;
  return Math.round(value);
}

/** The light for a figure against its target. */
export function lightOf(value: number | null, t: Target, metric: MetricKey): Light {
  if (value === null) return 'nodata';
  if (t.target === null) return 'none';
  const band = amberBandOf(t.target, t.amberBand);
  const eps = 1e-9;
  if (METRIC[metric].direction === 'higher') {
    if (value >= t.target - eps) return 'green';
    return value >= t.target - band - eps ? 'amber' : 'red';
  }
  if (value <= t.target + eps) return 'green';
  return value <= t.target + band + eps ? 'amber' : 'red';
}

export interface TargetRow {
  /** 'site', 'company:<id>' or 'project:<id>'. */
  scopeKey: string;
  metric: string;
  target: number | null;
  amberBand: number | null;
}

export type TargetSource = 'project' | 'company' | 'site' | 'default';
export type ResolvedTargets = Record<MetricKey, Target & { source: TargetSource }>;

/** Each KPI's target for a project (or a person: no project): its override, its company's, the site's, the default. */
export function resolveTargets(rows: readonly TargetRow[], where: { companyId: string | null; projectId: string | null }): ResolvedTargets {
  const scopes: [string, TargetSource][] = [
    ...(where.projectId ? ([[`project:${where.projectId}`, 'project']] as [string, TargetSource][]) : []),
    ...(where.companyId ? ([[`company:${where.companyId}`, 'company']] as [string, TargetSource][]) : []),
    ['site', 'site'],
  ];
  const out = {} as ResolvedTargets;
  for (const m of METRICS) {
    let hit: (Target & { source: TargetSource }) | null = null;
    for (const [key, source] of scopes) {
      const row = rows.find((r) => r.scopeKey === key && r.metric === m.key);
      if (row) {
        hit = { target: row.target, amberBand: row.amberBand, source };
        break;
      }
    }
    out[m.key] = hit ?? { target: m.targeted ? DEFAULT_TARGETS[m.key] : null, amberBand: null, source: 'default' };
  }
  return out;
}

// ── Periods ──────────────────────────────────────────────────────────────────

export type PeriodKind = 'week' | 'month' | 'quarter' | 'custom';
export const PERIOD_KINDS: readonly PeriodKind[] = ['week', 'month', 'quarter', 'custom'];
/** A custom range is at most this many days. */
export const MAX_RANGE_DAYS = 366;

export interface Period {
  kind: PeriodKind;
  /** The first day and the last day counted (today at most), 'YYYY-MM-DD'. */
  from: string;
  to: string;
  /** The period's own last day (the month's end for "this month"): capacity is counted to it. */
  end: string;
  label: string;
}

export type PeriodAsk = { kind: 'week' | 'month' | 'quarter' } | { kind: 'custom'; from: string; to: string };

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1–11 Nov 2026", "1 Oct – 11 Nov 2026", "3 Dec 2025 – 2 Jan 2026". */
export function rangeWords(from: string, to: string): string {
  if (from === to) return formatDay(from);
  const [fy, fm] = [from.slice(0, 4), from.slice(5, 7)];
  const [ty, tm] = [to.slice(0, 4), to.slice(5, 7)];
  if (fy === ty && fm === tm) return `${Number(from.slice(8))}–${Number(to.slice(8))} ${MONTH_NAMES[Number(tm) - 1]} ${ty}`;
  if (fy === ty) return `${formatDay(from, { year: false })} – ${formatDay(to)}`;
  return `${formatDay(from)} – ${formatDay(to)}`;
}

/** The last day of a 'YYYY-MM' month. */
export function monthEnd(month: string): string {
  return shiftDay(`${nextMonth(month)}-01`, -1);
}

export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The first day of the week a day is in. */
export function weekStartOf(day: string, weekStart: number): string {
  return shiftDay(day, -((weekdayOf(day) - weekStart + 7) % 7));
}

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A period asked for, worked out on `today` (company time) with the week starting on `weekStart`. */
export function periodOf(ask: PeriodAsk, today: string, weekStart: number): Period {
  const month = today.slice(0, 7);
  if (ask.kind === 'week') {
    const from = weekStartOf(today, weekStart);
    return { kind: 'week', from, to: today, end: shiftDay(from, 6), label: `This week (${rangeWords(from, today)})` };
  }
  if (ask.kind === 'month') {
    const from = `${month}-01`;
    return { kind: 'month', from, to: today, end: monthEnd(month), label: `This month (${rangeWords(from, today)})` };
  }
  if (ask.kind === 'quarter') {
    const q = Math.floor((Number(month.slice(5, 7)) - 1) / 3);
    const first = `${month.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}`;
    const from = `${first}-01`;
    return { kind: 'quarter', from, to: today, end: monthEnd(`${month.slice(0, 4)}-${String(q * 3 + 3).padStart(2, '0')}`), label: `This quarter (${rangeWords(from, today)})` };
  }
  if (ask.kind !== 'custom') throw new ValidationError('Choose a period.');
  if (!DAY.test(ask.from) || !DAY.test(ask.to)) throw new ValidationError('Choose a start and an end day.');
  if (ask.to < ask.from) throw new ValidationError('The start must be on or before the end.');
  if (daysBetween(ask.from, ask.to) + 1 > MAX_RANGE_DAYS) throw new ValidationError(`Choose at most ${MAX_RANGE_DAYS} days.`);
  if (ask.from > today) throw new ValidationError('Choose a range that has started.');
  const to = ask.to > today ? today : ask.to;
  return { kind: 'custom', from: ask.from, to, end: ask.to, label: rangeWords(ask.from, ask.to) };
}

// ── Snapshot slices ──────────────────────────────────────────────────────────

/** A week cut at a month's end: the unit snapshots are stored in. */
export interface Slice {
  /** Its first and last day. */
  day: string;
  end: string;
  /** The week it belongs to (its first day) and its month. */
  weekStart: string;
  month: string;
}

/** The slices from one day to another (both included). */
export function slicesOf(from: string, to: string, weekStart: number): Slice[] {
  const out: Slice[] = [];
  let d = from;
  while (d <= to) {
    const ws = weekStartOf(d, weekStart);
    const weekEnd = shiftDay(ws, 6);
    const mEnd = monthEnd(d.slice(0, 7));
    const end = [weekEnd, mEnd, to].sort()[0]!;
    out.push({ day: d, end, weekStart: ws, month: d.slice(0, 7) });
    d = shiftDay(end, 1);
  }
  return out;
}

/** The last `n` months up to today's, oldest first. */
export function monthsBack(today: string, n: number): string[] {
  const out = [today.slice(0, 7)];
  while (out.length < n) out.unshift(prevMonth(out[0]!));
  return out;
}

/** The last `n` weeks up to today's (their first days), oldest first. */
export function weeksBack(today: string, weekStart: number, n: number): string[] {
  const out = [weekStartOf(today, weekStart)];
  while (out.length < n) out.unshift(shiftDay(out[0]!, -7));
  return out;
}

/** "Nov", "Nov 2025" (another year than `today`'s). */
export function monthLabel(month: string, today: string): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1]!;
  return month.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${month.slice(0, 4)}`;
}
