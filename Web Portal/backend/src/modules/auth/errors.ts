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
