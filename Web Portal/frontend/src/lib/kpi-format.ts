/**
 * KPIs in words (the PDF, the Excel file and the drill-down lines): "85%", "2.3 working days", "Behind by
 * 8%", "≥ 85%". The website keeps an identical copy (Web Portal/frontend/src/lib/kpi-format.ts) and a test
 * fails when the two differ. No imports: it runs in both.
 */

export type KpiUnit = 'percent' | 'days' | 'hours' | 'tasks' | 'perWeek' | 'items';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A figure in words; '—' when there is none. Progress vs time reads "Ahead by 5%", "On plan", "Behind by 8%". */
export function formatKpiValue(metric: string, unit: KpiUnit, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (metric === 'progress') {
    if (value === 100) return 'On plan';
    return value > 100 ? `Ahead by ${value - 100}%` : `Behind by ${100 - value}%`;
  }
  switch (unit) {
    case 'percent':
      return `${value}%`;
    case 'days':
      return plural(value, 'working day');
    case 'hours':
      return plural(value, 'working hour');
    case 'tasks':
      return plural(value, 'task');
    case 'perWeek':
      return `${value} a week`;
    case 'items':
      return plural(value, 'item');
  }
}

/** A target in words: "At least 85%", "At most 2 working days", "No target". Progress: "On plan or ahead". */
export function formatKpiTarget(metric: string, unit: KpiUnit, direction: 'higher' | 'lower', target: number | null): string {
  if (target === null) return 'No target';
  if (metric === 'progress') return target === 100 ? 'On plan or ahead' : `At least ${target}% of plan`;
  return `${direction === 'higher' ? 'At least' : 'At most'} ${formatKpiValue(metric, unit, target)}`;
}

/** A custom KPI's value with its unit: "3 incidents", "72 %", "1,200 OMR". */
export function formatCustomValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const n = Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const u = unit.trim();
  if (!u) return n;
  return u === '%' ? `${n}%` : `${n} ${u}`;
}
