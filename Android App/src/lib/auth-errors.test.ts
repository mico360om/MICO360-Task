import { describe, it, expect } from 'vitest';
import { authErrorMessage, lockoutMinutes, isAccountLocked, isEmailNotConfigured } from './auth-errors';
import { ApiError, NetworkError } from './api-client';

describe('auth error messages', () => {
  it('tells a locked-out user how long to wait (423 retryAfterSeconds)', () => {
    const e = new ApiError(423, 'ACCOUNT_LOCKED', 'locked', { retryAfterSeconds: 540 });
    expect(isAccountLocked(e)).toBe(true);
    expect(authErrorMessage(e)).toContain('Try again in 9 minutes');
    expect(authErrorMessage(new ApiError(423, 'ACCOUNT_LOCKED', 'locked', { retryAfterSeconds: 20 }))).toContain('Try again in 1 minute,');
    expect(authErrorMessage(new ApiError(423, 'ACCOUNT_LOCKED', 'locked'))).toContain('Reset your password');
  });

  it('explains that email is not configured (503 EMAIL_NOT_CONFIGURED)', () => {
    const e = new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email not configured');
    expect(isEmailNotConfigured(e)).toBe(true);
    expect(authErrorMessage(e)).toMatch(/Email isn’t set up/);
    expect(isEmailNotConfigured(new ApiError(503, 'UNAVAILABLE', 'down'))).toBe(false);
  });

  it('rate limiting asks to wait; offline says so; otherwise the server message', () => {
    expect(authErrorMessage(new ApiError(429, 'RATE_LIMITED', 'x'))).toMatch(/wait a minute/);
    expect(authErrorMessage(new NetworkError('offline'))).toMatch(/Can’t reach the server/);
    expect(authErrorMessage(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials'))).toBe('Invalid credentials');
    expect(authErrorMessage(new Error('?'))).toMatch(/Something went wrong/);
  });

  it('lockoutMinutes rounds up and ignores junk', () => {
    expect(lockoutMinutes({ retryAfterSeconds: 61 })).toBe(2);
    expect(lockoutMinutes({ retryAfterSeconds: 0 })).toBeNull();
    expect(lockoutMinutes({ retryAfterSeconds: '60' })).toBeNull();
    expect(lockoutMinutes(undefined)).toBeNull();
  });
});
