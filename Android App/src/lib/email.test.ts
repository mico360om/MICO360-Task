import { describe, it, expect } from 'vitest';
import { EMAIL_MAX, isServerEmail } from './email';
import { addGuest } from './meeting-ai';
import { guestProblem } from './meeting-parts';

// 2c review fix 6: the server checks a guest's address with zod's .email() (zod 3.25) and at most
// 320 characters; one the phone let through came back only as "Invalid input.".
describe('a guest’s email address, checked the way the server checks it', () => {
  it('takes ordinary addresses', () => {
    for (const ok of ['name@company.com', 'Sami.Al-Harthy@contractor.om', "o'neil+meetings@x.co", 'a_b@sub.domain.example', 'x@a-b.io']) {
      expect(isServerEmail(ok), ok).toBe(true);
    }
  });

  it('refuses what the server refuses: a one-letter ending, letters outside a–z, two dots, a ! and the like', () => {
    for (const bad of ['a@b.c', 'sami@شركة.om', 'سامي@x.com', 'a..b@x.com', '.a@x.com', 'a.@x.com', 'a!b@x.com', 'a@-x.com', 'a@x..com', 'a b@x.com', 'a@x', 'name@company.com.']) {
      expect(isServerEmail(bad), bad).toBe(false);
    }
  });

  it('refuses one longer than 320 characters', () => {
    const long = `${'a'.repeat(64)}@${'b'.repeat(260)}.com`;
    expect(long.length).toBeGreaterThan(EMAIL_MAX);
    expect(isServerEmail(long)).toBe(false);
    expect(EMAIL_MAX).toBe(320);
  });

  it('is the check the new-meeting form and the meeting’s Add guest use', () => {
    expect(addGuest([], 'a@b.c', '')).toEqual({ ok: false, error: 'Enter a valid email address, for example name@company.com.' });
    expect(addGuest([], 'a!b@x.com', '')).toMatchObject({ ok: false });
    expect(guestProblem('Ola', 'a..b@x.com', [])).toBe('Enter a valid email address for the guest (for example name@company.com), or leave it blank.');
    expect(guestProblem('Ola', 'ola@guest.com', [])).toBeNull();
  });
});
