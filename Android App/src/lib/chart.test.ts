import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  barPct,
  barsSummary,
  chartRows,
  chartSummary,
  cumulative,
  dashed,
  gridValues,
  lineSegments,
  niceCeil,
  sampleIndexes,
  tickIndexes,
  dashedLine,
  sampleWithPeaks,
  alignRight,
  chartRow,
  placeSegment,
  plotLeft,
  type ChartDirection,
} from './chart';

describe('chart scale (5c), as the website’s line chart', () => {
  it('rounds the top of the scale up to a clean number', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(1)).toBe(1);
    expect(niceCeil(7)).toBe(7);
    expect(niceCeil(38)).toBe(40);
    expect(niceCeil(101)).toBe(200);
    expect(niceCeil(1234)).toBe(2000);
  });
  it('draws five grid lines, 0 to the top', () => {
    expect(gridValues(40)).toEqual([0, 10, 20, 30, 40]);
    expect(gridValues(7)).toEqual([0, 2, 4, 5, 7]);
  });
  it('labels about six days, always the last', () => {
    expect(tickIndexes(30)).toEqual([0, 5, 10, 15, 20, 25, 29]);
    expect(tickIndexes(7)).toEqual([0, 2, 4, 6]);
    expect(tickIndexes(3)).toEqual([0, 1, 2]);
    expect(tickIndexes(0)).toEqual([]);
  });
});

describe('drawing a line with plain views (5c)', () => {
  it('keeps at most so many points, evenly spread, the first and last always', () => {
    expect(sampleIndexes(5, 60)).toEqual([0, 1, 2, 3, 4]);
    const many = sampleIndexes(366, 60);
    expect(many.length).toBeLessThanOrEqual(60);
    expect(many[0]).toBe(0);
    expect(many[many.length - 1]).toBe(365);
    expect(new Set(many).size).toBe(many.length);
    expect(sampleIndexes(0, 60)).toEqual([]);
  });

  it('turns values into straight pieces between the points: where each starts, how long, at what angle', () => {
    // 3 points over 200 × 100, top 10: (0,100) → (100,0) → (200,50)
    const segs = lineSegments([0, 10, 5], [0, 1, 2], { width: 200, height: 100, top: 10, thickness: 2 });
    expect(segs).toHaveLength(2);
    const [a, b] = segs;
    expect(a!.width).toBeCloseTo(Math.hypot(100, 100));
    expect(a!.angle).toBeCloseTo(-Math.PI / 4);
    // centred on the middle of the piece: (50, 50)
    expect(a!.left + a!.width / 2).toBeCloseTo(50);
    expect(a!.top + 1).toBeCloseTo(50);
    expect(b!.angle).toBeCloseTo(Math.atan2(50, 100));
    expect(b!.left + b!.width / 2).toBeCloseTo(150);
    expect(b!.top + 1).toBeCloseTo(25);
  });

  it('draws one point as a dot in the middle, and nothing for no values', () => {
    const [dot] = lineSegments([4], [0], { width: 200, height: 100, top: 8, thickness: 2 });
    expect(dot).toMatchObject({ width: 2 });
    expect(dot!.left + 1).toBeCloseTo(100);
    expect(dot!.top + 1).toBeCloseTo(50);
    expect(lineSegments([], [], { width: 200, height: 100, top: 8 })).toEqual([]);
  });

  it('places sampled points where their day is, not squeezed together', () => {
    const segs = lineSegments([0, 0, 0, 0, 10], [0, 4], { width: 400, height: 100, top: 10, thickness: 2 });
    expect(segs).toHaveLength(1);
    expect(segs[0]!.width).toBeCloseTo(Math.hypot(400, 100));
  });

  it('cuts a piece into dashes for a dashed line (the ideal burndown)', () => {
    const [seg] = lineSegments([10, 0], [0, 1], { width: 90, height: 0.0001, top: 10, thickness: 2 });
    const pieces = dashed(seg!, 5, 4);
    expect(pieces).toHaveLength(10);
    expect(pieces[0]!.width).toBeCloseTo(5);
    expect(pieces.every((p) => p.angle === seg!.angle)).toBe(true);
  });
});

describe('charts in words (5c): TalkBack reads what the lines show', () => {
  it('sums a line chart up: each line where it starts, ends and peaks', () => {
    const labels = ['1 Oct', '2 Oct', '3 Oct'];
    expect(
      chartSummary('Completion over time', labels, [
        { name: 'Completed', values: [0, 4, 6] },
        { name: 'Created', values: [2, 9, 9] },
      ]),
    ).toBe('Completion over time, 1 Oct to 3 Oct. Completed: 0 on 1 Oct, 6 on 3 Oct, highest 6. Created: 2 on 1 Oct, 9 on 3 Oct, highest 9.');
    expect(chartSummary('Overdue trend', [], [{ name: 'Overdue', values: [] }])).toBe('Overdue trend: no data to chart yet.');
  });

  it('lists the numbers day by day for the table under a chart', () => {
    expect(chartRows(['1 Oct', '2 Oct'], [{ name: 'Remaining', values: [5, 3] }, { name: 'Ideal', values: [5, 0] }])).toEqual([
      { key: '0', label: '1 Oct', text: 'Remaining 5, Ideal 5' },
      { key: '1', label: '2 Oct', text: 'Remaining 3, Ideal 0' },
    ]);
  });

  it('reads a bar chart as its bars: “label value”', () => {
    expect(barsSummary('Tasks by status', [{ label: 'To do', value: 5 }, { label: 'Done', value: 3 }])).toBe('Tasks by status: To do 5, Done 3.');
    expect(barsSummary('Velocity', [])).toBe('Velocity: no data to chart yet.');
  });
});

describe('bars and totals (5c), as the website’s', () => {
  it('scales each bar to the largest', () => {
    expect(barPct(5, [5, 3, 0])).toBe(100);
    expect(barPct(3, [5, 3, 0])).toBe(60);
    expect(barPct(0, [0, 0])).toBe(0);
  });
  it('adds a series up day by day', () => {
    expect(cumulative([1, 0, 2, 3])).toEqual([1, 1, 3, 6]);
    expect(cumulative([])).toEqual([]);
  });
});

/** The website's charts (components/LineChart.tsx, BarChart.tsx, pages/ReportsPage.tsx): the same rules. */
const webLine = resolve(__dirname, '../../../Web Portal/frontend/src/components/LineChart.tsx');
const webBar = resolve(__dirname, '../../../Web Portal/frontend/src/components/BarChart.tsx');
const webReports = resolve(__dirname, '../../../Web Portal/frontend/src/pages/ReportsPage.tsx');
describe.skipIf(![webLine, webBar, webReports].every(existsSync))('the same as the website', () => {
  it('rounds the scale, draws the grid and thins the day labels alike', () => {
    const src = readFileSync(webLine, 'utf8');
    expect(src).toContain('if (v <= 1) return 1;');
    expect(src).toContain('Math.ceil(v / step) * step');
    expect(src).toContain('[0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: Math.round(top * f)');
    expect(src).toContain('Math.max(1, Math.ceil(n / maxTicks))');
    expect(src).toContain('i % tickEvery === 0 || i === n - 1');
    expect(src).toContain('maxTicks = 6');
    expect(src).toContain('No data to chart yet.');
  });
  it('scales bars to the largest and adds the trend up the same way', () => {
    expect(readFileSync(webBar, 'utf8')).toContain('Math.max(1, ...data.map((d) => d.value))');
    expect(readFileSync(webReports, 'utf8')).toContain('return vals.map((v) => (sum += v));');
  });
});

describe('5c review: dashes, peaks, rows and the axis', () => {
  const total = (segs: { width: number }[]) => segs.reduce((sum, x) => sum + x.width, 0);

  it('a dashed line stays dashed when it is drawn in many short pieces (90 days) — #6', () => {
    // 60 points across 300 px: pieces about 5 px long, shorter than a dash and its gap.
    const values = Array.from({ length: 90 }, (_, i) => 90 - i);
    const segs = lineSegments(values, sampleIndexes(90, 60), { width: 300, height: 160, top: 100 });
    const drawn = total(dashedLine(segs, 5, 4));
    expect(drawn / total(segs)).toBeGreaterThan(0.45);
    expect(drawn / total(segs)).toBeLessThan(0.65);
  });

  it('the dash carries on from one piece into the next', () => {
    // Two pieces of 7 in a row: dash 0–5, gap 5–9, dash 9–14 → the second piece draws 2–7.
    const a = { left: 0, top: 0, width: 7, height: 2, angle: 0 };
    const b = { left: 7, top: 0, width: 7, height: 2, angle: 0 };
    const out = dashedLine([a, b], 5, 4);
    expect(out.map((x) => [Math.round(x.left * 10) / 10, Math.round(x.width * 10) / 10])).toEqual([
      [0, 5],
      [9, 5],
    ]);
  });

  it('keeps each line’s highest and lowest points when it leaves points out — #13', () => {
    const values = Array.from({ length: 365 }, (_, i) => (i === 37 ? 50 : i === 200 ? -3 : 1));
    const idx = sampleWithPeaks(365, 60, [values]);
    expect(idx).toContain(37);
    expect(idx).toContain(200);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(364);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
    expect(sampleWithPeaks(5, 60, [[1, 2, 3, 4, 5]])).toEqual([0, 1, 2, 3, 4]);
  });

  it('each row of the numbers has its own key, the day’s date — #10', () => {
    const rows = chartRows(['1 Jan', '1 Jan'], [{ name: 'Overdue', values: [1, 2] }], ['2025-01-01', '2026-01-01']);
    expect(rows.map((r) => r.key)).toEqual(['2025-01-01', '2026-01-01']);
    expect(chartRows(['a', 'b'], [{ name: 'X', values: [1, 2] }]).map((r) => r.key)).toEqual(['0', '1']);
  });
});

/** The Reports screen and its charts (components): rules from the 5c review that live in the views. */
describe('5c review: the Reports screen and its charts', () => {
  const screen = readFileSync(resolve(__dirname, '../screens/ReportsScreen.tsx'), 'utf8');
  const charts = readFileSync(resolve(__dirname, '../components/charts.tsx'), 'utf8');

  it('the pull-to-refresh spinner shows for a pull only, not for every filter or range change (#12)', () => {
    expect(screen).not.toMatch(/refreshing=\{summaryQ\.isRefetching \|\| trendQ\.isRefetching\}/);
    expect(screen).toMatch(/usePullRefresh\(/);
  });

  it('the plot is drawn left to right on any phone, its values beside it (not under the lines), and kept between keystrokes (#13)', () => {
    expect(charts).toMatch(/export const LineChart = React\.memo\(/);
    expect(charts).not.toMatch(/gridLabel: \{ position: 'absolute', left: 0/);
    expect(charts).toMatch(/sampleWithPeaks\(/);
    expect(charts).toMatch(/dashedLine\(/);
  });

  it('on an Arabic phone too: the plot’s rows and pieces follow the phone’s direction, read once (6b review)', () => {
    // `direction` is an iOS-only style on React Native 0.74: on Android it changed nothing.
    expect(charts).not.toMatch(/direction: 'ltr'/);
    expect(charts).toMatch(/I18nManager\.isRTL/);
    expect(charts).toMatch(/I18nManager\.doLeftAndRightSwapInRTL/);
    expect(charts).toMatch(/placeSegment\(seg, width, dir\)/);
    expect(charts).toMatch(/chartRow\(dir\)/);
    expect(charts).toMatch(/plotLeft\(/);
  });
});

/**
 * 6b review: on a right-to-left phone (Arabic) Android lays a row out from the right and reads a
 * view's `left` from the right edge (React Native swaps left and right; the `direction` style is
 * iOS-only). The chart still reads left to right there (5c review #13): the scale on the left, the
 * first day on the left, each piece of a line where it is on any other phone, at the same slant.
 */
describe('a chart on a right-to-left phone (6b review)', () => {
  const LTR: ChartDirection = { rtl: false, swapsLeft: false };
  const RTL: ChartDirection = { rtl: true, swapsLeft: true };
  const P = 300;
  /** Where Android puts a box with this `left` on the screen, from the plot's left edge. */
  const onScreen = (left: number, width: number, d: ChartDirection) => (d.swapsLeft ? P - left - width : left);
  /** Is a row's first child on the left of the screen? */
  const firstOnLeft = (flexDirection: 'row' | 'row-reverse', d: ChartDirection) => (flexDirection === 'row') !== d.rtl;
  const segs = lineSegments([0, 80, 20, 100], [0, 1, 2, 3], { width: P, height: 160, top: 100 });

  it('each piece of a line sits where it does on any phone, at the same slant', () => {
    for (const d of [LTR, RTL]) {
      const placed = segs.map((s) => placeSegment(s, P, d));
      expect(placed.map((p) => Math.round(onScreen(p.left, p.width, d)))).toEqual(segs.map((s) => Math.round(s.left)));
      // Android turns a view about its centre whatever the direction: the angle stays the line's.
      expect(placed.map((p) => p.transform)).toEqual(segs.map((s) => [{ rotate: `${s.angle}rad` }]));
      expect(placed.map((p) => [p.top, p.width, p.height])).toEqual(segs.map((s) => [s.top, s.width, s.height]));
    }
  });

  it('the last point’s dot and the shaded columns too', () => {
    expect(onScreen(plotLeft(P - 4, 8, P, RTL), 8, RTL)).toBe(P - 4);
    expect(onScreen(plotLeft(0, 25, P, RTL), 25, RTL)).toBe(0);
    expect(plotLeft(10, 5, P, LTR)).toBe(10);
    // A phone told not to swap left and right reads `left` as it is.
    expect(plotLeft(10, 5, P, { rtl: true, swapsLeft: false })).toBe(10);
  });

  it('the scale is on the left of the plot, its values against it, and the first day on the left of the last', () => {
    expect(firstOnLeft(chartRow(RTL), RTL)).toBe(true);
    expect(firstOnLeft(chartRow(LTR), LTR)).toBe(true);
    // A column's flex-start is its right edge on a right-to-left phone.
    const onRight = (align: 'flex-end' | 'flex-start', d: ChartDirection) => (align === 'flex-end') !== d.rtl;
    expect(onRight(alignRight(RTL), RTL)).toBe(true);
    expect(onRight(alignRight(LTR), LTR)).toBe(true);
  });
});
