import { describe, it, expect, vi } from 'vitest';
import { createConsoleReporter, createSentryReporter, noopReporter, pickCrashReporter } from './error-reporter';

describe('crash reporter (A9)', () => {
  it('console reporter forwards the error and context to the logger', () => {
    const error = vi.fn();
    const reporter = createConsoleReporter({ error });
    const err = new Error('boom');
    reporter.captureException(err, { screen: 'Board' });
    expect(error).toHaveBeenCalledWith('[crash]', err, { screen: 'Board' });
  });

  it('console reporter tolerates a missing context', () => {
    const error = vi.fn();
    createConsoleReporter({ error }).captureException(new Error('x'));
    expect(error).toHaveBeenCalledWith('[crash]', expect.any(Error), undefined);
  });

  it('noop reporter never throws', () => {
    expect(() => noopReporter.captureException(new Error('x'), { a: 1 })).not.toThrow();
  });
});

describe('createSentryReporter', () => {
  it('forwards the error to Sentry, wrapping context as extra', () => {
    const client = { captureException: vi.fn() };
    const err = new Error('boom');
    createSentryReporter(client).captureException(err, { screen: 'Board' });
    expect(client.captureException).toHaveBeenCalledWith(err, { extra: { screen: 'Board' } });
  });

  it('passes no hint when there is no context', () => {
    const client = { captureException: vi.fn() };
    createSentryReporter(client).captureException(new Error('x'));
    expect(client.captureException).toHaveBeenCalledWith(expect.any(Error), undefined);
  });
});

describe('pickCrashReporter', () => {
  const sentry = { captureException: vi.fn() };
  const console = createConsoleReporter({ error: vi.fn() });

  it('uses Sentry only in a production build with a DSN and an initialized client', () => {
    expect(pickCrashReporter({ isDev: false, dsn: 'https://x@sentry.io/1', sentry, console })).toBe(sentry);
  });

  it('uses the console reporter in development regardless of DSN', () => {
    expect(pickCrashReporter({ isDev: true, dsn: 'https://x@sentry.io/1', sentry, console })).toBe(console);
  });

  it('falls back to no-op in production when the DSN is missing/blank', () => {
    expect(pickCrashReporter({ isDev: false, dsn: '', sentry, console })).toBe(noopReporter);
    expect(pickCrashReporter({ isDev: false, dsn: '   ', sentry, console })).toBe(noopReporter);
    expect(pickCrashReporter({ isDev: false, dsn: undefined, sentry, console })).toBe(noopReporter);
  });

  it('falls back to no-op in production when the Sentry client failed to initialize', () => {
    expect(pickCrashReporter({ isDev: false, dsn: 'https://x@sentry.io/1', sentry: null, console })).toBe(noopReporter);
  });
});
