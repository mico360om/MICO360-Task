export interface ErrorReporter {
  captureException(err: unknown, context?: Record<string, unknown>): void;
}

export const noopErrorReporter: ErrorReporter = { captureException() {} };

export interface ErrorReporterOptions {
  dsn?: string;
  /** Called when an error is reported (used to observe/forward in lieu of a vendor SDK). */
  onReport?: (err: unknown, context?: Record<string, unknown>) => void;
}

/**
 * Vendor-agnostic error-tracking seam (T19.2). With no DSN it's a no-op. In
 * production set SENTRY_DSN and initialise the Sentry SDK inside `onReport`
 * (e.g. `Sentry.captureException`) — the rest of the app stays vendor-agnostic.
 */
export function createErrorReporter({ dsn, onReport }: ErrorReporterOptions): ErrorReporter {
  if (!dsn) return noopErrorReporter;
  return {
    captureException(err, context) {
      onReport?.(err, context);
    },
  };
}
