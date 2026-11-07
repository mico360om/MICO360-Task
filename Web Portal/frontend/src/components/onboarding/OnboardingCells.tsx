import { Badge } from '../ui/Badge';
import { onboardingBadge, statusOf, verifiedText, type OnboardingPerson } from '../../lib/onboarding';

/** A padlock, drawn (an emoji looks different on every system). */
const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="-mt-px">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
);

/**
 * Onboarding: a person's status badge (Invited · 3 days ago / Invite expired / Active / Locked /
 * Deactivated) and, under it, whether their email address is verified — the same in User Management,
 * on the Clients page and in Manage account.
 */
export function OnboardingStatusCell({ person, now }: { person: OnboardingPerson; now?: Date }) {
  const badge = onboardingBadge(person, now);
  const verified = verifiedText(person);
  const locked = statusOf(person) === 'LOCKED';
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={badge.tone} className="whitespace-nowrap normal-case tracking-normal">
        {locked ? <LockIcon /> : null}
        <span title={locked ? 'Locked after too many failed sign-in attempts' : undefined}>{badge.label}</span>
      </Badge>
      <span data-email-verified={verified.verified ? 'yes' : 'no'} className={`whitespace-nowrap text-xs ${verified.verified ? 'text-success' : 'text-ink-2'}`}>
        {verified.text}
      </span>
    </div>
  );
}
