export interface LoadErrorProps {
  /** What failed to load, as it reads after "Couldn’t load": "your tasks", "the board". */
  what: string;
  /** Offer "Retry" (re-run the failed request). */
  onRetry?: () => void;
  className?: string;
}

/**
 * The inline "couldn't load" message every page uses: announced to screen readers, worded for the
 * person using the app (not "is the API running?"), with a Retry wherever the load can be re-run.
 */
export function LoadError({ what, onRetry, className = '' }: LoadErrorProps) {
  return (
    <p role="alert" className={`text-sm text-danger ${className}`.trim()}>
      Couldn’t load {what}.{' '}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Retry
        </button>
      ) : null}
    </p>
  );
}
