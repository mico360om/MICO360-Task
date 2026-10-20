import { describe, it, expect, vi } from 'vitest';
import { refreshWithRetry } from './refresh-retry';

type Outcome = 'ok' | 'invalid' | 'transient';
const sequence = (...outcomes: Outcome[]) => vi.fn(async () => outcomes.shift() ?? 'transient');

describe('refreshWithRetry — a lost refresh reply is tried again', () => {
  it('a transient failure is retried once after 1.5 s, and its ok is returned', async () => {
    const attempt = sequence('transient', 'ok');
    const sleep = vi.fn(async () => {});
    expect(await refreshWithRetry(attempt, { sleep })).toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it('invalid is never retried (the server said no)', async () => {
    const attempt = sequence('invalid', 'ok');
    const sleep = vi.fn(async () => {});
    expect(await refreshWithRetry(attempt, { sleep })).toBe('invalid');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('an ok first time is returned at once', async () => {
    const attempt = sequence('ok');
    expect(await refreshWithRetry(attempt, { sleep: async () => {} })).toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('two transients return transient (the session is kept; the request counts as offline)', async () => {
    const attempt = sequence('transient', 'transient', 'ok');
    expect(await refreshWithRetry(attempt, { sleep: async () => {} })).toBe('transient');
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
