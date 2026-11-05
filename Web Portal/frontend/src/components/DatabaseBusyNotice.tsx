import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useDatabaseBusyStore } from '../stores/database-busy-store';

/**
 * 1.23.1: "The database is busy — please try again in a moment." — above the page when the server
 * answered DATABASE_BUSY (its database was away for a moment: a deploy restart), in the server's own
 * words, whatever part of the page asked. Until dismissed, or the page changes.
 */
export function DatabaseBusyNotice({ frameClass = '' }: { frameClass?: string }) {
  const message = useDatabaseBusyStore((s) => s.message);
  const dismiss = useDatabaseBusyStore((s) => s.dismiss);
  const { pathname } = useLocation();
  const shownOn = useRef(pathname);
  useEffect(() => {
    if (shownOn.current !== pathname) dismiss();
    shownOn.current = pathname;
  }, [pathname, dismiss]);
  if (!message) return null;
  return (
    <div className={frameClass}>
      <div role="status" data-database-busy className="mt-3 flex items-center gap-3 rounded-xl border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-ink">
        <svg className="flex-none text-warning" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
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
