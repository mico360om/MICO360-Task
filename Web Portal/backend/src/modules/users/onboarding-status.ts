/**
 * Onboarding: one status rule for staff and clients (User Management and the Clients page show it).
 *
 *   DEACTIVATED     inactive or suspended (sessions ended; can't sign in)
 *   LOCKED          too many failed sign-ins (an administrator can unlock it)
 *   ACTIVE          has signed in or set a password with an emailed link — or was never invited (a
 *                   temporary-password account can sign in)
 *   INVITED         an invitation (welcome email) went and its link still works (7 days)
 *   INVITE_EXPIRED  invited, but no link works any more (7 days passed, it was replaced, the email changed)
 */
export type OnboardingStatus = 'INVITED' | 'INVITE_EXPIRED' | 'ACTIVE' | 'LOCKED' | 'DEACTIVATED';

export interface OnboardingFacts {
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  locked: boolean;
  activatedAt: Date | null;
  lastLoginAt: Date | null;
  invitedAt: Date | null;
  welcomeSentAt: Date | null;
  /** The newest invitation link that still works: when it stops. Null: none works. */
  inviteExpiresAt: Date | null;
}

export function onboardingStatus(f: OnboardingFacts): OnboardingStatus {
  if (f.status !== 'ACTIVE') return 'DEACTIVATED';
  if (f.locked) return 'LOCKED';
  if (f.activatedAt || f.lastLoginAt) return 'ACTIVE';
  if (f.inviteExpiresAt) return 'INVITED';
  if (f.invitedAt || f.welcomeSentAt) return 'INVITE_EXPIRED';
  return 'ACTIVE';
}

/** The Prisma include that brings a person's newest working invitation link (its expiry only). */
export const liveInvitation = (now: Date) =>
  ({
    where: { purpose: 'WELCOME' as const, consumedAt: null, expiresAt: { gt: now } },
    select: { expiresAt: true },
    orderBy: { expiresAt: 'desc' as const },
    take: 1,
  }) as const;
