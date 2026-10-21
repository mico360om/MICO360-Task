/**
 * An email address the server takes (2c review). The server checks a guest's address with zod's
 * `.email()` — zod 3.25, the server's version — after trimming, and at most 320 characters. The
 * phone checks the same, so Schedule is never refused with only "Invalid input." for an address
 * the phone let through: letters a–z, digits and _ ' + - . before the @ (not starting with a dot,
 * no two dots in a row, not ending in . or '), and a domain of parts ending in two or more letters.
 */

/** The longest address the server keeps. */
export const EMAIL_MAX = 320;

/** zod 3.25's email pattern (zod/v3 types.js `emailRegex`). */
const ZOD_EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

/** Would the server take this as an email address (trimmed, as it trims)? */
export function isServerEmail(email: string): boolean {
  const e = email.trim();
  return e.length > 0 && e.length <= EMAIL_MAX && ZOD_EMAIL.test(e);
}
