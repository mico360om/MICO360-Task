import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isLetterFallback, isNumberFallback, letterWords, numberWords, personInitials } from './initials';

describe('initials from letters only', () => {
  it('the first letter of the first two words; brackets, dashes and numbers left out', () => {
    expect(personInitials('Ada Lovelace')).toBe('AL');
    expect(personInitials(' omar  bin said ')).toBe('OB');
    expect(personInitials('Mohammed (OXY)')).toBe('MO');
    expect(personInitials('Sara - Ahmed')).toBe('SA');
    expect(personInitials('(2) Bilal Khan')).toBe('BK');
    expect(personInitials('محمد علي')).toBe('مع');
    expect(personInitials('Layla')).toBe('L');
    expect(personInitials('   ')).toBe('?');
    expect(personInitials('123 - !')).toBe('?');
    expect(letterWords('Rig - Phase 2')).toEqual(['Rig', 'Phase']);
    expect(numberWords('Phase 2 of 3')).toEqual(['2', '3']);
  });

  it('without the engine’s Unicode properties (Hermes), the stand-ins pick the same characters', () => {
    // Exact where the app's names are written: Latin, Greek, Cyrillic, Hebrew and Arabic, plus the
    // fullwidth forms; and the punctuation, symbols and emoji names carry. Unassigned code points aside.
    const L = /\p{L}/u;
    const N = /\p{N}/u;
    const unassigned = /\p{Cn}/u;
    const ranges: [number, number][] = [[0x0000, 0x04ff], [0x0590, 0x06ff], [0x2000, 0x206f], [0x3000, 0x303f], [0xfe00, 0xfe0f], [0xff00, 0xffef]];
    for (const [a, b] of ranges) {
      for (let c = a; c <= b; c++) {
        const ch = String.fromCodePoint(c);
        if (unassigned.test(ch)) continue;
        expect(isLetterFallback(ch), `U+${c.toString(16)}`).toBe(L.test(ch));
        if (c < 0x2000 || c >= 0xff00) expect(isNumberFallback(ch), `U+${c.toString(16)}`).toBe(N.test(ch));
      }
    }
    for (const ch of ['中', 'ア', 'あ', '한', 'ก', 'ж', 'α', 'ß', 'é']) expect(isLetterFallback(ch), ch).toBe(true);
    for (const ch of ['🚀', '😀', '👍', '️', '‍', '—', '·', '“', '«', '€', '→', '、', '。', '！', '(', '٣', '۳']) expect(isLetterFallback(ch), ch).toBe(false);
  });
});

/** The website's initials (Web Portal/frontend/src/lib/initials.ts) — its Avatar's and tiles' — must be the same here. */
const webInitials = resolve(__dirname, '../../../Web Portal/frontend/src/lib/initials.ts');
describe.skipIf(!existsSync(webInitials))('the same as the website', () => {
  it('makes the same initials from every name', async () => {
    const web = (await import(/* @vite-ignore */ webInitials)) as { letterWords: (n: string) => string[]; personInitials: (n: string) => string };
    const names = ['Ada Lovelace', ' omar  bin said ', 'Mohammed (OXY)', 'Yaqoob (OXY IT)', '"Sara" Ahmed', 'Sara - Ahmed', 'Crew 3 North', '(2) Bilal Khan', 'محمد علي', 'فاطمة (OXY)', 'مُحَمَّد', 'Layla', '(OXY)', 'Omar 42', 'émile zola', '🚀 Launch', 'Ünïcode Work', '', '   ', '123 - !', '— · —'];
    for (const n of names) {
      expect(personInitials(n), n).toBe(web.personInitials(n));
      expect(letterWords(n), n).toEqual(web.letterWords(n));
    }
  });
});
