import { useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { themeGradient, dayWords } from '../../lib/appreciation';
import { AppreciationIconSvg, CompanyMark, ConfettiBurst } from './AppreciationArt';
import { useMyAppreciations } from './useMyAppreciations';
import { NoteField } from './AcceptNote';
import type { ApiAppreciation } from '../../api/appreciations';

/**
 * Employee Appreciation (1.24.0): the one-time popup, on any page, for each of today's appreciations that is
 * neither accepted nor closed — one after another. Its state is the server's: once accepted or closed it never
 * shows again, on this or any other device. Closing leaves "Accept" in the Dashboard's banner.
 * 1.24.1: an optional note for the manager goes with Accept.
 */
export function AppreciationPopup() {
  const { live, accept, closePopup, problem } = useMyAppreciations();
  const next = live.find((a) => !a.acceptedAt && !a.popupClosedAt);
  if (!next) return null;
  return <PopupFor key={next.id} a={next} onAccept={(note) => accept(next.id, note)} onClose={() => void closePopup(next.id)} problem={problem} />;
}

function PopupFor({ a, onAccept, onClose, problem }: { a: ApiAppreciation; onAccept: (note: string) => Promise<boolean>; onClose: () => void; problem: string | null }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const ref = useDialog<HTMLDivElement>(busy ? () => {} : onClose, { initialFocus: 'container' });
  return (
    <ModalPortal>
      <div className={dialogLayer('small', { onTop: true })} data-appreciation-popup={a.id}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="appreciation-title"
          aria-describedby="appreciation-message"
          className={`card relative ${dialogPanel('small')} animate-scale-in flex flex-col overflow-hidden p-0 outline-none`}
        >
          <div className="relative flex-none overflow-hidden px-5 pb-5 pt-5 text-white" style={{ backgroundImage: themeGradient(a.theme) }}>
            {a.animation === 'shimmer' ? <span className="appreciation-shimmer" aria-hidden="true" /> : null}
            <ConfettiBurst id={a.id} animation={a.animation} />
            <div className="relative flex items-center gap-3">
              <CompanyMark company={a.company} />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/90">
                  <bdi>{a.company.name}</bdi> · {dayWords(a.day)}
                </p>
                <p className="text-sm text-white">You’ve been appreciated</p>
              </div>
              <span className="ms-auto grid h-12 w-12 flex-none place-items-center rounded-full bg-white/15">
                <AppreciationIconSvg icon={a.icon} size={26} />
              </span>
            </div>
            <h2 id="appreciation-title" dir="auto" className="relative mt-4 font-display text-2xl font-extrabold tracking-tightish">
              {a.title}
            </h2>
          </div>
          <div className="min-h-0 overflow-y-auto p-5" data-popup-body>
            <p id="appreciation-message" dir="auto" className="whitespace-pre-line text-base leading-relaxed text-ink">
              {a.message}
            </p>
            <p className="mt-3 text-sm text-ink-2">
              From <bdi className="font-semibold text-ink">{a.sender.name}</bdi>
            </p>
            <div className="mt-4">
              <NoteField value={note} onChange={setNote} disabled={busy} />
            </div>
            {problem ? (
              <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {problem}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onClose} disabled={busy} className="[@media(pointer:coarse)]:!min-h-11">
                Close
              </Button>
              <Button
                loading={busy}
                className="[@media(pointer:coarse)]:!min-h-11"
                onClick={async () => {
                  setBusy(true);
                  await onAccept(note);
                  setBusy(false);
                }}
              >
                Accept appreciation
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
