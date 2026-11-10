import { MANAGER_VIEW_WORDS, useManagerView } from '../lib/manager-view';

/** Manager View (owner, 10 Nov): a small badge in the top bar while an administrator has it on. */
export function ManagerViewBadge() {
  const { on } = useManagerView();
  if (!on) return null;
  return (
    <span
      data-manager-view-badge
      title={MANAGER_VIEW_WORDS.badgeTitle}
      className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-brand/40 bg-brand/10 px-2 py-1 text-xs font-semibold text-brand sm:px-2.5"
    >
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
      {/* On a phone the eye alone (the top bar is full); the words are read out everywhere. */}
      <span className="sr-only sm:not-sr-only">{MANAGER_VIEW_WORDS.badge}</span>
      <span className="sr-only">: settings and admin pages are hidden</span>
    </span>
  );
}
