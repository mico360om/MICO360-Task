import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { guestsApi, type ApiAdminGuest, type ApiGuest } from '../../api/guests';
import { useDialog } from '../../hooks/useDialog';
import { guestLabel, guestLine } from '../../lib/guest-contacts';
import { TOUCH_TALL } from '../../lib/touch';
import { problemText } from '../company/company-admin';
import { Button } from '../ui/Button';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { onTasksText } from './guest-admin-words';

/** The one kept unless another is chosen: the guest on the most tasks (the first of a tie). */
export function defaultKeep(guests: ApiAdminGuest[]): string {
  return guests.reduce((best, g) => (g.taskCount > best.taskCount ? g : best), guests[0]!).id;
}

/**
 * 1.24 Guest contacts → Merge: duplicates of one company's list become one guest. Choose the one to keep;
 * every task with the others moves to it (the server joins their notes and hides the others).
 */
export function GuestMergeDialog({ guests, onClose, onMerged }: { guests: ApiAdminGuest[]; onClose: () => void; onMerged: (result: { guest: ApiGuest; tasks: number }) => void }) {
  const [keepId, setKeepId] = useState(() => defaultKeep(guests));
  const kept = guests.find((g) => g.id === keepId) ?? guests[0]!;
  const others = guests.filter((g) => g.id !== kept.id);
  const name = useId();
  const merge = useMutation({
    mutationFn: () => guestsApi(apiClient).merge(kept.id, others.map((g) => g.id)),
    onSuccess: (result) => {
      onMerged(result);
      onClose();
    },
  });
  const close = () => {
    if (!merge.isPending) onClose();
  };
  const dialogRef = useDialog(close);

  return (
    <ModalPortal>
      <div className={dialogLayer('form')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={close} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Merge guests"
          className={`keyboard-flow-cramped card relative flex flex-col overflow-hidden shadow-lift animate-scale-in ${dialogPanel('form')}`}
        >
          <div className="flex flex-none items-center gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <h2 className="flex-1 font-display text-xl font-bold text-ink">Merge guests</h2>
            <button type="button" onClick={close} aria-label="Close" title="Close (Esc)" className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div>
              <p id={`${name}-keep`} className="mb-2 text-sm font-semibold text-ink">Keep this one</p>
              <div role="radiogroup" aria-labelledby={`${name}-keep`} className="flex flex-col gap-2">
                {guests.map((g) => (
                  <label
                    key={g.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-brand/30 ${TOUCH_TALL} ${g.id === kept.id ? 'border-brand bg-brand/5' : 'border-line hover:bg-ground'}`}
                  >
                    <input type="radio" name={name} value={g.id} checked={g.id === kept.id} onChange={() => setKeepId(g.id)} className="mt-1 h-4 w-4 flex-none accent-brand" />
                    <span className="min-w-0">
                      <bdi className="block font-medium text-ink [overflow-wrap:anywhere]">{guestLine(g)}</bdi>
                      <span className="block text-xs text-ink-2 [overflow-wrap:anywhere]">
                        {[g.email, g.phone].filter(Boolean).join(' · ')}
                        {g.email || g.phone ? ' · ' : ''}
                        {onTasksText(g.taskCount)}
                        {g.retiredAt ? ' · Retired' : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">
              Every task with the others moves to <bdi>{guestLabel(kept)}</bdi>.
            </p>
            <p className="text-sm text-ink-2">The others come off the list, and their notes are added to the kept guest’s. This can’t be undone.</p>
            {merge.isError ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {problemText(merge.error, 'Couldn’t merge the guests. Please try again.')}
              </p>
            ) : null}
          </div>
          <div className="flex flex-none gap-2 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
            <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={close} disabled={merge.isPending} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">
              Cancel
            </button>
            <Button onClick={() => merge.mutate()} loading={merge.isPending} className="!min-h-[44px] flex-[2] sm:min-w-[10rem] sm:flex-none">
              {merge.isPending ? 'Merging…' : `Merge ${guests.length} guests`}
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
