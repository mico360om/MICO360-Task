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

/** Why the change was refused, and the field it is about (null: the form as a whole). */
export function passwordChangeProblem(error: unknown): { field: PasswordField | null; message: string } {
  if (isNetworkError(error)) return { field: null, message: 'You’re offline — your password can be changed when you’re connected.' };
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

export interface PasswordChangeDeps {
  /** POST /users/me/password: the fresh session's tokens (none from a server that doesn't give them). */
  send: (currentPassword: string, newPassword: string) => Promise<{ accessToken?: string; refreshToken?: string } | null | undefined>;
  session: { getSession(): Session | null; setSession(next: Session): Promise<void> };
  /** Register this phone for notifications again (the change forgets every phone). */
  registerPush: () => Promise<unknown>;
  /** This phone's fingerprint sign-in key, which the change ends on the server. */
  fingerprint: { isArmed(): Promise<boolean>; disarm(): Promise<void> };
}

export interface PasswordChangeResult {
  /** This phone holds the fresh session (still signed in here). */
  keptHere: boolean;
  /** This phone's fingerprint sign-in was on and has stopped. */
  fingerprintStopped: boolean;
  message: string;
}

/**
 * The change and what follows it: the fresh session is stored before anything else uses the
 * old one, then notifications are signed up for again with it; the ended fingerprint key is turned
 * off here so Settings offers to turn it back on. A refused change leaves everything as it was.
 */
export function createPasswordChange(deps: PasswordChangeDeps) {
  return async function change(currentPassword: string, newPassword: string): Promise<PasswordChangeResult> {
    const fresh = await deps.send(currentPassword, newPassword);
    const held = deps.session.getSession();
    const keptHere = !!(fresh?.accessToken && fresh.refreshToken && held);
    if (keptHere && held && fresh?.accessToken && fresh.refreshToken) {
      await deps.session.setSession({ user: held.user, accessToken: fresh.accessToken, refreshToken: fresh.refreshToken });
    }
    const fingerprintStopped = await deps.fingerprint.isArmed().catch(() => false);
    if (fingerprintStopped) await deps.fingerprint.disarm().catch(() => {});
    if (keptHere) await deps.registerPush().catch(() => {});
    const message = keptHere
      ? 'Password changed. Other devices have been signed out; you’re still signed in here.' +
        (fingerprintStopped ? ' Fingerprint sign-in has stopped on this phone; you can turn it back on in Settings.' : '')
      : 'Password changed. You’ll be asked to sign in again with your new password shortly.';
    return { keptHere, fingerprintStopped, message };
  };
}

/**
 * A session refresh the server refused, decided again: when the refresh token it sent has been
 * replaced meanwhile (a password change on this phone stores the fresh session the server hands
 * back), the session this phone now holds is the good one — the request is tried with it, not
 * signed out. Otherwise the refusal stands.
 */
export function refusedRefreshOutcome(outcome: Exclude<RefreshOutcome, 'ok'>, sentToken: string, heldToken: string | null | undefined): RefreshOutcome {
  return outcome === 'invalid' && !!heldToken && heldToken !== sentToken ? 'ok' : outcome;
}
