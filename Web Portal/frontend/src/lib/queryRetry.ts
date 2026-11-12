import { ApiError, NETWORK_TRIES, networkTries } from './api-client';

/** Transient client statuses worth another attempt. */
const RETRYABLE_4XX = new Set([408, 429]);
const MAX_RETRIES = 3;

/**
 * 1.23.23: a dropped read the API client already tried NETWORK_TRIES times on a visible, online page — not a
 * blip: another round would only multiply the requests (and the Error log's reports).
 */
export function clientRetriedNetwork(error: unknown): boolean {
  return !(error instanceof ApiError) && networkTries(error) >= NETWORK_TRIES;
}

/**
 * TanStack Query `retry` predicate. A 4xx from our API (401/403/404/400…) is deterministic —
 * retrying it only delays the error state (e.g. a non-admin saw ~7 s of skeletons on Reports
 * before "admin only" appeared). Server errors and network failures still get up to 3 attempts —
 * except a dropped read the API client already tried 3 times (1.23.23): such a read is sent 3 times in
 * all, not 3 × 4. One it stopped trying early (the page hidden, offline) is still retried here: the
 * query waits for the page to be back and online before it does.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && !RETRYABLE_4XX.has(error.status)) return false;
  if (clientRetriedNetwork(error)) return false;
  return failureCount < MAX_RETRIES;
}
