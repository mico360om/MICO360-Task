import { describe, it, expect } from 'vitest';
import { isStrongPassword } from './password-policy';

describe('isStrongPassword', () => {
  it('accepts a password with 8+ chars including a letter and a digit', () => {
    expect(isStrongPassword('Password1!')).toBe(true);
    expect(isStrongPassword('abcd1234')).toBe(true);
  });
  it('rejects passwords shorter than 8 characters', () => {
    expect(isStrongPassword('Ab1')).toBe(false);
    expect(isStrongPassword('Abc123!')).toBe(false); // 7 chars
  });
  it('rejects passwords with no digit', () => {
    expect(isStrongPassword('abcdefgh')).toBe(false);
  });
  it('rejects passwords with no letter', () => {
    expect(isStrongPassword('12345678')).toBe(false);
  });
});
