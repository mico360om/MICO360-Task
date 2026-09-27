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
