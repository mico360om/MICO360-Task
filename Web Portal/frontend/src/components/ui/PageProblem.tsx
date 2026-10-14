import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api-client';
import { Button } from './Button';

/** True when the server said the record is not there (or not visible to this person). */
export function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

export interface PageProblemProps {
  title: string;
  message: string;
  /** Where "back" goes (the list this page belongs to). */
  backTo: string;
  backLabel: string;
  /** Offer "Try again" — for a failed load; a missing record has nothing to retry. */
  onRetry?: () => void;
  retrying?: boolean;
}

/**
 * A whole-page problem on a detail page: the record doesn't exist (deleted, or a mistyped link), or
 * it couldn't be loaded. Replaces the page instead of sitting above an empty shell of it.
 */
export function PageProblem({ title, message, backTo, backLabel, onRetry, retrying }: PageProblemProps) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-2 px-2 py-12 text-center">
      <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-ground text-ink-2">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4.5M12 16h.01" />
        </svg>
      </span>
      <h1 className="font-display text-2xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-ink-2">{message}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <Button onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        ) : null}
        <Link
          to={backTo}
          className="inline-flex items-center rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand/30 hover:bg-ground"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}
