import { HttpError } from '../../lib/http-errors';

export class AuthError extends HttpError {
  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message, code, status, details);
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super('Invalid email/username or password.', 'INVALID_CREDENTIALS', 401);
  }
}

export class AccountLockedError extends AuthError {
  /** `until` is when the lock expires on its own; it is echoed as `details.retryAfterSeconds`. */
  constructor(until?: Date | null, now: Date = new Date()) {
    const retryAfterSeconds = until ? Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)) : undefined;
    super(
      'Too many failed sign-in attempts. Try again later, sign in with an emailed code, or reset your password.',
      'ACCOUNT_LOCKED',
      423,
      retryAfterSeconds ? { retryAfterSeconds } : undefined,
    );
  }
}

export class AccountInactiveError extends AuthError {
  constructor() {
    super('This account is not active. Contact an administrator.', 'ACCOUNT_INACTIVE', 403);
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message = 'Authentication required.') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class InvalidOtpError extends AuthError {
  constructor() {
    super('Invalid or unknown code.', 'INVALID_OTP', 401);
  }
}

export class OtpExpiredError extends AuthError {
  constructor() {
    super('This code has expired. Request a new one.', 'OTP_EXPIRED', 401);
  }
}

export class TooManyOtpAttemptsError extends AuthError {
  constructor(message = 'Too many attempts. Request a new code.') {
    super(message, 'OTP_TOO_MANY_ATTEMPTS', 429);
  }
}

export class InvalidResetTokenError extends AuthError {
  constructor() {
    super('This reset link is invalid or has expired. Request a new one.', 'INVALID_RESET_TOKEN', 400);
  }
}

export class WeakPasswordError extends AuthError {
  constructor() {
    super('Password must be at least 8 characters and include a letter and a number.', 'WEAK_PASSWORD', 400);
  }
}

/** Email-based sign-in / recovery can't work because no mail provider is configured (same for every account). */
export class EmailUnavailableError extends AuthError {
  constructor() {
    super('Email sign-in isn’t available right now. Sign in with your password or contact an administrator.', 'EMAIL_NOT_CONFIGURED', 503);
  }
}

/**
 * Onboarding: the right password, but the account's email address isn't confirmed yet and this sign-in
 * can't take the emailed-code step (the Android app, the extension, an older page). Said only after the
 * password was right, like ACCOUNT_INACTIVE.
 */
export class EmailNotVerifiedError extends AuthError {
  constructor() {
    super('Confirm your email on the website first: sign in there and enter the 6-digit code we email you.', 'EMAIL_NOT_VERIFIED', 403);
  }
}

/** A sign-in challenge that is used, ended or past its time: start again with the password. */
export class SignInExpiredError extends AuthError {
  constructor() {
    super('This sign-in has expired. Sign in again to get a new code.', 'SIGN_IN_EXPIRED', 401);
  }
}

/** The code typed doesn't match the newest one emailed for this sign-in. */
export class WrongCodeError extends AuthError {
  constructor() {
    super('That code isn’t right. Check the newest email we sent and try again.', 'WRONG_CODE', 401);
  }
}

/** Too many wrong codes (for this sign-in, or for the account within the hour). */
export class TooManyWrongCodesError extends AuthError {
  constructor(message = 'Too many wrong codes. Sign in again to get a new code.') {
    super(message, 'TOO_MANY_WRONG_CODES', 429);
  }
}

/** The account was sent its hourly allowance of codes. */
export class TooManyCodesError extends AuthError {
  constructor() {
    super('We’ve sent several codes in the last hour. Check your inbox and spam folder, or try again later.', 'TOO_MANY_CODES', 429);
  }
}

/** The code email couldn't be handed to the mail provider. */
export class CodeNotSentError extends AuthError {
  constructor() {
    super('We couldn’t email your code just now. Please try again in a minute.', 'CODE_NOT_SENT', 502);
  }
}

/**
 * 1.23.6: the password was a temporary one, and this caller (the Android app, the extension, an older
 * page) can't take the "choose your own password" step — the website can.
 */
export class PasswordChangeRequiredError extends AuthError {
  constructor() {
    super('Set your own password on the website first: sign in there with the temporary password and choose your own, then sign in here with it.', 'PASSWORD_CHANGE_REQUIRED', 403);
  }
}

/** 1.23.6: an unused temporary password past its lifetime (said only after the right password). */
export class TemporaryPasswordExpiredError extends AuthError {
  constructor() {
    super('This temporary password has expired. Ask your administrator for a new one.', 'TEMPORARY_PASSWORD_EXPIRED', 403);
  }
}

/** 1.23.6: the "choose your own password" step ran out (15 minutes), was used, or isn't this account's. */
export class PasswordChangeExpiredError extends AuthError {
  constructor() {
    super('This step has expired. Sign in again with your temporary password.', 'PASSWORD_CHANGE_EXPIRED', 400);
  }
}

/** 1.23.6: the new password is the temporary one again. */
export class SameAsTemporaryPasswordError extends AuthError {
  constructor() {
    super('Choose a new password — not the temporary one.', 'SAME_AS_TEMPORARY', 400);
  }
}
