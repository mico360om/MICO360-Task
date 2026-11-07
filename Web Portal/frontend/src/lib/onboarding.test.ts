import { describe, it, expect } from 'vitest';
import { INVITATION_DAY_CHOICES, invitedText, lifetimeText, matchesStatusFilter, NO_ONE_WITH_STATUS, onboardingBadge, ONBOARDING_FILTERS, statusOf, temporaryPasswordText, verifiedText } from './onboarding';

const NOW = new Date('2026-11-07T08:00:00.000Z');
const TZ = 'Asia/Muscat';

describe('Onboarding words (User Management and Clients alike)', () => {
  it('the badge: “Invited · 3 days ago” while the link works; Invite expired; Active; Locked; Deactivated', () => {
    expect(onboardingBadge({ onboarding: 'INVITED', invitedAt: '2026-11-04T07:00:00.000Z', welcomeSentAt: '2026-11-04T07:00:00.000Z' }, NOW)).toEqual({ label: 'Invited · 3 days ago', tone: 'info' });
    expect(onboardingBadge({ onboarding: 'INVITED', invitedAt: '2026-11-07T07:30:00.000Z', welcomeSentAt: '2026-11-07T07:30:00.000Z' }, NOW).label).toBe('Invited · today');
    expect(onboardingBadge({ onboarding: 'INVITED', invitedAt: '2026-11-06T07:30:00.000Z', welcomeSentAt: '2026-11-06T07:30:00.000Z' }, NOW).label).toBe('Invited · yesterday');
    // Resent: counted from the latest send.
    expect(onboardingBadge({ onboarding: 'INVITED', invitedAt: '2026-10-30T07:00:00.000Z', welcomeSentAt: '2026-11-05T07:00:00.000Z' }, NOW).label).toBe('Invited · 2 days ago');
    expect(onboardingBadge({ onboarding: 'INVITE_EXPIRED' }, NOW)).toEqual({ label: 'Invite expired', tone: 'warning' });
    expect(onboardingBadge({ onboarding: 'ACTIVE' }, NOW)).toEqual({ label: 'Active', tone: 'success' });
    expect(onboardingBadge({ onboarding: 'LOCKED' }, NOW)).toEqual({ label: 'Locked', tone: 'warning' });
    expect(onboardingBadge({ onboarding: 'DEACTIVATED' }, NOW)).toEqual({ label: 'Deactivated', tone: 'neutral' });
  });

  it('an older server (no onboarding field) falls back on the account status and lock', () => {
    expect(statusOf({ status: 'ACTIVE' })).toBe('ACTIVE');
    expect(statusOf({ status: 'INACTIVE' })).toBe('DEACTIVATED');
    expect(statusOf({ status: 'SUSPENDED', locked: true })).toBe('DEACTIVATED');
    expect(statusOf({ status: 'ACTIVE', locked: true })).toBe('LOCKED');
    expect(statusOf({ status: 'ACTIVE', onboarding: 'INVITED' })).toBe('INVITED');
  });

  it('“Invited 5 Nov · resent 7 Nov” (the first invitation and the latest send), with the year when it isn’t this year', () => {
    expect(invitedText({ invitedAt: '2026-11-05T06:00:00.000Z', welcomeSentAt: '2026-11-07T06:00:00.000Z' }, TZ, NOW)).toBe('Invited 5 Nov · resent 7 Nov');
    expect(invitedText({ invitedAt: '2026-11-05T06:00:00.000Z', welcomeSentAt: '2026-11-05T06:00:00.000Z' }, TZ, NOW)).toBe('Invited 5 Nov');
    expect(invitedText({ invitedAt: null, welcomeSentAt: '2026-11-05T06:00:00.000Z' }, TZ, NOW)).toBe('Invited 5 Nov');
    expect(invitedText({ invitedAt: '2025-12-30T06:00:00.000Z', welcomeSentAt: '2026-01-02T06:00:00.000Z' }, TZ, NOW)).toBe('Invited 30 Dec 2025 · resent 2 Jan');
    expect(invitedText({ invitedAt: null, welcomeSentAt: null }, TZ, NOW)).toBeNull();
  });

  it('email verified ✓ / not verified', () => {
    expect(verifiedText({ emailVerifiedAt: '2026-11-01T06:00:00.000Z' })).toEqual({ text: 'Email verified ✓', verified: true });
    expect(verifiedText({ emailVerifiedAt: null })).toEqual({ text: 'Not verified', verified: false });
    expect(verifiedText({})).toEqual({ text: 'Not verified', verified: false });
  });

  it('the status filter: every status, and each person matches only their own', () => {
    expect(ONBOARDING_FILTERS.map((f) => f.label)).toEqual(['All statuses', 'Invited', 'Invite expired', 'Invitation cancelled', 'Temporary password expired', 'Active', 'Locked', 'Deactivated']);
    expect(matchesStatusFilter({ status: 'ACTIVE', onboarding: 'INVITED' }, 'INVITED')).toBe(true);
    expect(matchesStatusFilter({ status: 'ACTIVE', onboarding: 'INVITED' }, 'ACTIVE')).toBe(false);
    expect(matchesStatusFilter({ status: 'INACTIVE' }, 'DEACTIVATED')).toBe(true);
    expect(matchesStatusFilter({ status: 'INACTIVE' }, '')).toBe(true);
  });

  // 1.23.6 addendum.
  it('Invitation cancelled and Temporary password expired: their badges and empty-filter words', () => {
    expect(onboardingBadge({ onboarding: 'INVITE_CANCELLED' }, NOW)).toEqual({ label: 'Invitation cancelled', tone: 'neutral' });
    expect(onboardingBadge({ onboarding: 'TEMP_EXPIRED' }, NOW)).toEqual({ label: 'Temporary password expired', tone: 'warning' });
    expect(NO_ONE_WITH_STATUS.INVITE_CANCELLED).toBe('No invitation is cancelled.');
    expect(NO_ONE_WITH_STATUS.TEMP_EXPIRED).toBe('No temporary password has expired.');
  });

  it('“A temporary password was set on 7 Nov by Khurram” — never the password; nothing once it is changed', () => {
    expect(temporaryPasswordText({ mustChangePassword: true, temporaryPasswordSetAt: '2026-11-07T06:00:00.000Z', temporaryPasswordSetBy: { id: 'a', name: 'Khurram' }, temporaryPasswordExpiresAt: '2026-11-14T06:00:00.000Z' }, TZ, NOW)).toBe(
      'A temporary password was set on 7 Nov by Khurram. It works until 14 Nov; they choose their own at their first sign-in.',
    );
    expect(temporaryPasswordText({ mustChangePassword: true, temporaryPasswordSetAt: '2026-11-01T06:00:00.000Z', temporaryPasswordSetBy: null, temporaryPasswordExpiresAt: '2026-11-04T06:00:00.000Z' }, TZ, NOW)).toBe(
      'A temporary password was set on 1 Nov. It expired on 4 Nov unused — set a new one or send an invitation.',
    );
    expect(temporaryPasswordText({ mustChangePassword: false, temporaryPasswordSetAt: null }, TZ, NOW)).toBeNull();
  });

  it('the lifetimes offered (1, 3, 7, 14 days) and how they read', () => {
    expect(INVITATION_DAY_CHOICES).toEqual([1, 3, 7, 14]);
    expect(lifetimeText(1)).toBe('1 day');
    expect(lifetimeText(7)).toBe('7 days');
  });
});
