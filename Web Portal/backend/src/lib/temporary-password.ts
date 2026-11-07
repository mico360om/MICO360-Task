import { randomInt } from 'node:crypto';
import { TEMPORARY_PASSWORD_WORDS } from './temporary-password-words';

/**
 * Temporary passwords an administrator gives someone themselves (never by email): made here with the
 * cryptographic generator, returned once and never stored in plain text.
 *
 *   words       "Kite-Mango-Ripple-Fern-472": 4 of 7,776 words + a 3-digit number ≈ 61.7 bits (easy to read aloud)
 *   characters  16 from 56 characters with no look-alikes (0 O 1 l I o) ≈ 92.9 bits, always a letter and a digit
 */
export const TEMPORARY_PASSWORD_STYLES = ['words', 'characters'] as const;
export type TemporaryPasswordStyle = (typeof TEMPORARY_PASSWORD_STYLES)[number];

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const WORDS = 4;
const NUMBER_RANGE = 1000;
const LENGTH = 16;

export const TEMPORARY_PASSWORD_BITS: Record<TemporaryPasswordStyle, number> = {
  words: WORDS * Math.log2(TEMPORARY_PASSWORD_WORDS.length) + Math.log2(NUMBER_RANGE),
  characters: LENGTH * Math.log2(ALPHABET.length),
};

/** `pick(max)`: a whole number from 0 to max − 1 (the cryptographic one unless a test passes its own). */
export function generateTemporaryPassword(style: TemporaryPasswordStyle, pick: (max: number) => number = (max) => randomInt(max)): string {
  if (style === 'words') {
    const words = Array.from({ length: WORDS }, () => {
      const w = TEMPORARY_PASSWORD_WORDS[pick(TEMPORARY_PASSWORD_WORDS.length)]!;
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
    return `${words.join('-')}-${String(pick(NUMBER_RANGE)).padStart(3, '0')}`;
  }
  // The password rule wants a letter and a digit: draw again until both are there (rarely needed).
  for (;;) {
    const p = Array.from({ length: LENGTH }, () => ALPHABET[pick(ALPHABET.length)]).join('');
    if (/[A-Za-z]/.test(p) && /\d/.test(p)) return p;
  }
}
