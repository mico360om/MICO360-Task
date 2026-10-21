/**
 * Change your own password on the phone (6a), as the website's Profile page does it. The server
 * checks the current password, applies its rule to the new one, signs out every session and every
 * phone's notifications, and hands this phone a fresh session so it stays signed in.
 *
 * The passwords are only ever held by the form and passed to the request: never stored, cached or
 * logged (no query cache, no error text that repeats them).
 */
import { ApiError, isNetworkError, type RefreshOutcome } from './api-client';
import type { Session } from './types';

/** The hint under every new-password field (the website's). */
export const PASSWORD_RULE_HINT = 'At least 8 characters, with a letter and a number.';
/** The message for a new password that doesn't meet the rule (the website's). */
export const PASSWORD_RULE_ERROR = 'Use at least 8 characters, including a letter and a number.';

/** 8+ characters with at least one letter and one digit — the server's own rule. */
export function isStrongPassword(password: string): boolean {
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

export type PasswordField = 'current' | 'next' | 'confirm';

/** What's wrong with the form before it is sent, and which field to fix (null: send it). */
export function checkPasswordChange(form: { current: string; next: string; confirm: string }): { field: PasswordField; message: string } | null {
  if (!form.current) return { field: 'current', message: 'Enter your current password.' };
  if (!isStrongPassword(form.next)) return { field: 'next', message: PASSWORD_RULE_ERROR };
  if (form.next !== form.confirm) return { field: 'confirm', message: 'The new passwords don’t match.' };
  return null;
}

const FALLBACK = 'Couldn’t change your password. Check that your current password is correct.';

/** The phone knew it was offline, so the change was never sent: nothing changed. */
export class PasswordChangeNotSent extends Error {
  constructor() {
    super('Not sent: offline.');
    this.name = 'PasswordChangeNotSent';
  }
}

/**
 * Why the change was refused, and the field it is about (null: the form as a whole). A change sent
 * without an answer (a time-out, a connection lost on the way) may have happened — the server may
 * have changed the password and ended every session — so it is never reported as "not changed"
 * (`unsure`): the next sign-in may need the new password (6a review).
 */
export function passwordChangeProblem(error: unknown): { field: PasswordField | null; message: string; unsure?: true } {
  if (error instanceof PasswordChangeNotSent) return { field: null, message: 'You’re offline — your password can be changed when you’re connected.' };
  if (isNetworkError(error)) return { field: null, message: 'We couldn’t confirm the change. If you’re asked to sign in, use your new password.', unsure: true };
  if (error instanceof ApiError) {
    const own = error.code !== 'ERROR' && !!error.message && !/^Request failed/.test(error.message);
    if (error.status === 429 && own) return { field: null, message: error.message };
    if (error.status === 400 && own) {
      if (error.code === 'WEAK_PASSWORD') return { field: 'next', message: error.message };
      if (/current password/i.test(error.message)) return { field: 'current', message: error.message };
      return { field: null, message: error.message };
    }
  }
  return { field: null, message: FALLBACK };
}

/** The password fields are emptied when the app leaves the screen for the background (6a review). */
export function clearsPasswordFields(appState: string): boolean {
  return appState === 'background' || appState === 'inactive';
}

/**
 * How a change ended that finished after its screen was left — still said (6a review): the
 * result's own words, or why the password wasn't changed (or that it may have been).
 */
export function lateOutcomeText(outcome: { ok: true; result: PasswordChangeResult } | { ok: false; error: unknown }): string | null {
  // null: the change was the last person's, and someone else is signed in now — nothing is said to them.
  if (outcome.ok) return outcome.result.message;
  const p = passwordChangeProblem(outcome.error);
  return p.unsure ? p.message : `Your password wasn’t changed: ${p.message}`;
}

/**
 * The late outcome for whoever is signed in now (5b review): the person who asked, or nobody (the
 * sign-in screen) is told; someone else who signed in meanwhile is told nothing about it.
 */
export function lateOutcomeFor(
  outcome: { ok: true; result: PasswordChangeResult } | { ok: false; error: unknown },
  askedBy: string | null | undefined,
  signedInNow: string | null | undefined,
): string | null {
  if (signedInNow && signedInNow !== askedBy) return null;
  return lateOutcomeText(outcome);
}

export interface PasswordChangeDeps {
  /** POST /users/me/password: the fresh session's tokens (none from a server that doesn't give them). */
  send: (currentPassword: string, newPassword: string) => Promise<{ accessToken?: string; refreshToken?: string } | null | undefined>;
  session: { getSession(): Session | null; setSession(next: Session): Promise<void> };
  /** Register this phone for notifications again (the change forgets every phone). */
  registerPush: () => Promise<unknown>;
  /** This phone's fingerprint sign-in key, which the change ends on the server. */
  fingerprint: { isArmed(): Promise<boolean>; disarm(): Promise<void> };
  /** Can the server be reached, as far as the phone knows? Offline, nothing is sent. */
  isOnline?: () => boolean;
  /**
   * The app's change gate: a session refresh refused while the change is on its way waits for it
   * (the server ends the old session before it answers), so this phone isn't signed out meanwhile.
   */
  gate?: ChangeGate;
  /** A sign-out has begun: the fresh session is then not kept (it would be signed out anyway). */
  isSigningOut?: () => boolean;
  /**
   * Revoke a fresh refresh token this phone won't keep (POST /auth/logout with it, without anyone's
   * access token), so a session nobody holds is never left open (5b review).
   */
  revoke?: (refreshToken: string) => Promise<unknown>;
}

export interface PasswordChangeResult {
  /** This phone holds the fresh session (still signed in here). */
  keptHere: boolean;
  /** This phone's fingerprint sign-in was on and has stopped. */
  fingerprintStopped: boolean;
  /** What to tell the person; null when someone else is signed in by the time it ends (5b review). */
  message: string | null;
}

/**
 * The change and what follows it: the fresh session is stored before anything else uses the
 * old one, then notifications are signed up for again with it; the ended fingerprint key is turned
 * off here so Settings offers to turn it back on. A refused change leaves everything as it was.
 */
export function createPasswordChange(deps: PasswordChangeDeps) {
  return async function change(currentPassword: string, newPassword: string): Promise<PasswordChangeResult> {
    // Known to be offline: nothing is sent, so it can say plainly that nothing changed.
    if (deps.isOnline && !deps.isOnline()) throw new PasswordChangeNotSent();
    // Sent and kept inside the gate: a refresh refused meanwhile waits until the fresh session is kept.
    const run = <T>(fn: () => Promise<T>) => (deps.gate ? deps.gate.run(fn) : fn());
    // Whose change this is: the fresh session is kept only for the same person (5b review — if
    // someone else signed in while it was on its way, their session must never get these tokens).
    const owner = deps.session.getSession()?.user.id ?? null;
    const { keptHere, signedOut, someoneElse } = await run(async () => {
      const fresh = await deps.send(currentPassword, newPassword);
      const held = deps.session.getSession();
      const signingOut = deps.isSigningOut?.() ?? false;
      const someoneElse = !!held && held.user.id !== owner;
      if (!signingOut && held && !someoneElse && owner && fresh?.accessToken && fresh.refreshToken) {
        await deps.session.setSession({ user: held.user, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken });
        return { keptHere: true, signedOut: false, someoneElse: false };
      }
      // Not kept: a session nobody holds is closed on the server (quietly — the change itself worked).
      if (fresh?.refreshToken) await deps.revoke?.(fresh.refreshToken).catch(() => {});
      return { keptHere: false, signedOut: signingOut, someoneElse };
    });
    // Someone else's phone now: their fingerprint sign-in, notifications and screen are left alone.
    if (someoneElse) return { keptHere: false, fingerprintStopped: false, message: null };
    const fingerprintStopped = await deps.fingerprint.isArmed().catch(() => false);
    if (fingerprintStopped) await deps.fingerprint.disarm().catch(() => {});
    if (keptHere) await deps.registerPush().catch(() => {});
    const message = keptHere
      ? 'Password changed. Other devices have been signed out; you’re still signed in here.' +
        (fingerprintStopped ? ' Fingerprint sign-in has stopped on this phone; you can turn it back on in Settings.' : '')
      : signedOut
        ? 'Password changed. Sign in again with your new password.'
        : 'Password changed. You’ll be asked to sign in again with your new password shortly.';
    return { keptHere, fingerprintStopped, message };
  };
}

/** A session as the refresh checks it: whose it is, and its refresh token. */
type HeldSession = { refreshToken: string; user: { id: string } } | null | undefined;

/**
 * A session refresh the server refused, decided again: when the refresh token it sent has been
 * replaced meanwhile (a password change on this phone stores the fresh session the server hands
 * back), the session this phone now holds is the good one — the request is tried with it, not
 * signed out. If the phone now holds someone else's session (signed out and in as another person
 * meanwhile), the request is never tried with it: 'changed' (6a review). Otherwise the refusal stands.
 */
export function refusedRefreshOutcome(outcome: Exclude<RefreshOutcome, 'ok'>, sent: { refreshToken: string; user: { id: string } }, held: HeldSession): RefreshOutcome {
  if (outcome !== 'invalid' || !held) return outcome;
  if (held.user.id !== sent.user.id) return 'changed';
  return held.refreshToken !== sent.refreshToken ? 'ok' : 'invalid';
}

/**
 * A refresh that worked, but the session changed while it was on its way: the request is tried
 * again only with the same person's session ('ok'); with someone else's it is not ('changed');
 * with none, the session is over.
 */
export function refreshRaceOutcome(sent: { user: { id: string } }, now: HeldSession): RefreshOutcome {
  if (!now) return 'invalid';
  return now.user.id === sent.user.id ? 'ok' : 'changed';
}

/** The app's password-change gate (one per app): what a refused refresh waits for. */
export interface ChangeGate {
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Until the change on its way has finished — at most `maxMs` (the change may itself wait on the refresh). */
  wait(maxMs: number): Promise<void>;
  busy(): boolean;
}

export function createChangeGate(): ChangeGate {
  let current: Promise<unknown> | null = null;
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      // Busy from the first line of the change (its request goes out at once).
      let release!: () => void;
      const marker = new Promise<void>((resolve) => {
        release = resolve;
      });
      current = marker;
      try {
        return await fn();
      } finally {
        release();
        if (current === marker) current = null;
      }
    },
    wait(maxMs: number): Promise<void> {
      const p = current;
      if (!p) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, maxMs);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        p.then(done, done);
      });
    },
    busy: () => current !== null,
  };
}

/**
 * A refused refresh, settled: while a password change is on its way it waits for it (at most
 * `waitMs`) and then decides with the session the phone holds (refusedRefreshOutcome) — so the
 * fresh session the change brings is used instead of signing this phone out (6a review).
 */
export async function settleRefusedRefresh(
  outcome: Exclude<RefreshOutcome, 'ok'>,
  sent: { refreshToken: string; user: { id: string } },
  deps: { gate?: ChangeGate; held: () => HeldSession; signingOut: () => boolean; waitMs: number },
): Promise<RefreshOutcome> {
  if (outcome === 'invalid' && deps.gate?.busy()) await deps.gate.wait(deps.waitMs);
  return refusedRefreshOutcome(outcome, sent, deps.signingOut() ? null : deps.held());
}
