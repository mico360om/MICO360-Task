import { describe, it, expect, vi } from 'vitest';
import { createErrorReporter } from './error-reporter';

describe('createErrorReporter', () => {
  it('is a no-op when no DSN is configured', () => {
    const onReport = vi.fn();
    const r = createErrorReporter({ onReport });
    r.captureException(new Error('x'));
    expect(onReport).not.toHaveBeenCalled();
  });

  it('reports when a DSN is set', () => {
    const onReport = vi.fn();
    const r = createErrorReporter({ dsn: 'https://key@sentry.example/1', onReport });
    const err = new Error('boom');
    r.captureException(err, { url: '/x' });
    expect(onReport).toHaveBeenCalledWith(err, { url: '/x' });
  });
});
