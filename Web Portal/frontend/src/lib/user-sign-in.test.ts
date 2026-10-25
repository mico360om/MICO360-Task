import { describe, it, expect } from 'vitest';
import {
  signInText,
  welcomeSentText,
  welcomeConfirmTitle,
  welcomeBatchSummary,
  welcomeCandidates,
  sortBySignIn,
  MAX_WELCOME_BATCH,
} from './user-sign-in';

type U = { id: string; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; lastLoginAt?: string | null };
const u = (id: string, lastLoginAt: string | null, status: U['status'] = 'ACTIVE'): U => ({ id, status, lastLoginAt });

describe('signInText — "Last sign-in" in User Management', () => {
  it('the date and time in the company time zone', () => {
    expect(signInText('2026-10-24T05:12:00.000Z', 'Asia/Muscat')).toBe('24 Oct 2026, 09:12');
    expect(signInText('2026-10-24T05:12:00.000Z', 'UTC')).toBe('24 Oct 2026, 05:12');
  });

  it('says "Never signed in" when there is none', () => {
    expect(signInText(null, 'Asia/Muscat')).toBe('Never signed in');
    expect(signInText(undefined, 'Asia/Muscat')).toBe('Never signed in');
  });

  it('September is "Sep" (some browsers write "Sept"), and midnight is 00:00', () => {
    expect(signInText('2026-09-02T20:00:00.000Z', 'Asia/Muscat')).toBe('3 Sep 2026, 00:00');
  });
});

describe('welcomeSentText', () => {
  const now = new Date('2026-10-25T06:00:00.000Z');
  it('"Welcome email sent 24 Oct" this year, with the year otherwise', () => {
    expect(welcomeSentText('2026-10-24T05:12:00.000Z', 'Asia/Muscat', now)).toBe('Welcome email sent 24 Oct');
    expect(welcomeSentText('2025-12-31T21:00:00.000Z', 'Asia/Muscat', now)).toBe('Welcome email sent 1 Jan');
    expect(welcomeSentText('2025-12-30T10:00:00.000Z', 'Asia/Muscat', now)).toBe('Welcome email sent 30 Dec 2025');
  });
});

describe('the bulk send’s words', () => {
  it('asks first with the count', () => {
    expect(welcomeConfirmTitle(12)).toBe('Send welcome emails to 12 people?');
    expect(welcomeConfirmTitle(1)).toBe('Send a welcome email to 1 person?');
  });

  it('then says how it went', () => {
    expect(welcomeBatchSummary({ sent: 11, notSent: 1 })).toBe('Sent 11. 1 not sent:');
    expect(welcomeBatchSummary({ sent: 12, notSent: 0 })).toBe('Sent 12.');
    expect(welcomeBatchSummary({ sent: 0, notSent: 3 })).toBe('Sent 0. 3 not sent:');
  });

  it('sends to at most 200 people at a time (the server’s limit)', () => {
    expect(MAX_WELCOME_BATCH).toBe(200);
  });
});

describe('welcomeCandidates — "Everyone who has never signed in"', () => {
  it('the active people who have never signed in (inactive and suspended accounts can’t get one)', () => {
    const people = [u('a', null), u('b', '2026-10-01T00:00:00Z'), u('c', null, 'SUSPENDED'), u('d', null, 'INACTIVE'), u('e', null)];
    expect(welcomeCandidates(people).map((p) => p.id)).toEqual(['a', 'e']);
  });
});

describe('sortBySignIn', () => {
  const people = [u('new', null), u('mid', '2026-10-10T00:00:00Z'), u('late', '2026-10-20T00:00:00Z'), u('never', null), u('early', '2026-10-01T00:00:00Z')];
  it('keeps the list’s own order (newest accounts first) by default', () => {
    expect(sortBySignIn(people, 'newest').map((p) => p.id)).toEqual(['new', 'mid', 'late', 'never', 'early']);
  });
  it('latest sign-in first, never signed in last', () => {
    expect(sortBySignIn(people, 'signin-latest').map((p) => p.id)).toEqual(['late', 'mid', 'early', 'new', 'never']);
  });
  it('never signed in first, then the earliest sign-in', () => {
    expect(sortBySignIn(people, 'signin-earliest').map((p) => p.id)).toEqual(['new', 'never', 'early', 'mid', 'late']);
  });
  it('does not change the list it was given', () => {
    const copy = [...people];
    sortBySignIn(people, 'signin-latest');
    expect(people).toEqual(copy);
  });
});
