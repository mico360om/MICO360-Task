import { guestsCardLine } from '../lib/guest-contacts';
import type { ExternalContactSummary } from '../lib/external-contacts';

/** The person-outside icon of the guests line (1.20's external-contacts icon). */
export function GuestIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 11h6M19 8l3 3-3 3" />
    </svg>
  );
}

/**
 * The line's words: "Guest: Ahmed (Acme) and 2 more" from the task's guests — or, when an older server
 * sends none (or a contact isn't a guest yet), from its external contacts in short; null for neither.
 */
export function guestsLineText(
  guests: { name: string; company?: string | null }[] | null | undefined,
  summary: Pick<ExternalContactSummary, 'count' | 'name' | 'company'> | null | undefined,
): string | null {
  if (guests?.length) return guestsCardLine(guests);
  if (!summary || summary.count < 1) return null;
  return guestsCardLine(Array.from({ length: summary.count }, (_, i) => (i === 0 ? { name: summary.name, company: summary.company } : { name: '' })));
}

/**
 * 1.24 A task's guests in one short line on its card or row — "Guest: Ahmed Al Said (Acme) and 2 more"
 * (1.20's "External: …" line; external contacts are guests now) — kept apart from its assignees;
 * nothing for a task without any.
 */
export function GuestsLine({
  guests,
  summary,
  className = '',
}: {
  guests?: { name: string; company?: string | null }[] | null;
  summary?: ExternalContactSummary | null;
  className?: string;
}) {
  const text = guestsLineText(guests, summary);
  if (!text) return null;
  return (
    <span data-guests-line title={text} className={`flex min-w-0 items-center gap-1 text-[11px] text-ink-2 ${className}`}>
      <GuestIcon />
      <span dir="auto" className="truncate">
        {text}
      </span>
    </span>
  );
}
