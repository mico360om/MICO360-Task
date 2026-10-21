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
      { label: '1 Oct', text: 'Remaining 5, Ideal 5' },
      { label: '2 Oct', text: 'Remaining 3, Ideal 0' },
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
