import { describe, it, expect } from 'vitest';
import {
  signInText,
  welcomeSentText,
  welcomeConfirmTitle,
  welcomeOneConfirmTitle,
  welcomeBatchSummary,
  welcomeCandidates,
  leftOutText,
  namesText,
  welcomeBlockedReason,
  sortBySignIn,
  MAX_WELCOME_BATCH,
  SIGN_OUT_NOTE,
} from './user-sign-in';

type U = { id: string; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; lastLoginAt?: string | null; welcomeSentAt?: string | null };
const u = (id: string, lastLoginAt: string | null, status: U['status'] = 'ACTIVE', welcomeSentAt: string | null = null): U => ({ id, status, lastLoginAt, welcomeSentAt });

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

  it('sends to at most 100 people at a time (the server’s limit)', () => {
    expect(MAX_WELCOME_BATCH).toBe(100);
  });
});

describe('welcomeCandidates — "Everyone who has never signed in"', () => {
  const now = new Date('2026-10-25T06:00:00.000Z');
  it('the active people who have never signed in (inactive and suspended accounts can’t get one)', () => {
    const people = [u('a', null), u('b', '2026-10-01T00:00:00Z'), u('c', null, 'SUSPENDED'), u('d', null, 'INACTIVE'), u('e', null)];
    expect(welcomeCandidates(people, now)).toEqual({ pick: [people[0], people[4]], leftOut: 0 });
  });

  it('leaves out anyone sent one in the last 7 days (their link may still be in use), and counts them', () => {
    const people = [
      u('a', null, 'ACTIVE', '2026-10-24T08:00:00.000Z'),
      u('b', null, 'ACTIVE', '2026-10-18T06:00:01.000Z'),
      u('c', null, 'ACTIVE', '2026-10-18T06:00:00.000Z'),
      u('d', null),
      u('e', null, 'SUSPENDED', '2026-10-24T08:00:00.000Z'),
    ];
    const { pick, leftOut } = welcomeCandidates(people, now);
    expect(pick.map((p) => p.id)).toEqual(['c', 'd']);
    expect(leftOut).toBe(2);
  });

  it('says how many were left out, and why', () => {
    expect(leftOutText(3)).toBe('3 people were sent one in the last 7 days and are left out.');
    expect(leftOutText(1)).toBe('1 person was sent one in the last 7 days and is left out.');
  });
});

describe('who a send goes to, and what it does', () => {
  it('names up to 10 people, then how many more', () => {
    expect(namesText(['Ada K', 'Bo T'])).toBe('Ada K, Bo T');
    const twelve = Array.from({ length: 12 }, (_, i) => `P${i + 1}`);
    expect(namesText(twelve)).toBe('P1, P2, P3, P4, P5, P6, P7, P8, P9, P10 and 2 more');
    expect(namesText(twelve.slice(0, 10))).toBe('P1, P2, P3, P4, P5, P6, P7, P8, P9, P10');
  });

  it('one person: asks with their name and address', () => {
    expect(welcomeOneConfirmTitle('Sara K', 'sara@x.co')).toBe('Send a welcome email to Sara K (sara@x.co)?');
  });

  it('says that using the link signs them out everywhere else', () => {
    expect(SIGN_OUT_NOTE).toBe('Using the link signs them out of MICO360 Tasks on their other devices (the app and the extension too).');
  });
});

describe('welcomeBlockedReason — why a row’s "Send welcome email" can’t be used', () => {
  const base = { id: 'u1', status: 'ACTIVE' as const, email: 'a@x.co', locked: false };
  it('your own row, an inactive or suspended account, or no email address', () => {
    expect(welcomeBlockedReason(base, 'u1')).toBe('You can’t send yourself a welcome email');
    expect(welcomeBlockedReason({ ...base, status: 'INACTIVE' }, 'me')).toBe('This account is inactive, so it can’t get a welcome email');
    expect(welcomeBlockedReason({ ...base, status: 'SUSPENDED' }, 'me')).toBe('This account is suspended, so it can’t get a welcome email');
    expect(welcomeBlockedReason({ ...base, email: ' ' }, 'me')).toBe('This account has no email address');
  });

  it('a locked account can still be sent one (the server says how it went)', () => {
    expect(welcomeBlockedReason({ ...base, locked: true }, 'me')).toBeNull();
    expect(welcomeBlockedReason(base, 'me')).toBeNull();
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
