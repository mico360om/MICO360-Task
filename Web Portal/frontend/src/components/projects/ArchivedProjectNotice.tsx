import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useArchivedNoticeStore } from '../../stores/archived-notice-store';

/**
 * "This project is archived — reopen it first." — above the page when the server refused a change
 * to an archived project (a card dragged on its board, a comment, a meeting edit, a change replayed
 * after being offline…), in the server's own words. Until dismissed, or the page changes.
 */
export function ArchivedProjectNotice({ frameClass = '' }: { frameClass?: string }) {
  const message = useArchivedNoticeStore((s) => s.message);
  const dismiss = useArchivedNoticeStore((s) => s.dismiss);
  const { pathname } = useLocation();
  const shownOn = useRef(pathname);
  // Only a change of page clears it (not a new message on the same page).
  useEffect(() => {
    if (shownOn.current !== pathname) dismiss();
    shownOn.current = pathname;
  }, [pathname, dismiss]);
  if (!message) return null;
  return (
    <div className={frameClass}>
      <div role="alert" data-archived-notice className="mt-3 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
        <svg className="flex-none" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="5" rx="1" />
          <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
        </svg>
        <p className="min-w-0 flex-1">{message}</p>
        <button
          type="button"
          onClick={dismiss}
          className="flex-none rounded-lg px-2.5 py-1 font-semibold transition-colors hover:bg-surface/60 [@media(pointer:coarse)]:!min-h-11"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
