import { describe, it, expect } from 'vitest';
import { accountProblems, emailKey, emailProblem, organisationProblem, phoneProblem, sameEmail, usernameProblem, PROBLEM_WORDS } from './account-rules';

describe('Account detail rules (server and website alike)', () => {
  it('emails compare trimmed and case-insensitive', () => {
    expect(sameEmail(' Ahmed@Acme.com ', 'ahmed@acme.com')).toBe(true);
    expect(sameEmail('ahmed@acme.com', 'ahmed@acme.co')).toBe(false);
    expect(emailKey('  A@B.C ')).toBe('a@b.c');
  });

  it('email format', () => {
    expect(emailProblem('name@company.com')).toBeNull();
    expect(emailProblem(' name@company.com ')).toBeNull();
    for (const bad of ['', 'name', 'name@', '@x.co', 'a b@x.co', 'name@company']) expect(emailProblem(bad), bad).toBe(PROBLEM_WORDS.email);
    expect(emailProblem(`${'a'.repeat(190)}@x.co`)).toBe(PROBLEM_WORDS.tooLong(191));
  });

  it('username: 3–32 letters (any alphabet) or numbers, and . _ -', () => {
    for (const ok of ['ada', 'saif.k', 'ahmed_al-harthy', 'u123', 'سيف', 'a'.repeat(32)]) expect(usernameProblem(ok), ok).toBeNull();
    for (const bad of ['', 'ab', 'a'.repeat(33), 'with space', 'at@sign', 'semi;colon']) expect(usernameProblem(bad), bad).toBe(PROBLEM_WORDS.username);
  });

  it('phone: optional; digits with an optional + at the start and spaces, at least 6 digits', () => {
    for (const ok of ['', '+968 9000 0001', '96890000001', '9000 0001']) expect(phoneProblem(ok), ok).toBeNull();
    expect(phoneProblem(null)).toBeNull();
    for (const bad of ['12345', '+968-9000-0001', '(968) 9000', '9000 0001 ext 2', '++968 9000 0001', '968+90000001']) expect(phoneProblem(bad), bad).toBe(PROBLEM_WORDS.phone);
    expect(phoneProblem('1'.repeat(41))).toBe(PROBLEM_WORDS.tooLong(40));
  });

  it('organisation: required for a client, never for staff', () => {
    expect(organisationProblem('', true)).toBe(PROBLEM_WORDS.organisation);
    expect(organisationProblem('  ', true)).toBe(PROBLEM_WORDS.organisation);
    expect(organisationProblem('Acme', true)).toBeNull();
    expect(organisationProblem('', false)).toBeNull();
    expect(organisationProblem('x'.repeat(161), false)).toBe(PROBLEM_WORDS.tooLong(160));
  });

  it('all at once, by field (only the fields given are judged)', () => {
    expect(accountProblems({ firstName: ' ', lastName: 'K', email: 'x', username: 'ab', phone: 'abc' }, { client: true })).toEqual({
      firstName: PROBLEM_WORDS.firstName,
      email: PROBLEM_WORDS.email,
      username: PROBLEM_WORDS.username,
      phone: PROBLEM_WORDS.phone,
      organisation: PROBLEM_WORDS.organisation,
    });
    expect(accountProblems({ firstName: 'Ada' })).toEqual({});
  });
});
