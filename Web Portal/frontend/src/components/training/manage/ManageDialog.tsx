import { useId, type FormEvent, type ReactNode } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { ModalPortal } from '../../ui/ModalPortal';
import { Button } from '../../ui/Button';
import { dialogLayer, dialogPanel, type DialogSize } from '../../ui/dialog-size';
import { Glyph } from './manage-ui';

export interface ManageDialogProps {
  title: string;
  /** A line under the title (what it is about). */
  eyebrow?: string;
  size?: DialogSize;
  onClose: () => void;
  /** With a submit: the form's main button. Without: a window with Close only. */
  onSubmit?: () => void;
  submitLabel?: string;
  busy?: boolean;
  /** Unavailable for now (the reason is on screen). */
  submitDisabled?: boolean;
  tone?: 'primary' | 'danger';
  closeLabel?: string;
  children: ReactNode;
}

/**
 * The Training Center's windows: a title and ✕, the fields (they scroll), and Cancel + the main button in a
 * footer that stays in view (above a phone's keyboard too). On a phone a 'form' window fills the screen.
 */
export function ManageDialog({ title, eyebrow, size = 'form', onClose, onSubmit, submitLabel = 'Save', busy = false, submitDisabled = false, tone = 'primary', closeLabel, children }: ManageDialogProps) {
  const headingId = useId();
  const dialogRef = useDialog(busy ? () => {} : onClose);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || submitDisabled) return;
    onSubmit?.();
  };
  return (
    <ModalPortal>
      <div className={dialogLayer(size)}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={busy ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          className={`keyboard-flow-cramped card relative flex flex-col overflow-hidden shadow-lift animate-scale-in ${dialogPanel(size)}`}
        >
          <div className="flex flex-none items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              {eyebrow ? <p className="text-[11px] font-bold uppercase tracking-wider text-ink-2 [overflow-wrap:anywhere]">{eyebrow}</p> : null}
              <h2 id={headingId} className="font-display text-xl font-bold text-ink [overflow-wrap:anywhere]">{title}</h2>
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close" title="Close (Esc)" className="grid h-10 w-10 flex-none place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink [@media(pointer:coarse)]:!h-11 [@media(pointer:coarse)]:!w-11">
              {Glyph.close}
            </button>
          </div>
          <form onSubmit={submit} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
            <div className="flex flex-none items-center gap-2 border-t border-line bg-surface px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end">
              <button type="button" onClick={onClose} disabled={busy} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">
                {closeLabel ?? (onSubmit ? 'Cancel' : 'Close')}
              </button>
              {onSubmit ? (
                <Button type="submit" variant={tone} loading={busy} disabled={submitDisabled} className="!min-h-[44px] flex-[2] sm:min-w-[9rem] sm:flex-none">
                  {submitLabel}
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

/** A labelled block in a form: the label (or legend-like heading), the control, and a hint or error under it. */
export function FormRow({ label, htmlFor, hint, hintId, error, errorId, optional, children }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; hintId?: string; error?: string | null; errorId?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
          {label}
          {optional ? <span className="font-normal text-ink-2"> (optional)</span> : null}
        </label>
      ) : (
        <span className="text-sm font-semibold text-ink">{label}</span>
      )}
      {children}
      {error ? <p id={errorId} className="text-xs font-medium text-danger">{error}</p> : hint ? <p id={hintId} className="text-xs text-ink-2">{hint}</p> : null}
    </div>
  );
}

/** A group of radio buttons as large, tappable choices. */
export function ChoiceGroup<T extends string>({ legend, name, value, options, onChange, disabled }: { legend: string; name: string; value: T; options: { value: T; label: string; hint?: string; disabled?: boolean }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-semibold text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className={`flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors [@media(pointer:coarse)]:!min-h-11 ${value === o.value ? 'border-brand bg-brand/5 text-ink' : 'border-line text-ink hover:bg-ground'} ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="mt-0.5 h-4 w-4 flex-none accent-brand" />
            <span className="min-w-0">
              <span className="block font-medium">{o.label}</span>
              {o.hint ? <span className="block text-xs text-ink-2">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
