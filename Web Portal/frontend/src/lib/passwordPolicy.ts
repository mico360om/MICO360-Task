/**
 * The one password rule used by every password form (create, admin reset, self-change, emailed
 * reset). It mirrors the server's `isStrongPassword` policy so a password the form accepts is
 * never rejected by the API, and the hint text is identical everywhere.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Human-readable rule, shown as the hint under every new-password field. */
export const PASSWORD_RULE_HINT = 'At least 8 characters, with a letter and a number.';

/** Error shown when a new password doesn't meet the rule. */
export const PASSWORD_RULE_ERROR = 'Use at least 8 characters, including a letter and a number.';

/** 8+ characters with at least one letter and one digit (same as the backend policy). */
export function isStrongPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && /[A-Za-z]/.test(password) && /\d/.test(password);
}
