import { describe, it, expect } from 'vitest';
import { invitedText, matchesStatusFilter, onboardingBadge, ONBOARDING_FILTERS, statusOf, verifiedText } from './onboarding';

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
    expect(ONBOARDING_FILTERS.map((f) => f.label)).toEqual(['All statuses', 'Invited', 'Invite expired', 'Active', 'Locked', 'Deactivated']);
    expect(matchesStatusFilter({ status: 'ACTIVE', onboarding: 'INVITED' }, 'INVITED')).toBe(true);
    expect(matchesStatusFilter({ status: 'ACTIVE', onboarding: 'INVITED' }, 'ACTIVE')).toBe(false);
    expect(matchesStatusFilter({ status: 'INACTIVE' }, 'DEACTIVATED')).toBe(true);
    expect(matchesStatusFilter({ status: 'INACTIVE' }, '')).toBe(true);
  });
});
