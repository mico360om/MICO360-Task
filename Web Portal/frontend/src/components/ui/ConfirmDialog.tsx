import type { ReactNode } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { ModalPortal } from './ModalPortal';
import { Button } from './Button';

export interface ConfirmDialogProps {
  /** The question, e.g. "Cancel this meeting?" — also the dialog's accessible name. */
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** The safe way out; focused when the dialog opens. */
  keepLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  /** Why the action failed (shown in the dialog, which stays open). */
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Asks before something hard to undo. Focus starts on the safe button, Escape and the backdrop
 * keep things as they are, and a failure is shown here instead of closing silently.
 */
export function ConfirmDialog({ title, children, confirmLabel, keepLabel = 'Keep it', tone = 'danger', busy = false, error, onConfirm, onClose }: ConfirmDialogProps) {
  const dialogRef = useDialog(busy ? () => {} : onClose);
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4">
        <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby={children ? 'confirm-body' : undefined}
          className="card relative w-full max-w-sm animate-scale-in p-5"
        >
          <h2 id="confirm-title" className="font-display text-lg font-semibold text-ink">{title}</h2>
          {children ? <div id="confirm-body" className="mt-2 text-sm text-ink-2">{children}</div> : null}
          {error ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={busy}>{keepLabel}</Button>
            <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
