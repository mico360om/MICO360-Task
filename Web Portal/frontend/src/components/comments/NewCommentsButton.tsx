import { newCommentsText } from '../../lib/comment-feed';

/**
 * Comments, newest first: "3 new comments ↑" — new comments wait above while the reader is further down the list;
 * pressing brings them in. Shared by the task panel and the Client portal (kept small: the portal loads it too).
 */
export function NewCommentsButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Show them at the top"
      className="pointer-events-auto inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-white shadow-lift transition-colors hover:bg-brand-2 [@media(pointer:coarse)]:min-h-11"
    >
      {newCommentsText(count)}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
