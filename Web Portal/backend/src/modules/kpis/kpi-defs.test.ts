import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGETS,
  METRICS,
  PROJECT_METRICS,
  USER_METRICS,
  LIGHT_WORDS,
  amberBandOf,
  lightOf,
  monthsBack,
  periodOf,
  resolveTargets,
  roundFor,
  slicesOf,
  weekStartOf,
  weeksBack,
} from './kpi-defs';

describe('the metric catalogue', () => {
  it('has the eight project KPIs and the user KPIs of the design, each with words', () => {
    expect(PROJECT_METRICS).toEqual(['onTime', 'overdue', 'daysLate', 'progress', 'throughput', 'cycleTime', 'approvalTurnaround', 'blocked']);
    expect(USER_METRICS).toEqual(['completed', 'onTime', 'daysLate', 'userOverdue', 'workload', 'approvalTurnaround', 'responsiveness', 'actionItems']);
    expect(METRICS.filter((m) => m.scopes.includes('project')).map((m) => m.key).sort()).toEqual([...PROJECT_METRICS].sort());
    expect(METRICS.filter((m) => m.scopes.includes('user')).map((m) => m.key).sort()).toEqual([...USER_METRICS].sort());
    for (const m of METRICS) expect(m.label.length).toBeGreaterThan(3);
  });

  it('company defaults: on time 85%, days late ≤ 2 (owner examples)', () => {
    expect(DEFAULT_TARGETS.onTime).toBe(85);
    expect(DEFAULT_TARGETS.daysLate).toBe(2);
  });
});

describe('lights — always with words', () => {
  const t = (target: number | null, band: number | null = null) => ({ target, amberBand: band });
  it('higher is better: at or above the target is green, within the band amber, below red', () => {
    expect(lightOf(90, t(85), 'onTime')).toBe('green');
    expect(lightOf(85, t(85), 'onTime')).toBe('green');
    expect(lightOf(77, t(85), 'onTime')).toBe('amber'); // 10% of 85 = 8.5 → 76.5 and up
    expect(lightOf(76, t(85), 'onTime')).toBe('red');
  });

  it('lower is better: at or under the target is green, within the band amber, over red', () => {
    expect(lightOf(2, t(2), 'daysLate')).toBe('green');
    expect(lightOf(2.2, t(2), 'daysLate')).toBe('amber');
    expect(lightOf(2.3, t(2), 'daysLate')).toBe('red');
  });

  it('a target of 0: the band is one unit (one blocked task is close, two off target)', () => {
    expect(amberBandOf(0, null)).toBe(1);
    expect(lightOf(0, t(0), 'blocked')).toBe('green');
    expect(lightOf(1, t(0), 'blocked')).toBe('amber');
    expect(lightOf(2, t(0), 'blocked')).toBe('red');
  });

  it('an own band replaces the 10%', () => {
    expect(lightOf(70, t(85, 20), 'onTime')).toBe('amber');
  });

  it('no target, or no figure: no light colour, and words for both', () => {
    expect(lightOf(50, t(null), 'onTime')).toBe('none');
    expect(lightOf(null, t(85), 'onTime')).toBe('nodata');
    expect(LIGHT_WORDS).toEqual({ green: 'On target', amber: 'Close', red: 'Off target', none: 'No target', nodata: 'No data yet' });
  });
});

describe('resolveTargets — company defaults + project overrides (owner 3)', () => {
  it('a project override wins, then the company, then the site, then the built-in default', () => {
    const r = resolveTargets([
      { scopeKey: 'site', metric: 'onTime', target: 80, amberBand: null },
      { scopeKey: 'company:c1', metric: 'onTime', target: 90, amberBand: 5 },
      { scopeKey: 'project:p1', metric: 'daysLate', target: 3, amberBand: null },
      { scopeKey: 'project:p1', metric: 'throughput', target: null, amberBand: null },
    ], { companyId: 'c1', projectId: 'p1' });
    expect(r.onTime).toEqual({ target: 90, amberBand: 5, source: 'company' });
    expect(r.daysLate).toEqual({ target: 3, amberBand: null, source: 'project' });
    expect(r.overdue).toEqual({ target: DEFAULT_TARGETS.overdue, amberBand: null, source: 'default' });
    // A row with no target means "no target here" (it still overrides).
    expect(r.throughput).toEqual({ target: null, amberBand: null, source: 'project' });
  });

  it('without a company: the site row, else the default', () => {
    const r = resolveTargets([{ scopeKey: 'site', metric: 'onTime', target: 80, amberBand: null }], { companyId: null, projectId: null });
    expect(r.onTime.target).toBe(80);
    expect(r.onTime.source).toBe('site');
  });
});

describe('rounding for display (and for judging)', () => {
  it('percentages whole, days and hours to one decimal, counts whole', () => {
    expect(roundFor('onTime', 84.6)).toBe(85);
    expect(roundFor('daysLate', 2.04)).toBe(2);
    expect(roundFor('approvalTurnaround', 7.25)).toBe(7.3);
    expect(roundFor('blocked', 3)).toBe(3);
    expect(roundFor('onTime', null)).toBeNull();
  });
});

describe('periods (owner 3: this month by default; week, quarter or a custom range)', () => {
  const today = '2026-11-11'; // a Wednesday
  it('this month: the 1st to today; it ends at the month end', () => {
    expect(periodOf({ kind: 'month' }, today, 0)).toMatchObject({ kind: 'month', from: '2026-11-01', to: '2026-11-11', end: '2026-11-30', label: 'This month (1–11 Nov 2026)' });
  });
  it('this week from the week start', () => {
    expect(periodOf({ kind: 'week' }, today, 0)).toMatchObject({ from: '2026-11-08', to: '2026-11-11', end: '2026-11-14', label: 'This week (8–11 Nov 2026)' });
    expect(periodOf({ kind: 'week' }, today, 1)).toMatchObject({ from: '2026-11-09' });
  });
  it('this quarter', () => {
    expect(periodOf({ kind: 'quarter' }, today, 0)).toMatchObject({ from: '2026-10-01', to: '2026-11-11', end: '2026-12-31', label: 'This quarter (1 Oct – 11 Nov 2026)' });
  });
  it('a custom range, both days included; refused when back to front or over a year', () => {
    expect(periodOf({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' }, today, 0)).toMatchObject({ from: '2026-09-01', to: '2026-09-30', end: '2026-09-30', label: '1–30 Sep 2026' });
    expect(() => periodOf({ kind: 'custom', from: '2026-09-30', to: '2026-09-01' }, today, 0)).toThrow(/before/);
    expect(() => periodOf({ kind: 'custom', from: '2025-01-01', to: '2026-09-01' }, today, 0)).toThrow(/366/);
  });
  it('a custom range running past today is counted up to today (and ends where asked)', () => {
    expect(periodOf({ kind: 'custom', from: '2026-11-01', to: '2026-11-30' }, today, 0)).toMatchObject({ to: '2026-11-11', end: '2026-11-30' });
  });
});

describe('slices: each week cut at month ends (so weekly and monthly trends add up exactly)', () => {
  it('a week across two months is two slices', () => {
    // Sunday weeks: 25 Oct – 31 Oct, 1 Nov – 7 Nov; and with Monday weeks 26 Oct – 1 Nov splits.
    expect(slicesOf('2026-10-26', '2026-11-08', 1)).toEqual([
      { day: '2026-10-26', end: '2026-10-31', weekStart: '2026-10-26', month: '2026-10' },
      { day: '2026-11-01', end: '2026-11-01', weekStart: '2026-10-26', month: '2026-11' },
      { day: '2026-11-02', end: '2026-11-08', weekStart: '2026-11-02', month: '2026-11' },
    ]);
  });
  it('a start inside a week starts the slice there', () => {
    expect(slicesOf('2026-11-04', '2026-11-05', 0)).toEqual([{ day: '2026-11-04', end: '2026-11-05', weekStart: '2026-11-01', month: '2026-11' }]);
  });
  it('week starts, months and weeks back', () => {
    expect(weekStartOf('2026-11-11', 0)).toBe('2026-11-08');
    expect(weekStartOf('2026-11-11', 6)).toBe('2026-11-07');
    expect(monthsBack('2026-11-11', 6)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(weeksBack('2026-11-11', 0, 3)).toEqual(['2026-10-25', '2026-11-01', '2026-11-08']);
  });
});
