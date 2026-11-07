import type { BadgeTone } from '../components/ui/Badge';

/**
 * Onboarding: one status for staff and clients (the server works it out — users/onboarding-status.ts —
 * and sends it as `onboarding`), and the words User Management, the Clients page and Manage account use.
 */
export type OnboardingStatus = 'INVITED' | 'INVITE_EXPIRED' | 'INVITE_CANCELLED' | 'TEMP_EXPIRED' | 'ACTIVE' | 'LOCKED' | 'DEACTIVATED';

export interface OnboardingPerson {
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  locked?: boolean;
  onboarding?: OnboardingStatus;
  invitedAt?: string | null;
  welcomeSentAt?: string | null;
  emailVerifiedAt?: string | null;
}

/** The person's status (an older server sends no `onboarding`: worked out from status and lock). */
export function statusOf(p: Pick<OnboardingPerson, 'status' | 'locked' | 'onboarding'>): OnboardingStatus {
  if (p.status !== 'ACTIVE') return 'DEACTIVATED';
  if (p.onboarding) return p.onboarding;
  return p.locked ? 'LOCKED' : 'ACTIVE';
}

const DAY = 24 * 3600 * 1000;
function daysAgo(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** The status badge: "Invited · 3 days ago" (from the latest send), "Invite expired", "Active", "Locked", "Deactivated". */
export function onboardingBadge(p: Pick<OnboardingPerson, 'onboarding' | 'invitedAt' | 'welcomeSentAt'> & Partial<OnboardingPerson>, now: Date = new Date()): { label: string; tone: BadgeTone } {
  const status = p.status ? statusOf(p as OnboardingPerson) : (p.onboarding ?? 'ACTIVE');
  switch (status) {
    case 'INVITED': {
      const sent = p.welcomeSentAt ?? p.invitedAt;
      return { label: sent ? `Invited · ${daysAgo(sent, now)}` : 'Invited', tone: 'info' };
    }
    case 'INVITE_EXPIRED':
      return { label: 'Invite expired', tone: 'warning' };
    case 'INVITE_CANCELLED':
      return { label: 'Invitation cancelled', tone: 'neutral' };
    case 'TEMP_EXPIRED':
      return { label: 'Temporary password expired', tone: 'warning' };
    case 'LOCKED':
      return { label: 'Locked', tone: 'warning' };
    case 'DEACTIVATED':
      return { label: 'Deactivated', tone: 'neutral' };
    default:
      return { label: 'Active', tone: 'success' };
  }
}

// Fixed English month names (some browsers' en-GB writes September as "Sept").
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayIn(iso: string, timeZone: string, now: Date): string {
  const parts = (at: Date) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return { year: get('year'), month: MONTHS[Number(get('month')) - 1] ?? '', day: String(Number(get('day'))) };
  };
  const d = parts(new Date(iso));
  return `${d.day} ${d.month}${d.year === parts(now).year ? '' : ` ${d.year}`}`;
}

/** "Invited 5 Nov · resent 7 Nov" — the first invitation, and the latest send when it was later. Null: never invited. */
export function invitedText(p: Pick<OnboardingPerson, 'invitedAt' | 'welcomeSentAt'>, timeZone: string, now: Date = new Date()): string | null {
  const first = p.invitedAt ?? p.welcomeSentAt;
  if (!first) return null;
  const firstDay = dayIn(first, timeZone, now);
  const last = p.welcomeSentAt;
  if (!last || Date.parse(last) - Date.parse(first) < 60_000) return `Invited ${firstDay}`;
  return `Invited ${firstDay} · resent ${dayIn(last, timeZone, now)}`;
}

/**
 * 1.23.6: "A temporary password was set on 7 Nov by Khurram. It works until 14 Nov; …" — never the
 * password itself. Null once they chose their own (or none was set).
 */
export function temporaryPasswordText(
  p: { mustChangePassword?: boolean; temporaryPasswordSetAt?: string | null; temporaryPasswordSetBy?: { id?: string; name: string } | null; temporaryPasswordExpiresAt?: string | null },
  timeZone: string,
  now: Date = new Date(),
): string | null {
  if (!p.mustChangePassword || !p.temporaryPasswordSetAt) return null;
  const by = p.temporaryPasswordSetBy?.name ? ` by ${p.temporaryPasswordSetBy.name}` : '';
  const set = `A temporary password was set on ${dayIn(p.temporaryPasswordSetAt, timeZone, now)}${by}.`;
  const ends = p.temporaryPasswordExpiresAt;
  if (!ends) return `${set} They choose their own at their first sign-in.`;
  if (Date.parse(ends) <= now.getTime()) return `${set} It expired on ${dayIn(ends, timeZone, now)} unused — set a new one or send an invitation.`;
  return `${set} It works until ${dayIn(ends, timeZone, now)}; they choose their own at their first sign-in.`;
}

/** 1.23.6: how long an invitation link (or an unused temporary password) may last. */
export const INVITATION_DAY_CHOICES = [1, 3, 7, 14] as const;
export const DEFAULT_INVITATION_DAYS = 7;
export const lifetimeText = (days: number) => (days === 1 ? '1 day' : `${days} days`);

/** "Email verified ✓" / "Not verified". */
export function verifiedText(p: Pick<OnboardingPerson, 'emailVerifiedAt'>): { text: string; verified: boolean } {
  return p.emailVerifiedAt ? { text: 'Email verified ✓', verified: true } : { text: 'Not verified', verified: false };
}

export type StatusFilter = '' | OnboardingStatus;
export const ONBOARDING_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'INVITED', label: 'Invited' },
  { value: 'INVITE_EXPIRED', label: 'Invite expired' },
  { value: 'INVITE_CANCELLED', label: 'Invitation cancelled' },
  { value: 'TEMP_EXPIRED', label: 'Temporary password expired' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'LOCKED', label: 'Locked' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

export function matchesStatusFilter(p: Pick<OnboardingPerson, 'status' | 'locked' | 'onboarding'>, filter: StatusFilter): boolean {
  return !filter || statusOf(p) === filter;
}

/** "No one is invited." for a filter that leaves the list empty. */
export const NO_ONE_WITH_STATUS: Record<OnboardingStatus, string> = {
  INVITED: 'No one has an invitation waiting.',
  INVITE_EXPIRED: 'No invitation has expired.',
  INVITE_CANCELLED: 'No invitation is cancelled.',
  TEMP_EXPIRED: 'No temporary password has expired.',
  ACTIVE: 'No one is active.',
  LOCKED: 'No account is locked.',
  DEACTIVATED: 'No account is deactivated.',
};

/** Said when email can't be sent on this server (no mail settings). */
export const EMAIL_OFF_BANNER = 'Email isn’t set up — verification and invitations by email are off. People sign in with the password you give them until an administrator adds the email (Mailjet) keys.';

/** The sign-in note on an email change in Manage account. */
export const EMAIL_CHANGE_NOTE = 'They keep working; at their next sign-in they confirm the new address with a code we email there. We tell the old address about the change.';
