/**
 * Pluggable crash/error reporting seam (A9), mirroring the backend's `errorReporter`.
 * Ships with a no-op default, a dev console reporter, and a Sentry adapter. The concrete sink is
 * chosen by `pickCrashReporter` and the native Sentry client is wired in `adapters/sentry.ts`, so
 * call sites (ErrorBoundary etc.) never change.
 */
export interface CrashReporter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
}

export const noopReporter: CrashReporter = {
  captureException() {
    /* swallow — production default until a real sink (DSN) is configured */
  },
};

export function createConsoleReporter(logger: Pick<Console, 'error'> = console): CrashReporter {
  return {
    captureException(error, context) {
      logger.error('[crash]', error, context);
    },
  };
}

/** The slice of the Sentry SDK the reporter needs — keeps the adapter unit-testable with a mock. */
export interface SentryLike {
  captureException(error: unknown, hint?: { extra?: Record<string, unknown> }): void;
}

/** Adapt a Sentry client to the CrashReporter seam (context becomes Sentry `extra`). */
export function createSentryReporter(client: SentryLike): CrashReporter {
  return {
    captureException(error, context) {
      client.captureException(error, context ? { extra: context } : undefined);
    },
  };
}

/**
 * Choose the crash sink for the current build: production with a configured DSN + an initialized
 * Sentry reporter → Sentry; any dev build → the console; production without a DSN → no-op (silent
 * until ops sets EXPO_PUBLIC_SENTRY_DSN). Pure so the wiring is unit-testable.
 */
export function pickCrashReporter(opts: {
  isDev: boolean;
  dsn?: string | null;
  sentry?: CrashReporter | null;
  console?: CrashReporter;
}): CrashReporter {
  const dsn = (opts.dsn ?? '').trim();
  if (!opts.isDev && dsn && opts.sentry) return opts.sentry;
  if (opts.isDev) return opts.console ?? createConsoleReporter();
  return noopReporter;
}
