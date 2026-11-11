import { useState } from 'react';
import { ArchiveIcon } from './ArchivedBadge';
import { TOUCH_TALL } from '../../lib/touch';

/**
 * Task archive: the task panel's line for an archived task — "Archived on 3 Nov by Ali — read-only" — with
 * Unarchive for whoever may (administrators and the people who run its project). A refusal says why and
 * the line stays; the panel shows the task as it is again once the server says so.
 */
export function ArchivedBanner({ text, onUnarchive }: { text: string; onUnarchive?: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function unarchive() {
    if (!onUnarchive || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await onUnarchive();
    } catch (e) {
      setProblem(e instanceof Error && e.message && !/^Request failed/.test(e.message) ? e.message : 'Couldn’t unarchive it. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="archived-banner" className="mb-4 rounded-lg border border-line bg-ground px-3 py-2 text-sm text-ink">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex-none text-ink-2">
            <ArchiveIcon size={16} />
          </span>
          <span className="min-w-0 font-medium">{text}</span>
        </span>
        {onUnarchive ? (
          <button
            type="button"
            onClick={() => void unarchive()}
            disabled={busy}
            className={`inline-flex h-8 flex-none items-center rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-60 ${TOUCH_TALL}`}
          >
            {busy ? 'Unarchiving…' : 'Unarchive'}
          </button>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="mt-1 text-xs font-medium text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
