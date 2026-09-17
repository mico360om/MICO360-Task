export interface BarDatum {
  label: string;
  value: number;
  /** Optional bar colour (CSS colour string). Defaults to the brand colour. */
  color?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Suffix appended to each value label, e.g. "%". */
  unit?: string;
}

/**
 * A dependency-free, fully responsive horizontal bar chart. Each bar sits in a
 * muted track (so partial values read clearly) and scales to the largest value.
 * Built with flex/CSS rather than a fixed-width SVG, so it never overflows its card.
 */
export function BarChart({ data, unit = '' }: BarChartProps) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-2">No data to chart yet.</p>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <ul className="flex flex-col gap-2.5" role="img" aria-label="Bar chart">
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        return (
          <li key={d.label} className="flex items-center gap-3">
            <span className="w-24 flex-none truncate text-xs font-medium text-ink-2 sm:w-28" title={d.label}>
              {d.label}
            </span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-ground">
              <span
                data-bar
                className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out ${d.color ? '' : 'bg-brand'}`}
                style={{ width: `${pct}%`, ...(d.color ? { background: d.color } : {}) }}
              />
            </span>
            <span className="w-11 flex-none text-right text-xs font-semibold tabular-nums text-ink">
              {d.value}
              {unit}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
