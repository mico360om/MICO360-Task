import { externalContactsLine, type ExternalContactSummary } from '../lib/external-contacts';

/** The person-outside icon of the external-contacts line. */
export function ExternalIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 11h6M19 8l3 3-3 3" />
    </svg>
  );
}

/**
 * A task's external contacts in one short line on its card or row — "External: Ahmed Al Said (OXY)
 * and 2 more" — kept apart from its assignees; nothing for a task without any.
 */
export function ExternalContactsLine({ summary, className = '' }: { summary?: ExternalContactSummary | null; className?: string }) {
  const text = externalContactsLine(summary);
  if (!text) return null;
  return (
    <span data-external-line title={text} className={`flex min-w-0 items-center gap-1 text-[11px] text-ink-2 ${className}`}>
      <ExternalIcon />
      <span dir="auto" className="truncate">
        {text}
      </span>
    </span>
  );
}
