import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTruncated } from '../../lib/useTruncated';

export interface Crumb {
  label: ReactNode;
  /** Where it leads; the last crumb (this page) has none. */
  to?: string;
}

/**
 * Where a page sits: "Meetings › Weekly sync". One small line; the current page is the last crumb,
 * cut short with an ellipsis when long, and anything after it (a status, say) sits on the same line.
 */
export function Breadcrumbs({ items, children, className = '' }: { items: Crumb[]; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      <nav aria-label="Breadcrumb" className="min-w-0 max-w-full">
        <ol className="flex min-w-0 items-center gap-1 text-xs font-medium text-ink-3">
          {items.map((c, i) => {
            const last = i === items.length - 1;
            return (
              <li key={i} className={`flex min-w-0 items-center gap-1 ${last ? 'truncate' : 'flex-none'}`}>
                {c.to && !last ? (
                  <Link to={c.to} className="tap rounded hover:text-brand hover:underline">
                    {c.label}
                  </Link>
                ) : last ? (
                  <CurrentCrumb label={c.label} />
                ) : (
                  <span>{c.label}</span>
                )}
                {!last ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none rtl:rotate-180">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>
      {children}
    </div>
  );
}

/** This page's crumb: cut short with an ellipsis when long, and then its whole name on hover. */
function CurrentCrumb({ label }: { label: ReactNode }) {
  const [ref, cut] = useTruncated<HTMLSpanElement>(label);
  return (
    <span ref={ref} aria-current="page" title={cut && typeof label === 'string' ? label : undefined} className="truncate text-ink-2">
      {label}
    </span>
  );
}
