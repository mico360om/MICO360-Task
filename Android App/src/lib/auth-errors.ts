import { ApiError, isNetworkError } from './api-client';

/** Minutes (rounded up, at least 1) from the lockout's `retryAfterSeconds`, or null. */
export function lockoutMinutes(details: unknown): number | null {
  const s = (details as { retryAfterSeconds?: unknown } | null | undefined)?.retryAfterSeconds;
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return null;
  return Math.max(1, Math.ceil(s / 60));
}

export function isAccountLocked(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'ACCOUNT_LOCKED' || e.status === 423);
}

export function isEmailNotConfigured(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'EMAIL_NOT_CONFIGURED' || (e.status === 503 && /email/i.test(e.code)));
}

/**
 * The message to show for a failed sign-in / code / reset request.
 * - 423 ACCOUNT_LOCKED → "Try again in N minutes" from `details.retryAfterSeconds`;
 * - 503 EMAIL_NOT_CONFIGURED → email is not set up on the server (codes/links cannot be sent);
 * - 429 RATE_LIMITED → wait and retry (never treated as a sign-out);
 * - no response → connection problem.
 */
export function authErrorMessage(e: unknown): string {
  if (isNetworkError(e)) return 'Can’t reach the server. Check your connection and try again.';
  if (!(e instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (isAccountLocked(e)) {
    const mins = lockoutMinutes(e.details);
    const wait = mins ? `Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset` : 'Reset';
    return `Too many failed attempts — your account is temporarily locked. ${wait} your password to unlock it now.`;
  }
  if (isEmailNotConfigured(e)) {
    return 'Email isn’t set up on the server yet, so codes and reset links can’t be sent. Please contact your administrator.';
  }
  if (e.code === 'RATE_LIMITED' || e.status === 429) return 'Too many attempts. Please wait a minute and try again.';
  return e.message || 'Something went wrong. Please try again.';
}

/** The fingerprint key was refused (password changed, admin reset, or 30 days unused). */
const FINGERPRINT_STOPPED =
  'Fingerprint sign-in has stopped: your password was changed, or the app wasn’t used for 30 days. Sign in with your password, then turn it on again in Settings.';

/**
 * What a failed fingerprint sign-in says, and whether the phone forgets its key:
 * - no answer → the connection (keep the key);
 * - 401/400, or a key the phone can't read any more → it has stopped working (forget it);
 * - 429 / 5xx → the server is busy (keep it);
 * - any other answer (403 "account not active", 423 locked) → the server's own reason (keep it:
 *   the key may work again once an administrator has sorted out the account).
 */
export function biometricSignInProblem(e: unknown): { message: string; forgetKey: boolean } {
  if (isNetworkError(e)) return { message: 'Can’t reach the server. Check your connection and try again.', forgetKey: false };
  if (!(e instanceof ApiError) || e.status === 401 || e.status === 400) return { message: FINGERPRINT_STOPPED, forgetKey: true };
  if (e.status === 429 || e.status >= 500) return { message: 'The server is busy. Please try again in a minute.', forgetKey: false };
  // 'ERROR' = the reply had no reason of ours (e.g. a proxy or firewall page).
  if (e.code === 'ERROR') return { message: 'The server refused the sign-in. Please try again later, or sign in with your password.', forgetKey: false };
  return { message: authErrorMessage(e), forgetKey: false };
}
