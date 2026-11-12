import { ApiError, READ_TRIES, networkTries } from './api-client';

/** Transient client statuses worth another attempt. */
const RETRYABLE_4XX = new Set([408, 429]);
const MAX_RETRIES = 3;

/**
 * 1.23.23: after the API client gave up on a dropped read (its 3 tries, in about 1.6 s), a query tries it this
 * many more times (each one again up to 3 tries)…
 */
export const DROPPED_READ_ROUNDS = 1;
/**
 * …this long after (ms): with the client's own tries, a connection that is back within about 7 s is never seen
 * — as when the query alone retried at 1 s, 2 s and 4 s — and a read that stays dropped is sent 6 times, not 12.
 */
export const DROPPED_READ_DELAY_MS = 4000;

/** 1.23.23: a dropped read the API client already tried READ_TRIES times on a visible, online page. */
export function clientRetriedNetwork(error: unknown): boolean {
  return !(error instanceof ApiError) && networkTries(error) >= READ_TRIES;
}

/**
 * Under a query's own retry limit (`max`) — at most DROPPED_READ_ROUNDS for a dropped read the API client
 * already tried 3 times, so a query's retries never multiply the client's. Every query's own `retry` rule
 * goes through this (or shouldRetryQuery): a scan test holds the code to it.
 */
export function retriesLeft(failureCount: number, error: unknown, max: number): boolean {
  return failureCount < (clientRetriedNetwork(error) ? Math.min(max, DROPPED_READ_ROUNDS) : max);
}

/**
 * The wait before a query's next try (TanStack Query `retryDelay`): DROPPED_READ_DELAY_MS after a dropped read
 * the API client already tried 3 times; otherwise `otherwise` (ms) or the library's own (1 s, 2 s, 4 s… 30 s).
 */
export function queryRetryDelay(failureCount: number, error: unknown, otherwise?: number): number {
  if (clientRetriedNetwork(error)) return DROPPED_READ_DELAY_MS;
  return otherwise ?? Math.min(1000 * 2 ** failureCount, 30_000);
}

/**
 * TanStack Query `retry` predicate. A 4xx from our API (401/403/404/400…) is deterministic —
 * retrying it only delays the error state (e.g. a non-admin saw ~7 s of skeletons on Reports
 * before "admin only" appeared). Server errors and network failures still get up to 3 attempts —
 * except a dropped read the API client already tried 3 times (1.23.23): one more round, 4 s later
 * (6 requests at most, not 3 × 4). One it stopped trying early (the page hidden, offline) is retried as
 * before: the query waits for the page to be back and online before it does.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && !RETRYABLE_4XX.has(error.status)) return false;
  return retriesLeft(failureCount, error, MAX_RETRIES);
}
