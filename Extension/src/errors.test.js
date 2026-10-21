import { describe, it, expect } from 'vitest';
import { ApiError, QueueError, UnexpectedReplyError, isTransientFailure, messageFor, signInErrorMessage } from './errors.js';

describe('messageFor (H2: the server’s plain-language errors are shown)', () => {
  it('shows the server’s message for a 4xx answer', () => {
    const conflict = new ApiError(409, 'This task was changed by someone else. Reload and try again.', 'VERSION_CONFLICT');
    expect(messageFor(conflict, 'Could not save your change.')).toBe('This task was changed by someone else. Reload and try again.');
    expect(messageFor(new ApiError(400, 'The start date must be on or before the due date.', 'VALIDATION'), 'x')).toBe('The start date must be on or before the due date.');
    expect(messageFor(new ApiError(403, 'You do not have permission to do that.', 'FORBIDDEN'), 'x')).toBe('You do not have permission to do that.');
  });

  it('keeps the screen’s own text for a 5xx, a 4xx without a message, or no answer at all', () => {
    expect(messageFor(new ApiError(500, 'Something went wrong.', 'INTERNAL'), 'Could not save your change.')).toBe('Could not save your change.');
    expect(messageFor(new ApiError(404), 'Could not load this task.')).toBe('Could not load this task.');
    expect(messageFor(new TypeError('Failed to fetch'), 'Could not load this task.')).toBe('Could not load this task.');
    expect(messageFor(null, 'Fallback')).toBe('Fallback');
  });

  it('a change that could not be saved on this device explains itself', () => {
    expect(messageFor(new QueueError(), 'x')).toBe('Your change could not be saved on this device. Please try again.');
  });
});

describe('UnexpectedReplyError (M6)', () => {
  it('counts as "can’t reach the server" so the saved copy is shown', () => {
    expect(isTransientFailure(new UnexpectedReplyError())).toBe(true);
  });
});

describe('signInErrorMessage (L20)', () => {
  it('says when the account is switched off, in the server’s words', () => {
    expect(signInErrorMessage(403, { code: 'ACCOUNT_INACTIVE', message: 'This account is not active. Contact an administrator.' }))
      .toBe('This account is not active. Contact an administrator.');
  });

  it('says how long a locked account stays locked, and the other ways in', () => {
    const text = signInErrorMessage(423, { code: 'ACCOUNT_LOCKED', message: 'Too many failed sign-in attempts.', details: { retryAfterSeconds: 540 } });
    expect(text).toContain('Try again in 9 minutes');
    expect(text).toContain('emailed code');
    expect(text).toContain('reset your password');
    expect(signInErrorMessage(423, { code: 'ACCOUNT_LOCKED', details: { retryAfterSeconds: 30 } })).toContain('Try again in 1 minute.');
    expect(signInErrorMessage(423, {})).toMatch(/^Account locked/);
  });

  it('keeps the plain messages for a wrong password, too many tries and server trouble', () => {
    expect(signInErrorMessage(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid email/username or password.' })).toBe('Invalid email or password.');
    expect(signInErrorMessage(429, {})).toBe('Too many attempts — wait a minute and try again.');
    expect(signInErrorMessage(502)).toBe('The server had a problem. Please try again.');
  });
});
