/**
 * Initials from a name, from its letters only, as the website makes them (Web Portal/frontend/src/lib/initials.ts,
 * used by its Avatar and project tiles; the tests run the website's copy over the same names): any
 * script, so Arabic names work; brackets, punctuation and digits are left out, and a part with no
 * letter ("-", "3", "(2)") is skipped. Pure TypeScript.
 *
 * Careful: no Unicode property escapes in regex literals here. The website matches letters with
 * /\p{L}/u, but the app's Babel rewrites such a literal into the wrong character class without a
 * warning, and Hermes has none at all (see lib/mentions.ts). Where the engine has them they are
 * built at run time; elsewhere `isLetterFallback` and `isNumberFallback` stand in.
 */

const inRanges = (c: number, ranges: readonly (readonly [number, number])[]) => ranges.some(([a, b]) => c >= a && c <= b);

/** The Arabic block's letters (U+0600–U+06FF); the rest of it is signs, marks, digits and punctuation. */
const ARABIC_LETTERS = [[0x0620, 0x064a], [0x066e, 0x066f], [0x0671, 0x06d3], [0x06d5, 0x06d5], [0x06e5, 0x06e6], [0x06ee, 0x06ef], [0x06fa, 0x06fc], [0x06ff, 0x06ff]] as const;
/** The Hebrew block's letters (U+0590–U+05FF); the rest of it is points, marks and punctuation. */
const HEBREW_LETTERS = [[0x05d0, 0x05ea], [0x05ef, 0x05f2]] as const;
/** Not letters beyond Latin-1: marks, punctuation, symbols, digits, emoji and the like. */
const NOT_LETTERS = [
  [0x02c2, 0x02c5], [0x02d2, 0x02df], [0x02e5, 0x02eb], [0x02ed, 0x02ed], [0x02ef, 0x02ff], // spacing modifier symbols
  [0x0300, 0x036f], // combining marks
  [0x0375, 0x0375], [0x037e, 0x037e], [0x0384, 0x0385], [0x0387, 0x0387], [0x03f6, 0x03f6], // Greek signs and punctuation
  [0x0482, 0x0489], // Cyrillic signs and marks
  [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], // more combining marks
  [0x2000, 0x2bff], // general punctuation, currency, arrows, maths, shapes, symbols
  [0x3000, 0x3004], [0x3007, 0x3030], [0x3036, 0x303a], [0x303d, 0x303f], // CJK punctuation
  [0xd800, 0xf8ff], // lone surrogate halves and private use
  [0xfe00, 0xfe6f], [0xfeff, 0xfeff], // variation selectors (an emoji's U+FE0F), CJK forms, zero-width no-break space
  [0xff00, 0xff20], [0xff3b, 0xff40], [0xff5b, 0xff65], // fullwidth digits and punctuation
  [0xffe0, 0xffee], [0xfff0, 0xffff], // fullwidth signs and symbols, specials
] as const;

/**
 * Is `ch` (one character, by code point) a letter in any script — without Unicode property
 * escapes? Exact for Latin, Greek, Cyrillic, Hebrew and Arabic; beyond them, everything but marks,
 * punctuation, symbols and emoji (anything past the basic plane counts as an emoji).
 */
export function isLetterFallback(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  if (c < 0x80) return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  if (c <= 0xff) return c === 0xaa || c === 0xb5 || c === 0xba || (c >= 0xc0 && c !== 0xd7 && c !== 0xf7);
  if (c >= 0x0590 && c <= 0x05ff) return inRanges(c, HEBREW_LETTERS);
  if (c >= 0x0600 && c <= 0x06ff) return inRanges(c, ARABIC_LETTERS);
  return c <= 0xffff && !inRanges(c, NOT_LETTERS);
}

/** Is `ch` a digit or number (Latin, Arabic-Indic, Persian, fullwidth; ² ³ ¹ ¼ ½ ¾) — without Unicode property escapes? */
export function isNumberFallback(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x30 && c <= 0x39) ||
    c === 0xb2 || c === 0xb3 || c === 0xb9 || (c >= 0xbc && c <= 0xbe) ||
    (c >= 0x0660 && c <= 0x0669) || (c >= 0x06f0 && c <= 0x06f9) ||
    (c >= 0xff10 && c <= 0xff19)
  );
}

/** The engine's own test for a Unicode property, when it has one that works; else the fallback. */
function propertyTest(property: string, fallback: (ch: string) => boolean, works: (re: RegExp) => boolean): (ch: string) => boolean {
  try {
    const re = new RegExp(`\\p{${property}}`, 'u');
    // Guard against an engine that accepts the pattern but means something else by it.
    return works(re) ? (ch: string) => re.test(ch) : fallback;
  } catch {
    return fallback;
  }
}

const isLetter = propertyTest('L', isLetterFallback, (re) => re.test('a') && re.test('أ') && !re.test('(') && !re.test('1') && !re.test('{'));
const isNumber = propertyTest('N', isNumberFallback, (re) => re.test('1') && re.test('٣') && !re.test('a') && !re.test('{'));

/** The words of a name as their characters of one kind: "Mohammed (Acme)" → ["Mohammed", "Acme"] for letters. */
const wordsOf = (name: string, keep: (ch: string) => boolean): string[] =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => [...w].filter(keep).join(''))
    .filter(Boolean);

/** The words of a name as their letters: "Mohammed (Acme)" → ["Mohammed", "Acme"]. */
export function letterWords(name: string): string[] {
  return wordsOf(name, isLetter);
}

/** The words of a name as their digits, for a project name with no letter at all: "2026" → ["2026"]. */
export function numberWords(name: string): string[] {
  return wordsOf(name, isNumber);
}

/** A person's initials: the first letters of the first two words ("Mohammed (Acme)" → "MA"), one for one word, "?" for none. */
export function personInitials(name: string): string {
  const words = letterWords(name);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();
}
