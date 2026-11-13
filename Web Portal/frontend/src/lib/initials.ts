/**
 * Initials from a name, from its letters only (any script, so Arabic names work): brackets,
 * punctuation and digits are left out, and a part with no letter ("-", "3", "(2)") is skipped.
 */

/** The words of a name as their letters: "Mohammed (Acme)" → ["Mohammed", "Acme"]. */
export function letterWords(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w.match(/\p{L}/gu) ?? []).join(''))
    .filter(Boolean);
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
