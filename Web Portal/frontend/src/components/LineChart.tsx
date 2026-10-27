import { useEffect, useRef, useState } from 'react';

export interface LineSeries {
  name: string;
  /** CSS colour string (pass theme tokens, e.g. rgb(var(--c-brand))). */
  color: string;
  /** One value per x index — must align with `labels`. null: no value there (a gap in the line). */
  values: (number | null)[];
  /** Fill the area under the line (low opacity). */
  area?: boolean;
  /** Dashed stroke — for reference lines like an ideal burndown. */
  dashed?: boolean;
}

export interface LineChartProps {
  series: LineSeries[];
  /** X-axis labels aligned to value indices. */
  labels: string[];
  ariaLabel: string;
  /** Chart height in px (default 220). */
  height?: number;
  /** Suffix on the y-axis value labels, e.g. "%". */
  unit?: string;
  /** Roughly how many x-axis ticks to show (default 6) — the rest are thinned out. */
  maxTicks?: number;
}

const PAD = { left: 40, right: 16, top: 14, bottom: 26 };
/** A generous width per character of a 10px axis label, and the space kept between two labels. */
const LABEL_CHAR = 6;
const LABEL_GAP = 6;

/** Round a max value up to a clean axis top so gridline labels read nicely. */
function niceCeil(v: number): number {
  if (v <= 1) return 1;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / step) * step;
}

/**
 * A dependency-free, theme-aware, responsive multi-series line chart (SVG). Measures its own
 * width so lines, dots and text stay undistorted at any size; grid + axis colours come from the
 * design tokens so it works in both light and dark themes.
 */
export function LineChart({ series, labels, ariaLabel, height = 220, unit = '', maxTicks = 6 }: LineChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth > 0) setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(labels.length, ...series.map((s) => s.values.length), 0);
  const hasData = series.length > 0 && n > 0 && series.some((s) => s.values.some((v) => v !== null));

  if (!hasData) {
    return (
      <div ref={ref}>
        <p className="py-8 text-center text-sm text-ink-2">No data to chart yet.</p>
      </div>
    );
  }

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);
  const rawMax = Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const top = niceCeil(rawMax);

  const x = (i: number) => (n <= 1 ? PAD.left + plotW / 2 : PAD.left + (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + (1 - v / top) * plotH;
  const baseY = PAD.top + plotH;

  // Horizontal gridlines + y labels (0 .. top in 4 steps).
  const gridRows = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: Math.round(top * f), yy: y(top * f) }));

  // The first and last axis labels sit against their edge, so they are never cut off.
  const anchorOf = (i: number): 'start' | 'middle' | 'end' => (n <= 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
  const tickX = (i: number) => (anchorOf(i) === 'start' ? Math.max(2, x(i) - 6) : anchorOf(i) === 'end' ? Math.min(width - 2, x(i) + 6) : x(i));

  // Thin the x labels so a 30-day axis doesn't collide: about maxTicks of them, the last always shown,
  // and any that would run into the one before it (a narrow chart) left out.
  const tickEvery = Math.max(1, Math.ceil(n / maxTicks));
  const spanOf = ({ label, i }: { label: string; i: number }): [number, number] => {
    const w = label.length * LABEL_CHAR;
    const at = tickX(i);
    const a = anchorOf(i);
    return a === 'start' ? [at, at + w] : a === 'end' ? [at - w, at] : [at - w / 2, at + w / 2];
  };
  const ticks: { label: string; i: number }[] = [];
  for (const t of labels.map((label, i) => ({ label, i })).filter(({ i }) => i % tickEvery === 0 || i === n - 1)) {
    const fits = (prev: { label: string; i: number } | undefined) => !prev || spanOf(prev)[1] + LABEL_GAP <= spanOf(t)[0];
    if (t.i === n - 1) while (ticks.length > 1 && !fits(ticks.at(-1))) ticks.pop();
    else if (!fits(ticks.at(-1))) continue;
    ticks.push(t);
  }

  /** The runs of values without a gap: each is drawn as its own line (a lone value as a dot). */
  const runsOf = (vals: (number | null)[]) => {
    const runs: { i: number; v: number }[][] = [];
    let run: { i: number; v: number }[] = [];
    vals.forEach((v, i) => {
      if (v === null) {
        if (run.length) runs.push(run);
        run = [];
      } else run.push({ i, v });
    });
    if (run.length) runs.push(run);
    return runs;
  };
  const pointsAttr = (run: { i: number; v: number }[]) => run.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const areaPath = (run: { i: number; v: number }[]) =>
    `M ${x(run[0]!.i).toFixed(1)},${baseY.toFixed(1)} ` + run.map((p) => `L ${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ') + ` L ${x(run.at(-1)!.i).toFixed(1)},${baseY.toFixed(1)} Z`;
  return (
    <div ref={ref} className="w-full">
      <svg role="img" aria-label={ariaLabel} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block w-full">
        {/* gridlines + y labels */}
        {gridRows.map((g, idx) => (
          <g key={idx}>
            <line x1={PAD.left} y1={g.yy} x2={width - PAD.right} y2={g.yy} stroke="rgb(var(--c-line))" strokeWidth={1} />
            <text x={PAD.left - 6} y={g.yy + 3} textAnchor="end" fontSize={10} fill="rgb(var(--c-ink-3))">
              {g.v}
              {unit}
            </text>
          </g>
        ))}

        {/* series: optional area, then line, then endpoint dot; a series with gaps gets a dot on every value */}
        {series.map((s) => {
          const runs = runsOf(s.values);
          const gaps = s.values.some((v) => v === null);
          const last = runs.at(-1)?.at(-1);
          return (
            <g key={s.name}>
              {s.area ? runs.filter((r) => r.length > 1).map((r) => <path key={`a${r[0]!.i}`} d={areaPath(r)} fill={s.color} opacity={0.1} />) : null}
              {runs
                .filter((r) => r.length > 1)
                .map((r) => (
                  <polyline
                    key={`l${r[0]!.i}`}
                    points={pointsAttr(r)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    {...(s.dashed ? { strokeDasharray: '5 4' } : {})}
                  />
                ))}
              {gaps
                ? runs.flat().map((p) => <circle key={`p${p.i}`} data-point cx={x(p.i)} cy={y(p.v)} r={3} fill={s.color} />)
                : !s.dashed && last
                  ? <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill={s.color} />
                  : null}
            </g>
          );
        })}

        {/* x tick labels */}
        {ticks.map(({ label, i }) => (
          <text key={i} x={tickX(i)} y={height - 8} textAnchor={anchorOf(i)} fontSize={10} fill="rgb(var(--c-ink-3))">
            {label}
          </text>
        ))}
      </svg>

      {/* legend */}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className="inline-block h-2.5 w-2.5 flex-none rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
