import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DailyEmailMyPreview } from '../../api/daily-emails';
import { useDialog } from '../../hooks/useDialog';
import { Button } from '../ui/Button';
import { LoadError } from '../ui/LoadError';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';

/** 44 px on a touch screen (`!`: the site's global touch rule gives buttons 32 px and would win otherwise). */
export const touchTarget = '[@media(pointer:coarse)]:!min-h-11';

/**
 * "Preview my email": the signed-in person's own daily email as it would be built now (every part when
 * they turned them all off), shown as the email itself in a sandboxed frame — no scripts, no links
 * followed — at a computer's width or a phone's (375 px). Nothing is sent. Opened from Settings → Daily
 * email (everyone) and System settings → Daily email (administrators); `load` asks the server for it — the
 * server only ever answers with the caller's own email.
 */
export function DailyEmailPreviewDialog({ onClose, load, queryKey }: { onClose: () => void; load: () => Promise<DailyEmailMyPreview>; queryKey: string }) {
  const dialogRef = useDialog(onClose);
  const titleId = useId();
  const noteId = useId();
  const [width, setWidth] = useState<'computer' | 'phone'>('computer');
  const q = useQuery({ queryKey: [queryKey], queryFn: load, staleTime: 0, gcTime: 0, retry: false });
  const choice = (value: 'computer' | 'phone', label: string) => (
    <button
      type="button"
      aria-pressed={width === value}
      onClick={() => setWidth(value)}
      className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${touchTarget} ${width === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}
    >
      {label}
    </button>
  );
  return (
    <ModalPortal>
      <div className={dialogLayer('wide')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={noteId}
          className={`card relative flex ${dialogPanel('wide')} animate-scale-in flex-col overflow-hidden`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg font-semibold text-ink">Your daily email</h2>
              <p id={noteId} className="mt-1 text-sm text-ink-2">As it would be sent to you now, from your tasks and day as they are. Nothing is sent; links don’t open here.</p>
            </div>
            <div role="group" aria-label="Width" className="flex flex-none gap-1 rounded-lg bg-ground p-1">
              {choice('computer', 'Computer')}
              {choice('phone', 'Phone')}
            </div>
          </div>
          {/* The email can be taller than a phone's window: this area scrolls, so keyboard users can reach it. */}
          <div role="region" aria-label="Email preview" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto bg-ground px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:px-5">
            {q.isLoading ? (
              <p className="text-sm text-ink-2">Building your email…</p>
            ) : q.isError || !q.data ? (
              <LoadError what="your email" onRetry={() => void q.refetch()} />
            ) : q.data.empty || !q.data.html ? (
              <p className="text-sm text-ink-2">There’s nothing in your daily email right now, so none would be sent.</p>
            ) : (
              <>
                <p className="mb-2 text-sm text-ink">
                  <span className="text-ink-2">Subject: </span>
                  <span dir="auto" className="font-medium">{q.data.subject}</span>
                </p>
                <iframe
                  title="Your daily email as it is now"
                  sandbox=""
                  srcDoc={q.data.html}
                  style={width === 'phone' ? { width: '375px' } : undefined}
                  className="mx-auto block h-[65vh] w-full max-w-full rounded-lg border border-line bg-white"
                />
              </>
            )}
          </div>
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
