import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'info' | 'danger';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-ground text-ink-2',
  brand: 'bg-brand/10 text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  danger: 'bg-danger-soft text-danger',
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Show a leading status dot in the tone colour. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

/** A small, theme-aware status pill using the app's semantic colour tokens. */
export function Badge({ tone = 'neutral', dot = false, className = '', children }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONE[tone]} ${className}`}
    >
      {dot ? <span className="h-1.5 w-1.5 flex-none rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
