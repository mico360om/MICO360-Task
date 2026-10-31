import { describe, it, expect } from 'vitest';
import {
  MAX_WELCOME_BATCH,
  SIGN_OUT_NOTE,
  leftOutText,
  namesText,
  signInText,
  sortBySignIn,
  welcomeBatchSummary,
  welcomeBlockedReason,
  welcomeCandidates,
  welcomeConfirmTitle,
  welcomeOneConfirmTitle,
  welcomeSentText,
} from './user-sign-in';
import { appSource, hasWeb, readWeb, webPath } from '../testing/web-source';

const NOW = new Date('2026-10-30T08:00:00Z');
const TZ = 'Asia/Muscat';
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

type Person = { id: string; email: string; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; lastLoginAt?: string | null; welcomeSentAt?: string | null; locked?: boolean };
/** Everyone the rules tell apart, in the server's order (newest accounts first). */
const PEOPLE: Person[] = [
  { id: 'never', email: 'never@mico360.com', status: 'ACTIVE', lastLoginAt: null },
  { id: 'signed', email: 'signed@mico360.com', status: 'ACTIVE', lastLoginAt: '2026-10-24T05:12:00Z' },
  { id: 'welcomed3', email: 'w3@mico360.com', status: 'ACTIVE', lastLoginAt: null, welcomeSentAt: ago(3) },
  { id: 'welcomed9', email: 'w9@mico360.com', status: 'ACTIVE', lastLoginAt: null, welcomeSentAt: ago(9) },
  { id: 'inactive', email: 'in@mico360.com', status: 'INACTIVE', lastLoginAt: null },
  { id: 'suspended', email: 'su@mico360.com', status: 'SUSPENDED', lastLoginAt: '2026-09-01T10:00:00Z' },
  { id: 'locked', email: 'lo@mico360.com', status: 'ACTIVE', lastLoginAt: null, locked: true },
  { id: 'noemail', email: '  ', status: 'ACTIVE', lastLoginAt: '2026-10-29T20:30:00Z' },
  { id: 'me', email: 'me@mico360.com', status: 'ACTIVE', lastLoginAt: '2026-10-30T07:00:00Z' },
];
const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe('sign-ins and welcome emails, in words', () => {
  it('the last sign-in in the company’s time zone, or "Never signed in"', () => {
    expect(signInText('2026-10-24T05:12:00Z', TZ)).toBe('24 Oct 2026, 09:12');
    expect(signInText('2025-09-01T20:30:00Z', TZ)).toBe('2 Sep 2025, 00:30');
    expect(signInText(null, TZ)).toBe('Never signed in');
    expect(signInText(undefined, TZ)).toBe('Never signed in');
  });

  it('when the welcome email went: the year only when it isn’t this one', () => {
    expect(welcomeSentText('2026-10-24T05:12:00Z', TZ, NOW)).toBe('Welcome email sent 24 Oct');
    // 21:00 on 31 Dec in UTC is already 1 Jan in Muscat.
    expect(welcomeSentText('2025-12-31T21:00:00Z', TZ, NOW)).toBe('Welcome email sent 1 Jan');
    expect(welcomeSentText('2025-12-30T08:00:00Z', TZ, NOW)).toBe('Welcome email sent 30 Dec 2025');
  });

  it('the questions and the answer of a send', () => {
    expect(welcomeOneConfirmTitle('Sara Ali', 'sara@mico360.com')).toBe('Send a welcome email to Sara Ali (sara@mico360.com)?');
    expect([welcomeConfirmTitle(1), welcomeConfirmTitle(12)]).toEqual(['Send a welcome email to 1 person?', 'Send welcome emails to 12 people?']);
    expect([leftOutText(1), leftOutText(3)]).toEqual(['1 person was sent one in the last 7 days and is left out.', '3 people were sent one in the last 7 days and are left out.']);
    expect(namesText(['a', 'b'])).toBe('a, b');
    expect(namesText(Array.from({ length: 12 }, (_, i) => `p${i}`))).toBe('p0, p1, p2, p3, p4, p5, p6, p7, p8, p9 and 2 more');
    expect([welcomeBatchSummary({ sent: 11, notSent: 1 }), welcomeBatchSummary({ sent: 3, notSent: 0 })]).toEqual(['Sent 11. 1 not sent:', 'Sent 3.']);
    expect(MAX_WELCOME_BATCH).toBe(100);
  });
});

describe('who can be sent one', () => {
  it('everyone who never signed in: active, and not welcomed in the last 7 days (counted as left out)', () => {
    expect(ids(welcomeCandidates(PEOPLE, NOW).pick)).toEqual(['never', 'welcomed9', 'locked']);
    expect(welcomeCandidates(PEOPLE, NOW).leftOut).toBe(1);
  });

  it('a row’s button says why it can’t be used; a locked account can', () => {
    expect(welcomeBlockedReason(PEOPLE[8]!, 'me')).toBe('You can’t send yourself a welcome email');
    expect(welcomeBlockedReason(PEOPLE[4]!, 'me')).toBe('This account is inactive, so it can’t get a welcome email');
    expect(welcomeBlockedReason(PEOPLE[5]!, 'me')).toBe('This account is suspended, so it can’t get a welcome email');
    expect(welcomeBlockedReason(PEOPLE[7]!, 'me')).toBe('This account has no email address');
    expect(welcomeBlockedReason(PEOPLE[6]!, 'me')).toBeNull();
  });

  it('sorts by last sign-in, never-signed-in last (latest first) or first (earliest first); newest keeps the list', () => {
    expect(ids(sortBySignIn(PEOPLE, 'newest'))).toEqual(ids(PEOPLE));
    expect(ids(sortBySignIn(PEOPLE, 'signin-latest'))).toEqual(['me', 'noemail', 'signed', 'suspended', 'never', 'welcomed3', 'welcomed9', 'inactive', 'locked']);
    expect(ids(sortBySignIn(PEOPLE, 'signin-earliest'))).toEqual(['never', 'welcomed3', 'welcomed9', 'inactive', 'locked', 'suspended', 'signed', 'noemail', 'me']);
    expect(sortBySignIn(PEOPLE, 'newest')).not.toBe(PEOPLE);
  });
});

describe.skipIf(!hasWeb('frontend/src/lib/user-sign-in.ts'))('the website’s sign-in and welcome rules', () => {
  it('same words and the same picks', async () => {
    const web = (await import(/* @vite-ignore */ webPath('frontend/src/lib/user-sign-in.ts'))) as Record<string, (...a: unknown[]) => unknown> & { MAX_WELCOME_BATCH: number; SIGN_OUT_NOTE: string };
    for (const iso of [null, '2026-10-24T05:12:00Z', '2025-03-01T20:30:00Z', '2026-09-30T23:59:00Z']) expect(signInText(iso, TZ)).toBe(web.signInText!(iso, TZ));
    for (const iso of ['2026-10-24T05:12:00Z', '2025-12-31T21:00:00Z', '2025-12-30T08:00:00Z', '2026-09-03T05:00:00Z']) expect(welcomeSentText(iso, TZ, NOW)).toBe(web.welcomeSentText!(iso, TZ, NOW));
    expect(ids(welcomeCandidates(PEOPLE, NOW).pick)).toEqual(ids((web.welcomeCandidates!(PEOPLE, NOW) as { pick: Person[] }).pick));
    expect(welcomeCandidates(PEOPLE, NOW).leftOut).toBe((web.welcomeCandidates!(PEOPLE, NOW) as { leftOut: number }).leftOut);
    for (const s of ['newest', 'signin-latest', 'signin-earliest'] as const) expect(ids(sortBySignIn(PEOPLE, s)), s).toEqual(ids(web.sortBySignIn!(PEOPLE, s) as Person[]));
    for (const p of PEOPLE) expect(welcomeBlockedReason(p, 'me'), p.id).toBe(web.welcomeBlockedReason!(p, 'me'));
    for (const n of [1, 2, 12]) {
      expect(leftOutText(n)).toBe(web.leftOutText!(n));
      expect(welcomeConfirmTitle(n)).toBe(web.welcomeConfirmTitle!(n));
    }
    for (const r of [{ sent: 11, notSent: 1 }, { sent: 0, notSent: 2 }, { sent: 3, notSent: 0 }]) expect(welcomeBatchSummary(r)).toBe(web.welcomeBatchSummary!(r));
    expect(welcomeOneConfirmTitle('Sara Ali', 'sara@mico360.com')).toBe(web.welcomeOneConfirmTitle!('Sara Ali', 'sara@mico360.com'));
    const twelve = Array.from({ length: 12 }, (_, i) => `p${i}`);
    expect(namesText(twelve)).toBe(web.namesText!(twelve));
    expect(namesText(twelve.slice(0, 4))).toBe(web.namesText!(twelve.slice(0, 4)));
    expect([MAX_WELCOME_BATCH, SIGN_OUT_NOTE]).toEqual([web.MAX_WELCOME_BATCH, web.SIGN_OUT_NOTE]);
  });
});

describe.skipIf(!hasWeb('backend/src/modules/users/user-routes.ts'))('the server’s welcome limit', () => {
  it('is the one the app’s call says (final pass, item 9)', () => {
    const server = Number(/const MAX_WELCOME_BATCH = (\d+);/.exec(readWeb('backend/src/modules/users/user-routes.ts'))?.[1]);
    expect(server).toBe(MAX_WELCOME_BATCH);
    expect(appSource('lib/resources.ts')).toContain(`Welcome emails for several people (up to ${server})`);
  });
});
