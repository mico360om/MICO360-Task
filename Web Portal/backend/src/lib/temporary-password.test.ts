import { describe, it, expect } from 'vitest';
import { generateTemporaryPassword, TEMPORARY_PASSWORD_BITS, TEMPORARY_PASSWORD_STYLES } from './temporary-password';
import { TEMPORARY_PASSWORD_WORDS } from './temporary-password-words';
import { isStrongPassword } from './password-policy';

describe('temporary passwords (made on the server, shown once)', () => {
  it('the word list: 7,776 different everyday words of 4–7 letters', () => {
    expect(TEMPORARY_PASSWORD_WORDS).toHaveLength(7776);
    expect(new Set(TEMPORARY_PASSWORD_WORDS).size).toBe(7776);
    for (const w of TEMPORARY_PASSWORD_WORDS) expect(w).toMatch(/^[a-z]{4,7}$/);
  });

  it('words: four capitalised words and a three-digit number, joined by hyphens', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword('words');
      expect(p).toMatch(/^([A-Z][a-z]{3,6}-){4}\d{3}$/);
      const words = p.split('-').slice(0, 4).map((w) => w.toLowerCase());
      for (const w of words) expect(TEMPORARY_PASSWORD_WORDS).toContain(w);
      expect(isStrongPassword(p)).toBe(true);
    }
  });

  it('characters: 16 from an alphabet without look-alikes (no 0 O 1 l I o), always a letter and a digit', () => {
    for (let i = 0; i < 500; i++) {
      const p = generateTemporaryPassword('characters');
      expect(p).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{16}$/);
      expect(isStrongPassword(p)).toBe(true);
    }
  });

  it('both styles carry at least 60 bits (call 3)', () => {
    expect(TEMPORARY_PASSWORD_STYLES).toEqual(['words', 'characters']);
    expect(TEMPORARY_PASSWORD_BITS.words).toBeCloseTo(4 * Math.log2(7776) + Math.log2(1000), 5);
    expect(TEMPORARY_PASSWORD_BITS.words).toBeGreaterThanOrEqual(60);
    expect(TEMPORARY_PASSWORD_BITS.characters).toBeGreaterThanOrEqual(90);
  });

  it('never the same twice (10,000 of each style)', () => {
    for (const style of TEMPORARY_PASSWORD_STYLES) {
      const seen = new Set<string>();
      for (let i = 0; i < 10_000; i++) seen.add(generateTemporaryPassword(style));
      expect(seen.size).toBe(10_000);
    }
  });

  it('every word and every number can come up (each position reads the whole range)', () => {
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
    const W = TEMPORARY_PASSWORD_WORDS;
    expect(generateTemporaryPassword('words', () => 0)).toBe(`${[W[0], W[0], W[0], W[0]].map((w) => cap(w!)).join('-')}-000`);
    expect(generateTemporaryPassword('words', (max) => max - 1)).toBe(`${[W[7775], W[7775], W[7775], W[7775]].map((w) => cap(w!)).join('-')}-999`);
  });
});
