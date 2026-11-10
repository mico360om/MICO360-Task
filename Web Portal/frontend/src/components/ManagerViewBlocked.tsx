import { useState } from 'react';
import { Button } from './ui/Button';
import { MANAGER_VIEW_WORDS, useSetManagerView } from '../lib/manager-view';

/**
 * An admin page's address while Manager View is on (owner, 10 Nov): it says so, with Turn off — which opens
 * the page at once (no sign-out).
 */
export function ManagerViewBlocked() {
  const turn = useSetManagerView();
  const [failed, setFailed] = useState(false);
  return (
    <section aria-labelledby="manager-view-blocked" className="mx-auto mt-10 max-w-lg rounded-2xl border border-line bg-surface p-6 text-center shadow-sm">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </div>
      <h1 id="manager-view-blocked" className="text-lg font-semibold text-ink">
        {MANAGER_VIEW_WORDS.blockedTitle}
      </h1>
      <p className="mt-2 text-sm text-ink-2">{MANAGER_VIEW_WORDS.blockedText}</p>
      {failed ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {MANAGER_VIEW_WORDS.failed}
        </p>
      ) : null}
      <div className="mt-5 flex justify-center">
        <Button
          type="button"
          disabled={turn.isPending}
          onClick={() => {
            setFailed(false);
            turn.mutate(false, { onError: () => setFailed(true) });
          }}
          className="[@media(pointer:coarse)]:!min-h-11"
        >
          {turn.isPending ? MANAGER_VIEW_WORDS.turningOff : MANAGER_VIEW_WORDS.turnOff}
        </Button>
      </div>
    </section>
  );
}
