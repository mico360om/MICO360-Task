import { describe, it, expect } from 'vitest';
import { isStrongPassword, PASSWORD_RULE_HINT } from './passwordPolicy';

describe('isStrongPassword', () => {
  it('accepts 8+ characters with a letter and a number', () => {
    expect(isStrongPassword('abcdefg1')).toBe(true);
    expect(isStrongPassword('FreshPass1!')).toBe(true);
  });

  it('rejects short, letter-only and digit-only passwords', () => {
    expect(isStrongPassword('abc123')).toBe(false); // the old 6-character rule
    expect(isStrongPassword('aaaaaaaa')).toBe(false);
    expect(isStrongPassword('12345678')).toBe(false);
    expect(isStrongPassword('')).toBe(false);
  });

  it('describes the same rule the server enforces', () => {
    expect(PASSWORD_RULE_HINT).toMatch(/8 characters/);
    expect(PASSWORD_RULE_HINT).toMatch(/letter and a number/);
  });
});
