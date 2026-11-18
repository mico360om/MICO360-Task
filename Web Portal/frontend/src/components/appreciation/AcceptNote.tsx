import { useId, useState } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from '../ui/ModalPortal';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import type { ApiAppreciation } from '../../api/appreciations';

/** 1.24.1: the most a note for the manager may hold (the server's LIMITS.note). */
export const NOTE_LIMIT = 500;
export const NOTE_LABEL = 'Add a note for your manager (optional)';

/**
 * 1.24.1 Appreciation note: the optional note for the manager, in the popup and in the banner's Accept dialog. Plain
 * text; trimmed when sent; it can't be changed after accepting.
 */
export function NoteField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-note`} className="text-sm font-medium text-ink">
        {NOTE_LABEL}
      </label>
      <textarea
        id={`${id}-note`}
        rows={3}
        dir="auto"
        maxLength={NOTE_LIMIT}
        aria-describedby={`${id}-count`}
        className={fieldClass(false, 'resize-y')}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-count`} className="text-end text-xs text-ink-2">
        {value.length} of {NOTE_LIMIT}
      </p>
    </div>
  );
}

/** The banner's Accept (the popup was closed): a small window with the same optional note. */
export function AcceptNoteDialog({ a, onAccept, onClose, problem = null }: { a: ApiAppreciation; onAccept: (note: string) => Promise<void>; onClose: () => void; problem?: string | null }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useDialog<HTMLDivElement>(busy ? () => {} : onClose);
  const id = useId();
  return (
    <ModalPortal>
      <div className={dialogLayer('small', { onTop: true })} data-accept-note-dialog={a.id}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className={`card relative ${dialogPanel('small')} animate-scale-in p-5`}>
          <h2 id={`${id}-title`} dir="auto" className="font-display text-lg font-semibold text-ink">
            Accept “{a.title}”
          </h2>
          <p className="mt-1 text-sm text-ink-2">
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
              Cancel
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
    </ModalPortal>
  );
}
