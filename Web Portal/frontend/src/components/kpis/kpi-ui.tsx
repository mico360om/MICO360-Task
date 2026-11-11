import { useId } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { KpiLight, KpiPeriodAsk, KpiTile, PeriodKind, TrendPoint } from '../../api/kpis';
import { HEALTH_CLASS } from '../../lib/colour-classes';
import { formatKpiTarget, formatKpiValue } from '../../lib/kpi-format';
import { TOUCH_TALL } from '../../lib/touch';

/**
 * Project KPIs and User KPIs — the shared pieces: a KPI's light (always with its words), its sparkline,
 * the period picker (this month by default; week, quarter or a custom range — kept in the address), and
 * one KPI as a tile that opens the list behind its number.
 */

/** A light's look: the one colour scheme's health tones (on target = on track, close = at risk, off = late). */
export const LIGHT_LOOK: Record<KpiLight, { chip: string; dot: string; text: string; stroke: string }> = {
  green: { chip: HEALTH_CLASS.ON_TRACK.chip, dot: HEALTH_CLASS.ON_TRACK.dot, text: HEALTH_CLASS.ON_TRACK.text, stroke: HEALTH_CLASS.ON_TRACK.text },
  amber: { chip: HEALTH_CLASS.AT_RISK.chip, dot: HEALTH_CLASS.AT_RISK.dot, text: HEALTH_CLASS.AT_RISK.text, stroke: HEALTH_CLASS.AT_RISK.text },
  red: { chip: HEALTH_CLASS.LATE.chip, dot: HEALTH_CLASS.LATE.dot, text: HEALTH_CLASS.LATE.text, stroke: HEALTH_CLASS.LATE.text },
  none: { chip: 'bg-ground text-ink-2', dot: 'bg-ink-3', text: 'text-ink-2', stroke: 'text-ink-3' },
  nodata: { chip: 'bg-ground text-ink-3', dot: 'bg-line', text: 'text-ink-3', stroke: 'text-ink-3' },
};

/** A light as a word with a dot ("On target"): never colour alone. */
export function LightMark({ light, words, className = '' }: { light: KpiLight; words: string; className?: string }) {
  if (!words) return null;
  const look = LIGHT_LOOK[light];
  return (
    <span data-light={light} className={`inline-flex flex-none items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${look.chip} ${className}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${look.dot}`} />
      {words}
    </span>
  );
}

export const kpiValue = (t: Pick<KpiTile, 'metric' | 'unit' | 'value'>) => formatKpiValue(t.metric, t.unit, t.value);
export const kpiTarget = (t: Pick<KpiTile, 'metric' | 'unit' | 'direction' | 'target'>) => formatKpiTarget(t.metric, t.unit, t.direction, t.target);

/** The trend as a small line (points with no figure are gaps); described for screen readers by the caller. */
export function Sparkline({ values, light, className = '' }: { values: (number | null)[]; light: KpiLight; className?: string }) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return <span className={`block h-8 ${className}`} aria-hidden="true" />;
  const w = 120;
  const h = 32;
  const pad = 3;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const x = (i: number) => pad + (values.length === 1 ? (w - pad * 2) / 2 : (i * (w - pad * 2)) / (values.length - 1));
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const segments: string[] = [];
  let current = '';
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
  });
  if (current) segments.push(current);
  const lastIndex = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).at(-1)!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-8 w-full ${LIGHT_LOOK[light].stroke} ${className}`} aria-hidden="true" preserveAspectRatio="none">
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
      <circle cx={x(lastIndex)} cy={y(values[lastIndex]!)} r="2.5" fill="currentColor" />
    </svg>
  );
}

/** "Trend: Jun 80%, Jul —, … Nov 85% (this month)" for a screen reader. */
export function trendWords(t: Pick<KpiTile, 'metric' | 'unit' | 'trend'>, points: TrendPoint[]): string {
  return `Trend: ${points.map((p, i) => `${p.label} ${t.trend[i] === null || t.trend[i] === undefined ? 'no figure' : formatKpiValue(t.metric, t.unit, t.trend[i]!)}`).join(', ')}`;
}

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'week', label: 'Week' },
  { kind: 'month', label: 'Month' },
  { kind: 'quarter', label: 'Quarter' },
  { kind: 'custom', label: 'Custom' },
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The period in the address (?period=…&from=…&to=…); this month when none. */
export function usePeriodParam(): [KpiPeriodAsk, (p: KpiPeriodAsk) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('period');
  const kind: PeriodKind = raw === 'week' || raw === 'quarter' || raw === 'custom' ? raw : 'month';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const ask: KpiPeriodAsk = kind === 'custom' && DAY.test(from) && DAY.test(to) ? { kind, from, to } : kind === 'custom' ? { kind: 'month' } : { kind };
  const set = (p: KpiPeriodAsk) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (p.kind === 'month') next.delete('period');
        else next.set('period', p.kind);
        if (p.kind === 'custom' && p.from && p.to) {
          next.set('from', p.from);
          next.set('to', p.to);
        } else {
          next.delete('from');
          next.delete('to');
        }
        return next;
      },
      { replace: true },
    );
  return [ask, set];
}

/** Week / Month / Quarter / Custom (with two days), as one group of buttons. */
export function PeriodPicker({ value, onChange, today, customOpen, onCustomOpen }: { value: KpiPeriodAsk; onChange: (p: KpiPeriodAsk) => void; today: string; customOpen: boolean; onCustomOpen: (open: boolean) => void }) {
  const id = useId();
  const showCustom = customOpen || value.kind === 'custom';
  const monthStart = `${today.slice(0, 7)}-01`;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
        {KINDS.map((k) => {
          const on = k.kind === 'custom' ? showCustom : value.kind === k.kind && !customOpen;
          return (
            <button
              key={k.kind}
              type="button"
              aria-pressed={on}
              onClick={() => {
                if (k.kind === 'custom') onCustomOpen(true);
                else {
                  onCustomOpen(false);
                  onChange({ kind: k.kind });
                }
              }}
              className={`rounded-md px-3 py-1 text-sm font-medium ${TOUCH_TALL} ${on ? 'bg-brand text-white' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
            >
              {k.label}
            </button>
          );
        })}
      </div>
      {showCustom ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const from = String(f.get('from') ?? '');
            const to = String(f.get('to') ?? '');
            if (DAY.test(from) && DAY.test(to)) onChange({ kind: 'custom', from: from <= to ? from : to, to: from <= to ? to : from });
          }}
        >
          <label className="flex flex-col gap-0.5 text-xs font-medium text-ink-2" htmlFor={`${id}-from`}>
            From
            <input id={`${id}-from`} name="from" type="date" max={today} defaultValue={value.kind === 'custom' ? value.from : monthStart} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink [@media(pointer:coarse)]:!min-h-11" />
          </label>
          <label className="flex flex-col gap-0.5 text-xs font-medium text-ink-2" htmlFor={`${id}-to`}>
            To
            <input id={`${id}-to`} name="to" type="date" defaultValue={value.kind === 'custom' ? value.to : today} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink [@media(pointer:coarse)]:!min-h-11" />
          </label>
          <button type="submit" className={`rounded-lg border border-line bg-surface px-3 py-1 text-sm font-semibold text-ink hover:bg-ground ${TOUCH_TALL}`}>
            Show
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** One KPI: its figure, light in words, target, the facts behind it and its trend; a button when a list is behind it. */
export function KpiTileCard({ tile, points, onOpen }: { tile: KpiTile; points: TrendPoint[]; onOpen?: (tile: KpiTile, from: HTMLElement) => void }) {
  const value = kpiValue(tile);
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{tile.label}</span>
        <LightMark light={tile.light} words={tile.words} />
      </span>
      <span className={`mt-1 block font-display text-2xl font-bold tabular-nums ${tile.value === null ? 'text-ink-3' : 'text-ink'}`}>{value}</span>
      <span className="block text-xs text-ink-2">{tile.target !== null || tile.targetSource !== 'default' || tile.light !== 'none' ? `Target: ${kpiTarget(tile)}` : tile.help}</span>
      {tile.detail ? <span className="mt-0.5 block text-xs text-ink-2">{tile.detail}</span> : null}
      <span className="mt-2 block" title={trendWords(tile, points)}>
        <Sparkline values={tile.trend} light={tile.light === 'none' || tile.light === 'nodata' ? 'none' : tile.light} />
        <span className="sr-only">{trendWords(tile, points)}</span>
      </span>
    </>
  );
  const cls = 'card flex h-full min-w-0 flex-col p-4 text-start';
  if (tile.list && onOpen) {
    return (
      <button type="button" data-kpi={tile.metric} className={`${cls} transition-shadow hover:shadow-lift focus-visible:ring-2 focus-visible:ring-brand/40`} onClick={(e) => onOpen(tile, e.currentTarget)} aria-label={`${tile.label}: ${value}${tile.words ? `, ${tile.words}` : ''}. Show the list`}>
        {body}
      </button>
    );
  }
  return (
    <div data-kpi={tile.metric} className={cls}>
      {body}
    </div>
  );
}

/** The trend's labels under the grid, with "rebuilt" explained when some months were worked out from history. */
export function TrendNote({ kind, points }: { kind: 'month' | 'week'; points: TrendPoint[] }) {
  const rebuilt = points.filter((p) => p.rebuilt);
  return (
    <p className="mt-2 text-xs text-ink-2">
      Lines show the {kind === 'week' ? 'last 12 weeks' : 'last 6 months'} ({points[0]?.label} – {points.at(-1)?.label}, the last one so far).
      {rebuilt.length ? ` ${rebuilt.map((p) => p.label).join(', ')} ${rebuilt.length === 1 ? 'was' : 'were'} worked out from task dates and history when the KPIs started.` : ''}
    </p>
  );
}
