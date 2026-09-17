import { HttpError } from '../../lib/http-errors';

export class AuthError extends HttpError {
  constructor(message: string, code: string, status: number) {
    super(message, code, status);
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super('Invalid email/username or password.', 'INVALID_CREDENTIALS', 401);
  }
}

export class AccountLockedError extends AuthError {
  constructor() {
    super('Account locked after too many failed attempts. Reset your password to unlock.', 'ACCOUNT_LOCKED', 423);
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
  constructor() {
    super('Too many attempts. Request a new code.', 'OTP_TOO_MANY_ATTEMPTS', 429);
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
