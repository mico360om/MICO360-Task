import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

type Tone = 'brand' | 'success' | 'warning' | 'info' | 'danger';

export interface StatTileProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: Tone;
}

const TONE: Record<Tone, { bubble: string; text: string }> = {
  brand: { bubble: 'bg-brand/10 text-brand', text: 'text-brand' },
  success: { bubble: 'bg-success-soft text-success', text: 'text-success' },
  warning: { bubble: 'bg-warning-soft text-warning', text: 'text-warning' },
  info: { bubble: 'bg-info-soft text-info', text: 'text-info' },
  danger: { bubble: 'bg-danger-soft text-danger', text: 'text-danger' },
};

/** Counts a number up from 0 on mount; passes strings ("—") straight through. */
function useCountUp(value: string | number) {
  const [display, setDisplay] = useState<string | number>(typeof value === 'number' ? 0 : value);
  const raf = useRef<number>();
  useEffect(() => {
    if (typeof value !== 'number') {
      setDisplay(value);
      return;
    }
    // Animate only in a real browser that reports motion preferences; otherwise
    // (tests/SSR) show the final value immediately so it's readable at once.
    const canAnimate =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      typeof requestAnimationFrame !== 'undefined';
    if (!canAnimate) {
      setDisplay(value);
      return;
    }
    const from = 0;
    const duration = 700;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value]);
  return display;
}

export function StatTile({ label, value, hint, icon, tone = 'brand' }: StatTileProps) {
  const display = useCountUp(value);
  const t = TONE[tone];
  return (
    <div className="card card-hover group relative overflow-hidden p-4">
      <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-brand/5 blur-2xl transition-opacity duration-300 group-hover:opacity-80" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-3xl font-extrabold tracking-tightish text-ink">{display}</div>
          <div className="eyebrow mt-1">{label}</div>
          {hint ? <div className="mt-1 text-xs text-ink-2">{hint}</div> : null}
        </div>
        {icon ? (
          <span className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${t.bubble}`}>{icon}</span>
        ) : null}
      </div>
    </div>
  );
}
