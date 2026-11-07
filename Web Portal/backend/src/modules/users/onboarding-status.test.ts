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

  // 1.23.6 addendum: a cancelled invitation and an unused temporary password past its lifetime.
  it('Invitation cancelled: never signed in, an administrator cancelled it (beats Invited / Invite expired)', () => {
    expect(onboardingStatus({ ...base, invitedAt: d('2026-11-05T08:00:00Z'), welcomeSentAt: d('2026-11-05T08:00:00Z'), invitationCancelledAt: d('2026-11-06T08:00:00Z') })).toBe('INVITE_CANCELLED');
    expect(onboardingStatus({ ...base, invitationCancelledAt: d('2026-11-06T08:00:00Z') })).toBe('INVITE_CANCELLED');
    // Once the account is theirs a cancel never shows (it can't be cancelled then anyway).
    expect(onboardingStatus({ ...base, lastLoginAt: d('2026-11-07T08:00:00Z'), invitationCancelledAt: d('2026-11-06T08:00:00Z') })).toBe('ACTIVE');
    expect(onboardingStatus({ ...base, status: 'INACTIVE', invitationCancelledAt: d('2026-11-06T08:00:00Z') })).toBe('DEACTIVATED');
  });

  it('Temporary password expired: one must still be changed and its lifetime has passed (signed in before or not)', () => {
    const now = d('2026-11-15T08:00:00Z');
    const temp = { mustChangePassword: true, temporaryPasswordExpiresAt: d('2026-11-14T08:00:00Z') };
    expect(onboardingStatus({ ...base, ...temp }, now)).toBe('TEMP_EXPIRED');
    expect(onboardingStatus({ ...base, ...temp, lastLoginAt: d('2026-10-01T08:00:00Z') }, now)).toBe('TEMP_EXPIRED');
    // Still in time: as before (a temporary-password account can sign in).
    expect(onboardingStatus({ ...base, ...temp }, d('2026-11-13T08:00:00Z'))).toBe('ACTIVE');
    // Changed already (the flag is off): never expired.
    expect(onboardingStatus({ ...base, mustChangePassword: false, temporaryPasswordExpiresAt: d('2026-11-14T08:00:00Z') }, now)).toBe('ACTIVE');
    expect(onboardingStatus({ ...base, ...temp, locked: true }, now)).toBe('LOCKED');
  });
});
