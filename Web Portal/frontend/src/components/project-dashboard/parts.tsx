import type { ReactNode } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-11-03' → '3 Nov 2026' (a calendar day, never shifted by a time zone). */
export function dayText(key: string | null | undefined): string {
  if (!key || !/^\d{4}-\d{2}-\d{2}/.test(key)) return '—';
  return `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/** "today", "tomorrow", "in 3 days", "yesterday", "4 days ago". */
export function relativeDays(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** A dashboard card with a heading (its accessible name) and an optional action on the right. */
export function SectionCard({ id, title, action, children, className = '' }: { id: string; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`card min-w-0 p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="eyebrow">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-ground/60 px-3 py-3 text-sm text-ink-2">{children}</p>;
}

const BAR_TONE = { brand: 'bg-brand', success: 'bg-success', danger: 'bg-danger', info: 'bg-info', warning: 'bg-warning' } as const;

/** A thin progress bar (0–100), with its value for screen readers. */
export function ProgressBar({ value, label, tone = 'brand', className = '' }: { value: number; label: string; tone?: keyof typeof BAR_TONE; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} className={`h-2 overflow-hidden rounded-full bg-ground ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${BAR_TONE[tone]}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/** A small text button styled as a link (opens a tab, a filter…). */
export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="tap text-xs font-semibold text-brand hover:underline">
      {children}
    </button>
  );
}

export const FlagIcon = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
    <path d="M5 21V4" />
    <path d="M5 4h11l-2 4 2 4H5" fill="currentColor" fillOpacity="0.18" />
  </svg>
);

export const RepeatIcon = ({ size = 13 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
    <path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" />
  </svg>
);
