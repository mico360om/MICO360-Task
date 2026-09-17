import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Optional icon (an SVG element); a default folder-ish glyph is used when omitted. */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Optional call-to-action (e.g. a button/link). */
  action?: ReactNode;
  /** Render inside a bordered card (default) or bare, for use inside an existing card. */
  bare?: boolean;
}

const DefaultIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

/** A friendly, consistent empty state: icon, title, optional description and action. */
export function EmptyState({ icon, title, description, action, bare = false }: EmptyStateProps) {
  return (
    <div className={`grid place-items-center gap-2 p-10 text-center ${bare ? '' : 'card'}`}>
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
        {icon ?? DefaultIcon}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-2">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
