import * as Sentry from '@sentry/react-native';
import { createSentryReporter, type CrashReporter } from '../lib/error-reporter';

/**
 * Native crash/analytics glue (A9.3). Initializes the Sentry SDK once with the build's DSN and
 * returns a `CrashReporter` bound to it. Only called for production-flavor builds that have a DSN
 * configured (see App.tsx / pickCrashReporter), so dev and DSN-less builds never touch the SDK.
 * Thin, framework-bound wrapper — the mappable logic lives in the tested `createSentryReporter`.
 */
export function initSentry(dsn: string, opts: { environment: string; release?: string }): CrashReporter {
  Sentry.init({
    dsn,
    environment: opts.environment,
    ...(opts.release ? { release: opts.release } : {}),
    // Crash + error reporting only — no performance tracing until it's explicitly turned on.
    tracesSampleRate: 0,
    enableAutoSessionTracking: true,
  });
  return createSentryReporter(Sentry);
}
