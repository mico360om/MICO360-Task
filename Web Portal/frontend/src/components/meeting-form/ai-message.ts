import { ApiError } from '../../lib/api-client';

/** What to tell the person when an AI helper fails: the server's own words (e.g. "AI is not configured yet…"), else `fallback`. */
export function aiMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message && !/^Request failed/.test(err.message) ? err.message : fallback;
}
