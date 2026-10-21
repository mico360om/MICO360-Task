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
 *
 * The server hands the first try's stored reply back for that key for a day, whatever has changed
 * since (2c review). So a kept key lives only a short while after its last try (KEPT_KEY_LIFE_MS):
 * a deliberate try later on is a new one. It goes at once when the result shows (the people list
 * holds the person added, the agenda the item) or is undone (that person removed, that item
 * deleted), and a try is named by what it depends on, not only what it sends: the minutes email by
 * what the minutes say, the invitations by when and where the meeting is.
 */

/** How long a kept key lives after its last try: a retry soon after a time-out, not a later, deliberate action. */
export const KEPT_KEY_LIFE_MS = 10 * 60_000;

/** Whether a try's key is kept for the next tap: no answer came, or the server is still on it. */
export function keepsKey(e: unknown): boolean {
  return isNetworkError(e) || (e instanceof ApiError && e.code === 'IDEMPOTENCY_IN_PROGRESS');
}

export interface PendingKeysOptions {
  gen?: () => string;
  now?: () => number;
  /** How long a kept key lives after its last try (default KEPT_KEY_LIFE_MS). */
  lifeMs?: number;
}

export function createPendingKeys(options: PendingKeysOptions | (() => string) = {}) {
  const opts: PendingKeysOptions = typeof options === 'function' ? { gen: options } : options;
  const gen = opts.gen ?? newIdempotencyKey;
  const now = opts.now ?? Date.now;
  const lifeMs = opts.lifeMs ?? KEPT_KEY_LIFE_MS;
  const keys = new Map<string, { key: string; at: number }>();
  return {
    /** The key for this try: the one of the same try still without an answer (and not too old), or a new one. */
    keyFor(what: string): string {
      const at = now();
      const kept = keys.get(what);
      const key = kept && at - kept.at <= lifeMs ? kept.key : gen();
      keys.set(what, { key, at });
      return key;
    },
    /** How the try ended (no error = it went through): its key is kept only while the server may still have it. */
    settle(what: string, error?: unknown): void {
      if (error === undefined || !keepsKey(error)) keys.delete(what);
    },
    /** Let go of every kept key whose try (its name's parts) matches: its result shows, or was undone. */
    settleWhere(match: (parts: unknown[]) => boolean): void {
      for (const what of [...keys.keys()]) {
        let parts: unknown;
        try {
          parts = JSON.parse(what);
        } catch {
          continue;
        }
        if (Array.isArray(parts) && match(parts)) keys.delete(what);
      }
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
const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** A short, stable fingerprint of a text (not secret: it only tells two versions apart). */
function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** What a send depends on, as one value: when the content was last approved or saved, and what it says. */
export function contentVersion(approvedAt: string | null | undefined, savedAt: string | null | undefined, text?: string | null): string {
  return `${approvedAt ?? ''}|${savedAt ?? ''}|${fingerprint(text ?? '')}`;
}

/** What a meeting's invitation says (when, where, what) — not its status or when it was last changed. */
export interface InviteContent {
  id: string;
  title?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  location?: string | null;
  onlineLink?: string | null;
}

/** Sending a meeting's invitations: what they say, the choice (only new people, everyone again) and who they go to. */
export function inviteTry(meeting: InviteContent, opts: { onlyNew?: boolean; resend?: boolean }, emails: string[]): string {
  const said = { title: meeting.title ?? '', startAt: meeting.startAt ?? '', endAt: meeting.endAt ?? '', location: meeting.location ?? '', onlineLink: meeting.onlineLink ?? '' };
  return tryName('invites', meeting.id, said, { onlyNew: !!opts.onlyNew, resend: !!opts.resend }, sorted(emails));
}

/** Emailing a meeting's minutes: who they go to, and which version of the minutes (contentVersion). */
export function minutesTry(meetingId: string, emails: string[], version: string): string {
  return tryName('minutes', meetingId, version, sorted(emails));
}

// ── People and agenda items: let a kept add go once it shows, or is undone ──

type AttendeeIdentity = { userId?: string | null; externalEmail?: string | null };

/** Adding someone to a meeting. */
export function attendeeTry(meetingId: string, input: AttendeeIdentity & Record<string, unknown>): string {
  return tryName('attendee', meetingId, input);
}

const samePerson = (input: unknown, row: AttendeeIdentity) => {
  const i = (input ?? {}) as AttendeeIdentity;
  if (i.userId) return i.userId === row.userId;
  return !!lower(i.externalEmail) && lower(i.externalEmail) === lower(row.externalEmail);
};

const isTry = (parts: unknown[], kind: string, meetingId: string) => parts[0] === kind && parts[1] === meetingId;

/** The meeting's people as loaded: an add whose person is there was saved — its key goes. */
export function settleShownAttendees(keys: PendingKeys, meetingId: string, rows: readonly AttendeeIdentity[]): void {
  keys.settleWhere((parts) => isTry(parts, 'attendee', meetingId) && rows.some((r) => samePerson(parts[2], r)));
}

/** Someone was removed: adding them again later is a new add. */
export function settleRemovedAttendee(keys: PendingKeys, meetingId: string, row: AttendeeIdentity): void {
  settleShownAttendees(keys, meetingId, [row]);
}

type AgendaIdentity = { title?: string | null; ownerId?: string | null; expectedMinutes?: number | null };

/** Adding an agenda item. */
export function agendaTry(meetingId: string, input: AgendaIdentity): string {
  return tryName('agenda', meetingId, input);
}

const sameItem = (input: unknown, row: AgendaIdentity) => {
  const i = (input ?? {}) as AgendaIdentity;
  return lower(i.title) === lower(row.title) && (i.ownerId ?? null) === (row.ownerId ?? null) && (i.expectedMinutes ?? null) === (row.expectedMinutes ?? null);
};

/** The agenda as loaded: an add whose item is there was saved — its key goes. */
export function settleShownAgenda(keys: PendingKeys, meetingId: string, rows: readonly AgendaIdentity[]): void {
  keys.settleWhere((parts) => isTry(parts, 'agenda', meetingId) && rows.some((r) => sameItem(parts[2], r)));
}

/** An agenda item was deleted: adding the same again later is a new add. */
export function settleRemovedAgenda(keys: PendingKeys, meetingId: string, row: AgendaIdentity): void {
  settleShownAgenda(keys, meetingId, [row]);
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

/**
 * Send a try under its kept key, and settle the key by how it ended — inside the write itself, so
 * it is settled even when the screen that asked has closed (a callback given to `mutate` is dropped
 * then, and the key would outlive its answer: a later, deliberate try would get the old reply).
 */
export async function sendKept<T>(keys: PendingKeys, what: string, send: (key: string) => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await send(keys.keyFor(what));
  } catch (e) {
    keys.settle(what, e);
    throw e;
  }
  keys.settle(what);
  return result;
}
