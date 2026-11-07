/**
 * Onboarding: the rules for an account's details — the same on the server, which enforces them, and on
 * the website, which shows them next to each field while typing. The website keeps an identical copy
 * (frontend/src/lib/account-rules.ts); its account-rules-copy test fails when the two drift.
 *
 * Emails are compared trimmed and case-insensitive (as the database's collation compares them).
 * Usernames: 3–32 letters (any alphabet) or numbers, and . _ - . Phones: digits, an optional + at the
 * start, spaces. Names are required; a client's organisation too.
 */

export const NAME_MAX = 191;
export const EMAIL_MAX = 191;
export const ORGANISATION_MAX = 160;
export const PHONE_MAX = 40;

export const RULE_WORDS = {
  name: 'Required.',
  email: 'An email address, like name@company.com.',
  username: '3–32 letters or numbers, and . _ - (no spaces).',
  phone: 'Digits, with an optional + at the start and spaces.',
  organisation: 'Required for a client: the company they are from.',
} as const;

export const PROBLEM_WORDS = {
  firstName: 'Enter a first name.',
  lastName: 'Enter a last name.',
  email: 'Enter a valid email address, like name@company.com.',
  username: 'Use 3–32 letters or numbers, and . _ - (no spaces).',
  phone: 'Use digits, with an optional + at the start and spaces (at least 6 digits).',
  organisation: 'Enter the client’s organisation.',
  tooLong: (max: number) => `Use at most ${max} characters.`,
} as const;

const USERNAME = /^[\p{L}\p{N}._-]{3,32}$/u;
const PHONE = /^\+?[0-9 ]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An email as compared: trimmed, lower case. */
export const emailKey = (email: string): string => String(email ?? '').trim().toLowerCase();

/** The same address, whatever its case and the spaces around it? */
export const sameEmail = (a: string, b: string): boolean => emailKey(a) === emailKey(b);

/** A first or last name's problem, or null. */
export function nameProblem(value: string, which: 'firstName' | 'lastName'): string | null {
  const v = String(value ?? '').trim();
  if (!v) return PROBLEM_WORDS[which];
  if (v.length > NAME_MAX) return PROBLEM_WORDS.tooLong(NAME_MAX);
  return null;
}

export function emailProblem(value: string): string | null {
  const v = String(value ?? '').trim();
  if (v.length > EMAIL_MAX) return PROBLEM_WORDS.tooLong(EMAIL_MAX);
  return EMAIL.test(v) ? null : PROBLEM_WORDS.email;
}

export function usernameProblem(value: string): string | null {
  return USERNAME.test(String(value ?? '').trim()) ? null : PROBLEM_WORDS.username;
}

/** A phone is optional: empty is fine. */
export function phoneProblem(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (v.length > PHONE_MAX) return PROBLEM_WORDS.tooLong(PHONE_MAX);
  return PHONE.test(v) && v.replace(/\D/g, '').length >= 6 ? null : PROBLEM_WORDS.phone;
}

/** A client's organisation is required; staff have none. */
export function organisationProblem(value: string | null | undefined, required: boolean): string | null {
  const v = String(value ?? '').trim();
  if (v.length > ORGANISATION_MAX) return PROBLEM_WORDS.tooLong(ORGANISATION_MAX);
  return required && !v ? PROBLEM_WORDS.organisation : null;
}

export interface AccountDetails {
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  phone?: string | null;
  organisation?: string | null;
}

/** Every field's problem (only the fields given), by field name. Empty: all good. */
export function accountProblems(d: AccountDetails, opts: { client?: boolean } = {}): Partial<Record<keyof AccountDetails, string>> {
  const out: Partial<Record<keyof AccountDetails, string>> = {};
  const put = (k: keyof AccountDetails, p: string | null) => {
    if (p) out[k] = p;
  };
  if (d.firstName !== undefined) put('firstName', nameProblem(d.firstName, 'firstName'));
  if (d.lastName !== undefined) put('lastName', nameProblem(d.lastName, 'lastName'));
  if (d.email !== undefined) put('email', emailProblem(d.email));
  if (d.username !== undefined) put('username', usernameProblem(d.username));
  if (d.phone !== undefined) put('phone', phoneProblem(d.phone));
  if (d.organisation !== undefined || opts.client) put('organisation', organisationProblem(d.organisation, !!opts.client));
  return out;
}
