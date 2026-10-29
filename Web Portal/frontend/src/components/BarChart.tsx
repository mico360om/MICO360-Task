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
  /** What the chart shows, e.g. "Tasks by status" — its accessible name. */
  ariaLabel?: string;
  /** The value a full bar stands for (100 for percentages). By default, the largest value. */
  max?: number;
}

/**
 * A dependency-free, fully responsive horizontal bar chart. Each bar sits in a
 * muted track (so partial values read clearly) and scales to the largest value — or to `max`, so
 * percentages are drawn against 100 (8% used to fill the bar when 9% was the largest).
 * Built with flex/CSS rather than a fixed-width SVG, so it never overflows its card.
 *
 * It is a real list: screen readers announce each item as "label: value" (the bar itself is
 * decorative), instead of one opaque image with no numbers.
 */
export function BarChart({ data, unit = '', ariaLabel = 'Bar chart', max: fullAt }: BarChartProps) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-2">No data to chart yet.</p>;
  }
  const max = fullAt && fullAt > 0 ? fullAt : Math.max(1, ...data.map((d) => d.value));

  return (
    <ul className="flex flex-col gap-2.5" aria-label={ariaLabel}>
      {data.map((d) => {
        const pct = Math.min(100, Math.max(0, (d.value / max) * 100));
        return (
          <li key={d.label} className="flex items-center gap-3">
            <span dir="auto" className="w-24 flex-none truncate text-start text-xs font-medium text-ink-2 sm:w-28" title={d.label}>
              {d.label}
            </span>
            <span className="sr-only">: </span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-ground" aria-hidden="true">
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
