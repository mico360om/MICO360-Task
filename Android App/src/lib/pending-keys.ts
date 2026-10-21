import { ApiError, isNetworkError } from './api-client';
import { newIdempotencyKey } from './idempotency';

/**
 * The Idempotency-Key of a try that may still be on the server (2b review). A try that got no
 * answer (or is still being saved) may have been done: the next try of the very same thing must
 * send the same key, so the server answers with the first instead of doing it twice — sending the
 * minutes or the invitations again, adding a person, an agenda item, a task or a copy twice.
 *
 * The key is kept here, outside any sheet or screen, so closing a sheet and opening it again
 * doesn't lose it, and only until a definite answer: a success, or a refusal (the server keeps a
 * refusal under its key, so a fixed try must be a new one). A try is named by what it sends
 * (tryName): the server matches the key, not what is sent, so a changed try is another try with
 * its own key — the first one's answer can't stand in for it. Pure, so it is tested here.
 */

/** Whether a try's key is kept for the next tap: no answer came, or the server is still on it. */
export function keepsKey(e: unknown): boolean {
  return isNetworkError(e) || (e instanceof ApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS');
}

export function createPendingKeys(gen: () => string = newIdempotencyKey) {
  const keys = new Map<string, string>();
  return {
    /** The key for this try: the one of the same try still without an answer, or a new one. */
    keyFor(what: string): string {
      let key = keys.get(what);
      if (!key) {
        key = gen();
        keys.set(what, key);
      }
      return key;
    },
    /** How the try ended (no error = it went through): its key is kept only while the server may still have it. */
    settle(what: string, error?: unknown): void {
      if (error === undefined || !keepsKey(error)) keys.delete(what);
    },
  };
}

export type PendingKeys = ReturnType<typeof createPendingKeys>;

/** The app's one set (for the app's life). */
export const pendingKeys = createPendingKeys();

/** One try's name: what it does, to what, and what it sends. */
export function tryName(...parts: unknown[]): string {
  return JSON.stringify(parts);
}

const sorted = (emails: string[]) => [...emails].map((e) => e.trim().toLowerCase()).sort();

/** Sending a meeting's invitations: its choice (only new people, everyone again) and who they go to. */
export function inviteTry(meetingId: string, opts: { onlyNew?: boolean; resend?: boolean }, emails: string[]): string {
  return tryName('invites', meetingId, { onlyNew: !!opts.onlyNew, resend: !!opts.resend }, sorted(emails));
}

/** Emailing a meeting's minutes: who they go to. */
export function minutesTry(meetingId: string, emails: string[]): string {
  return tryName('minutes', meetingId, sorted(emails));
}

/**
 * Why a creating try didn't report back. One that timed out may still be done: tapping again
 * finishes it without doing it twice. `again` is what to tap ("Add attendee").
 */
export function keptTryText(e: unknown, fallback: string, again: string, fallbackText: (e: unknown, fallback: string) => string): string {
  if (isNetworkError(e) && (e as { timedOut?: unknown }).timedOut === true) {
    return `The server took too long to answer — it may already be done. Tap “${again}” again to finish: it won’t happen twice.`;
  }
  if (e instanceof ApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS') return 'Still being saved — try again in a moment.';
  return fallbackText(e, fallback);
}
