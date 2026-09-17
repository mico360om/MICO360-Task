import { ApiError } from './api-client';

/** Transient client statuses worth another attempt. */
const RETRYABLE_4XX = new Set([408, 429]);
const MAX_RETRIES = 3;

/**
 * TanStack Query `retry` predicate. A 4xx from our API (401/403/404/400…) is deterministic —
 * retrying it only delays the error state (e.g. a non-admin saw ~7 s of skeletons on Reports
 * before "admin only" appeared). Server errors and network failures still get up to 3 attempts.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && !RETRYABLE_4XX.has(error.status)) return false;
  return failureCount < MAX_RETRIES;
}
