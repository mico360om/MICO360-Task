import { describe, it, expect } from 'vitest';
import { authErrorMessage, biometricSignInProblem, lockoutMinutes, isAccountLocked, isEmailNotConfigured } from './auth-errors';
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

describe('biometricSignInProblem — what a failed fingerprint sign-in says, and whether the key goes', () => {
  it('a refused key is forgotten (password changed, 30 days unused)', () => {
    const p = biometricSignInProblem(new ApiError(401, 'INVALID_BIOMETRIC_KEY', 'x'));
    expect(p.forgetKey).toBe(true);
    expect(p.message).toMatch(/Fingerprint sign-in has stopped/);
  });

  it('no answer keeps the key and blames the connection', () => {
    expect(biometricSignInProblem(new NetworkError('Network request failed.'))).toEqual({
      message: 'Can’t reach the server. Check your connection and try again.',
      forgetKey: false,
    });
  });

  it('a busy server (429, 5xx) keeps the key', () => {
    for (const status of [429, 500, 503]) {
      expect(biometricSignInProblem(new ApiError(status, 'X', 'x'))).toEqual({ message: 'The server is busy. Please try again in a minute.', forgetKey: false });
    }
  });

  it('a 403 is not "busy": it says what the server said, and keeps the key', () => {
    expect(biometricSignInProblem(new ApiError(403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact an administrator.'))).toEqual({
      message: 'This account is not active. Contact an administrator.',
      forgetKey: false,
    });
    // A 403 with no reason of ours (a proxy or firewall page).
    const blocked = biometricSignInProblem(new ApiError(403, 'ERROR', 'Request failed (403)'));
    expect(blocked.forgetKey).toBe(false);
    expect(blocked.message).toBe('The server refused the sign-in. Please try again later, or sign in with your password.');
  });
});
