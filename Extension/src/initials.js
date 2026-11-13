/**
 * Initials from a name, from its letters only, as the web makes them (Web Portal/frontend/src/lib/initials.ts;
 * src/task-cards.test.js and src/project-identity.test.js run the web's copy over the same names):
 * any script, so Arabic names work; brackets, punctuation and digits are left out, and a part with
 * no letter ("-", "3", "(2)") is skipped. Pure (no DOM).
 */

/** The words of a name as their letters: "Mohammed (Acme)" → ["Mohammed", "Acme"]. */
export function letterWords(name) {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => (w.match(/\p{L}/gu) ?? []).join(''))
    .filter(Boolean);
}

/** A person's initials: the first letters of the first two words ("Mohammed (Acme)" → "MA"), one for one word, "?" for none. */
export function personInitials(name) {
  const words = letterWords(name);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => [...w][0])
    .join('')
    .toUpperCase();
}
