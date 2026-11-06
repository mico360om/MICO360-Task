import { describe, it, expect } from 'vitest';
import { onboardingStatus, type OnboardingFacts } from './onboarding-status';

const base: OnboardingFacts = { status: 'ACTIVE', locked: false, activatedAt: null, lastLoginAt: null, invitedAt: null, welcomeSentAt: null, inviteExpiresAt: null };
const d = (iso: string) => new Date(iso);

describe('One status rule for staff and clients', () => {
  it('Invited: an invitation went and its link is still live, never signed in', () => {
    expect(onboardingStatus({ ...base, invitedAt: d('2026-11-05T08:00:00Z'), welcomeSentAt: d('2026-11-05T08:00:00Z'), inviteExpiresAt: d('2026-11-12T08:00:00Z') })).toBe('INVITED');
  });

  it('Invite expired: invited, but no live link (7 days passed, an email change or a deactivation ended it)', () => {
    expect(onboardingStatus({ ...base, invitedAt: d('2026-10-01T08:00:00Z'), welcomeSentAt: d('2026-10-01T08:00:00Z') })).toBe('INVITE_EXPIRED');
  });

  it('Active: has signed in, or set a password with a link — whatever invitations went', () => {
    expect(onboardingStatus({ ...base, lastLoginAt: d('2026-11-01T08:00:00Z') })).toBe('ACTIVE');
    expect(onboardingStatus({ ...base, activatedAt: d('2026-11-01T08:00:00Z'), invitedAt: d('2026-10-30T08:00:00Z') })).toBe('ACTIVE');
    expect(onboardingStatus({ ...base, lastLoginAt: d('2026-11-01T08:00:00Z'), invitedAt: d('2026-11-06T08:00:00Z'), inviteExpiresAt: d('2026-11-13T08:00:00Z') })).toBe('ACTIVE');
  });

  it('Active too: a temporary-password account never invited (it can sign in)', () => {
    expect(onboardingStatus(base)).toBe('ACTIVE');
  });

  it('Locked beats the rest (but not deactivated)', () => {
    expect(onboardingStatus({ ...base, locked: true, lastLoginAt: d('2026-11-01T08:00:00Z') })).toBe('LOCKED');
    expect(onboardingStatus({ ...base, locked: true, invitedAt: d('2026-11-05T08:00:00Z'), inviteExpiresAt: d('2026-11-12T08:00:00Z') })).toBe('LOCKED');
  });

  it('Deactivated: inactive or suspended, whatever else is true', () => {
    expect(onboardingStatus({ ...base, status: 'INACTIVE', lastLoginAt: d('2026-11-01T08:00:00Z') })).toBe('DEACTIVATED');
    expect(onboardingStatus({ ...base, status: 'SUSPENDED', locked: true })).toBe('DEACTIVATED');
  });

  it('older data: a welcome email time with no first-invitation time still counts as invited', () => {
    expect(onboardingStatus({ ...base, welcomeSentAt: d('2026-10-01T08:00:00Z') })).toBe('INVITE_EXPIRED');
  });
});
