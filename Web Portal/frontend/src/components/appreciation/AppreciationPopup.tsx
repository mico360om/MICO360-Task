import { useId, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { themeStyle, dayWords } from '../../lib/appreciation';
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
          <PopupContent
            a={a}
            ids={{ title: 'appreciation-title', message: 'appreciation-message' }}
            note={note}
            onNote={setNote}
            busy={busy}
            problem={problem}
            onClose={onClose}
            onAccept={async () => {
              setBusy(true);
              await onAccept(note);
              setBusy(false);
            }}
          />
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * 1.24.2: the Send page's live preview — the popup's own content, exactly as the person will see it, on the page
 * (not a window). Its note box and buttons are only a picture: they can't be reached, pressed or read out. The
 * confetti replays each time it is chosen, and never for people who ask for less motion.
 */
export function AppreciationPopupPreview({ a }: { a: ApiAppreciation }) {
  const id = useId();
  return (
    <div role="group" aria-label="Preview of the popup" className="card flex flex-col overflow-hidden p-0" data-appreciation-preview>
      <PopupContent a={a} ids={{ title: `${id}-title`, message: `${id}-message` }} preview note="" onNote={() => {}} busy={false} problem={null} onClose={() => {}} onAccept={() => {}} />
    </div>
  );
}

/** The popup's colour band, title, message, sender, note and buttons — shared by the popup and its preview. */
function PopupContent({
  a,
  ids,
  note,
  onNote,
  busy,
  problem,
  onClose,
  onAccept,
  preview = false,
}: {
  a: ApiAppreciation;
  ids: { title: string; message: string };
  note: string;
  onNote: (v: string) => void;
  busy: boolean;
  problem: string | null;
  onClose: () => void;
  onAccept: () => void;
  preview?: boolean;
}) {
  const Title = preview ? 'p' : 'h2';
  // The preview's controls: shown, but out of the tab order and hidden from screen readers.
  const still = preview ? { tabIndex: -1 } : {};
  return (
    <>
      <div className="ap-band relative flex-none overflow-hidden px-5 pb-5 pt-5" style={themeStyle(a.theme)} data-popup-band>
        {a.animation === 'shimmer' ? <span className="appreciation-shimmer" aria-hidden="true" /> : null}
        {preview ? <ConfettiBurst key={`${a.animation}-${a.theme}`} id={a.id} animation={a.animation} replay /> : <ConfettiBurst id={a.id} animation={a.animation} />}
        <div className="relative flex items-center gap-3">
          <CompanyMark company={a.company} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider ap-ink-90">
              <bdi>{a.company.name}</bdi> · {dayWords(a.day)}
            </p>
            <p className="text-sm">You’ve been appreciated</p>
          </div>
          <span className="ms-auto grid h-12 w-12 flex-none place-items-center ap-chip rounded-full">
            <AppreciationIconSvg icon={a.icon} size={26} />
          </span>
        </div>
        <Title id={ids.title} dir="auto" className="relative mt-4 break-words font-display text-2xl font-extrabold tracking-tightish">
          {a.title}
        </Title>
      </div>
      <div className={preview ? 'p-5' : 'min-h-0 overflow-y-auto p-5'} data-popup-body>
        <p id={ids.message} dir="auto" className="whitespace-pre-line break-words text-base leading-relaxed text-ink">
          {a.message}
        </p>
        <p className="mt-3 text-sm text-ink-2">
          From <bdi className="font-semibold text-ink">{a.sender.name}</bdi>
        </p>
        <div aria-hidden={preview || undefined} className={preview ? 'pointer-events-none select-none' : undefined}>
          <div className="mt-4">
            <NoteField value={note} onChange={onNote} disabled={busy} tabIndex={preview ? -1 : undefined} />
          </div>
          {problem ? (
            <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {problem}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={busy} className="[@media(pointer:coarse)]:!min-h-11" {...still}>
              Close
            </Button>
            <Button loading={busy} className="[@media(pointer:coarse)]:!min-h-11" onClick={onAccept} {...still}>
              Accept appreciation
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
