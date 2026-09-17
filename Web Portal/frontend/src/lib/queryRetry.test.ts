import { describe, it, expect } from 'vitest';
import { shouldRetryQuery } from './queryRetry';
import { ApiError } from './api-client';

const api = (status: number) => new ApiError(status, 'X', 'x');

describe('shouldRetryQuery', () => {
  it('never retries deterministic client errors (401/403/404/400)', () => {
    for (const s of [400, 401, 403, 404]) expect(shouldRetryQuery(0, api(s))).toBe(false);
  });

  it('retries server errors and network failures up to 3 times', () => {
    expect(shouldRetryQuery(0, api(500))).toBe(true);
    expect(shouldRetryQuery(2, api(503))).toBe(true);
    expect(shouldRetryQuery(3, api(500))).toBe(false);
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(3, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('treats 408/429 as retryable (transient client statuses)', () => {
    expect(shouldRetryQuery(0, api(408))).toBe(true);
    expect(shouldRetryQuery(0, api(429))).toBe(true);
  });
});
