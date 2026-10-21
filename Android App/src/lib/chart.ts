/**
 * The Reports charts (5c), drawn with plain React Native views: the app has no chart or SVG
 * package. Bars are views whose width is their share of the largest; a line is thin views, one per
 * piece between two points, each turned to its angle. The scale, grid and day labels follow the
 * website's charts (components/LineChart.tsx and BarChart.tsx), and every chart can be read in words
 * (TalkBack): a summary of each line and a table of the numbers. Pure, so it is tested here.
 */

/** Round a largest value up to a clean top for the scale (the website's niceCeil). */
export function niceCeil(v: number): number {
  if (v <= 1) return 1;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / step) * step;
}

/** The five grid lines' values, 0 to the top. */
export function gridValues(top: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
}

/** Which days get a label under the chart: about `maxTicks` of them, always the last. */
export function tickIndexes(n: number, maxTicks = 6): number[] {
  const every = Math.max(1, Math.ceil(n / maxTicks));
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) if (i % every === 0 || i === n - 1) out.push(i);
  return out;
}

/**
 * At most `max` of `n` points to draw, evenly spread, the first and last always: a year of days
 * would otherwise be hundreds of views per line. The numbers table still lists every day.
 */
export function sampleIndexes(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (let i = 0; i < max; i += 1) out.add(Math.round((i * (n - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}

/** One thin view of a line: placed by its top-left corner, `width` long, turned by `angle` (radians) about its centre. */
export interface Segment {
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
}

/**
 * The pieces of one line through `values` (only the points at `indexes` are drawn), in a plot area
 * `width` × `height` whose scale tops out at `top`. One point is a dot in its place.
 */
export function lineSegments(
  values: readonly number[],
  indexes: readonly number[],
  { width, height, top, thickness = 2 }: { width: number; height: number; top: number; thickness?: number },
): Segment[] {
  const n = values.length;
  if (n === 0 || indexes.length === 0) return [];
  const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (v: number) => (1 - (Number.isFinite(v) ? v : 0) / top) * height;
  const pts = indexes.map((i) => ({ x: x(i), y: y(values[i] ?? 0) }));
  if (pts.length === 1) return [{ left: pts[0]!.x - thickness / 2, top: pts[0]!.y - thickness / 2, width: thickness, height: thickness, angle: 0 }];
  const out: Segment[] = [];
  for (let k = 1; k < pts.length; k += 1) {
    const a = pts[k - 1]!;
    const b = pts[k]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    out.push({ left: cx - len / 2, top: cy - thickness / 2, width: len, height: thickness, angle: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  return out;
}

/** A piece cut into dashes (`dash` long, `gap` apart) along its own direction. */
export function dashed(seg: Segment, dash = 5, gap = 4): Segment[] {
  const cos = Math.cos(seg.angle);
  const sin = Math.sin(seg.angle);
  const cx = seg.left + seg.width / 2;
  const cy = seg.top + seg.height / 2;
  const sx = cx - (seg.width / 2) * cos;
  const sy = cy - (seg.width / 2) * sin;
  const out: Segment[] = [];
  for (let s = 0; s < seg.width; s += dash + gap) {
    const len = Math.min(dash, seg.width - s);
    if (len < 0.5) break; // a sliver left over at the end isn't worth a view
    const mx = sx + (s + len / 2) * cos;
    const my = sy + (s + len / 2) * sin;
    out.push({ left: mx - len / 2, top: my - seg.height / 2, width: len, height: seg.height, angle: seg.angle });
  }
  return out;
}

/**
 * How the phone lays a chart out (6b review). Charts read left to right on every phone (5c review
 * #13), but on a right-to-left phone (Arabic) Android lays a row out from the right and reads a
 * view's `left` from the right edge — React Native swaps left and right there, and its `direction`
 * style is iOS-only. The helpers below undo both, so a piece lands where it does on any other phone;
 * Android turns a view about its centre whatever the direction, so its angle stays as it is.
 */
export interface ChartDirection {
  /** Rows are laid out right to left (React Native's I18nManager.isRTL). */
  rtl: boolean;
  /** …and a view's `left` is read from the right edge (I18nManager.doLeftAndRightSwapInRTL, on by default). */
  swapsLeft: boolean;
}

/** A row of the chart whose first child is on the left, on any phone. */
export function chartRow(d: ChartDirection): 'row' | 'row-reverse' {
  return d.rtl ? 'row-reverse' : 'row';
}

/** In a column of the chart, its children against the right edge (the scale's values next to the plot), on any phone. */
export function alignRight(d: ChartDirection): 'flex-end' | 'flex-start' {
  return d.rtl ? 'flex-start' : 'flex-end';
}

/** The `left` that puts a box `width` wide at `left` from the plot's left edge, on any phone. */
export function plotLeft(left: number, width: number, plotWidth: number, d: ChartDirection): number {
  return d.swapsLeft ? plotWidth - left - width : left;
}

/** Where a piece goes: placed by its corner, then turned about its centre. */
export function placeSegment(seg: Segment, plotWidth: number, d: ChartDirection) {
  return { left: plotLeft(seg.left, seg.width, plotWidth, d), top: seg.top, width: seg.width, height: seg.height, transform: [{ rotate: `${seg.angle}rad` }] };
}

/** A bar's width as a share (0–100) of the largest value (the website's bar chart). */
export function barPct(value: number, values: readonly number[]): number {
  const max = Math.max(1, ...values);
  return (Math.max(0, value) / max) * 100;
}

/** A series added up day by day (the website's cumulative trend). */
export function cumulative(vals: readonly number[]): number[] {
  let sum = 0;
  return vals.map((v) => (sum += v));
}

export interface ChartSeries {
  name: string;
  values: number[];
}

const hasData = (labels: readonly string[], series: readonly ChartSeries[]) => labels.length > 0 && series.some((s) => s.values.length > 0);

/** A line chart in words: each line where it starts, where it ends and its highest. */
export function chartSummary(title: string, labels: readonly string[], series: readonly ChartSeries[]): string {
  if (!hasData(labels, series)) return `${title}: no data to chart yet.`;
  const first = labels[0]!;
  const last = labels[labels.length - 1]!;
  if (labels.length === 1) return `${title}, ${first}. ${series.map((s) => `${s.name}: ${s.values[0] ?? 0}.`).join(' ')}`;
  const lines = series.map((s) => {
    const v0 = s.values[0] ?? 0;
    const vn = s.values[s.values.length - 1] ?? 0;
    return `${s.name}: ${v0} on ${first}, ${vn} on ${last}, highest ${Math.max(0, ...s.values)}.`;
  });
  return `${title}, ${first} to ${last}. ${lines.join(' ')}`;
}

/**
 * The numbers under a chart, one row per day: "Remaining 5, Ideal 5". Each row's key is its day's
 * date (`keys`), never its label: "1 Jan" can be two days a year apart (5c review #10).
 */
export function chartRows(labels: readonly string[], series: readonly ChartSeries[], keys?: readonly string[]): { key: string; label: string; text: string }[] {
  return labels.map((label, i) => ({ key: keys?.[i] ?? String(i), label, text: series.map((s) => `${s.name} ${s.values[i] ?? 0}`).join(', ') }));
}

/** A bar chart in words: "Tasks by status: To do 5, Done 3." */
export function barsSummary(title: string, data: readonly { label: string; value: number }[]): string {
  if (data.length === 0) return `${title}: no data to chart yet.`;
  return `${title}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}.`;
}

/**
 * A line's pieces cut into one run of dashes (`dash` long, `gap` apart): the pattern carries on from
 * one piece into the next, so a line drawn in many short pieces (a long range) still looks dashed —
 * cutting each piece on its own restarts a dash on every piece (5c review #6).
 */
export function dashedLine(segs: readonly Segment[], dash = 5, gap = 4): Segment[] {
  const period = dash + gap;
  const out: Segment[] = [];
  let phase = 0;
  for (const seg of segs) {
    const cos = Math.cos(seg.angle);
    const sin = Math.sin(seg.angle);
    const sx = seg.left + seg.width / 2 - (seg.width / 2) * cos;
    const sy = seg.top + seg.height / 2 - (seg.width / 2) * sin;
    let s = 0;
    while (s < seg.width) {
      const p = (phase + s) % period;
      if (p < dash) {
        const len = Math.min(dash - p, seg.width - s);
        if (len >= 0.5) {
          const mx = sx + (s + len / 2) * cos;
          const my = sy + (s + len / 2) * sin;
          out.push({ left: mx - len / 2, top: my - seg.height / 2, width: len, height: seg.height, angle: seg.angle });
        }
        s += len;
      } else {
        s += period - p;
      }
    }
    phase = (phase + seg.width) % period;
  }
  return out;
}

/**
 * The points to draw (sampleIndexes), with each line's highest and lowest kept: leaving them out
 * would hide a spike the summary still names ("highest 50") — 5c review #13.
 */
export function sampleWithPeaks(n: number, max: number, valueLists: readonly (readonly number[])[]): number[] {
  const out = new Set(sampleIndexes(n, max));
  if (out.size < n) {
    for (const values of valueLists) {
      let hi = -1;
      let lo = -1;
      for (let i = 0; i < Math.min(n, values.length); i += 1) {
        const v = values[i] ?? 0;
        if (hi < 0 || v > (values[hi] ?? 0)) hi = i;
        if (lo < 0 || v < (values[lo] ?? 0)) lo = i;
      }
      if (hi >= 0) out.add(hi);
      if (lo >= 0) out.add(lo);
    }
  }
  return [...out].sort((a, b) => a - b);
}
