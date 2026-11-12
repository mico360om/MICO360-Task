import { useId, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { guestsApi, type ApiAdminGuest, type ApiGuest } from '../../api/guests';
import { useDialog } from '../../hooks/useDialog';
import { checkGuest, GUEST_LIMITS, GUEST_WORDS, type GuestField } from '../../lib/guest-contacts';
import { problemText } from '../company/company-admin';
import { Button } from '../ui/Button';
import { FieldLabel, fieldClass } from '../ui/Field';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';

type Field = GuestField | 'notes';
const FIELDS: { key: GuestField; type: 'text' | 'email' | 'tel'; dir?: 'auto' | 'ltr'; autoComplete: string }[] = [
  { key: 'name', type: 'text', dir: 'auto', autoComplete: 'off' },
  { key: 'company', type: 'text', dir: 'auto', autoComplete: 'off' },
  { key: 'designation', type: 'text', dir: 'auto', autoComplete: 'off' },
  { key: 'email', type: 'email', dir: 'ltr', autoComplete: 'off' },
  { key: 'phone', type: 'tel', dir: 'ltr', autoComplete: 'off' },
];
const NOTES_PROBLEM = `Notes can have at most ${GUEST_LIMITS.notes} characters.`;

/**
 * 1.24 Guest contacts → Edit: a guest's own details (name, company, designation, email, phone) and the
 * admins' notes. Checked with the same rules as a new guest on a task; saved for the guest, so every
 * task with them shows the new details.
 */
export function GuestEditDialog({ guest, onClose, onSaved }: { guest: ApiAdminGuest; onClose: () => void; onSaved: (g: ApiGuest) => void }) {
  const [draft, setDraft] = useState<Record<Field, string>>({
    name: guest.name,
    company: guest.company ?? '',
    designation: guest.designation ?? '',
    email: guest.email ?? '',
    phone: guest.phone ?? '',
    notes: guest.notes ?? '',
  });
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({});
  const refs = useRef<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const id = useId();
  const save = useMutation({
    mutationFn: (body: Parameters<ReturnType<typeof guestsApi>['adminUpdate']>[1]) => guestsApi(apiClient).adminUpdate(guest.id, body),
    onSuccess: (saved) => {
      onSaved(saved);
      onClose();
    },
  });
  const close = () => {
    if (!save.isPending) onClose();
  };
  const dialogRef = useDialog(close);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    const check = checkGuest({ name: draft.name, company: draft.company, designation: draft.designation, email: draft.email, phone: draft.phone });
    const notes = draft.notes.trim();
    const found: Partial<Record<Field, string>> = check.ok ? {} : { ...check.problems };
    if (notes.length > GUEST_LIMITS.notes) found.notes = NOTES_PROBLEM;
    setProblems(found);
    const first = (['name', 'company', 'designation', 'email', 'phone', 'notes'] as Field[]).find((k) => found[k]);
    if (first || !check.ok) {
      if (first) refs.current[first]?.focus();
      return;
    }
    save.mutate({ ...check.guest, notes: notes || null });
  }

  const set = (key: Field, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (problems[key]) setProblems((p) => ({ ...p, [key]: undefined }));
  };
  const fieldId = (k: Field) => `${id}-${k}`;

  return (
    <ModalPortal>
      <div className={dialogLayer('form')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={close} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Edit guest"
          className={`keyboard-flow-cramped card relative flex flex-col overflow-hidden shadow-lift animate-scale-in ${dialogPanel('form')}`}
        >
          <div className="flex flex-none items-center gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <h2 className="flex-1 font-display text-xl font-bold text-ink">Edit guest</h2>
            <button type="button" onClick={close} aria-label="Close" title="Close (Esc)" className="grid h-10 w-10 place-items-center rounded-lg text-ink-2 hover:bg-ground hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <form onSubmit={submit} noValidate className="keyboard-flow-body flex min-h-0 flex-1 flex-col">
            <div className="keyboard-flow-body min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info">Every task with this guest shows the new details.</p>
              {save.isError ? (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                  {problemText(save.error, 'Couldn’t save the guest. Please try again.')}
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.map(({ key, type, dir, autoComplete }) => (
                  <div key={key} className={`flex min-w-0 flex-col gap-1 ${key === 'name' ? 'sm:col-span-2' : ''}`}>
                    <FieldLabel htmlFor={fieldId(key)} required={key === 'name'}>
                      {GUEST_WORDS.labels[key]}
                    </FieldLabel>
                    <input
                      id={fieldId(key)}
                      ref={(el) => {
                        refs.current[key] = el;
                      }}
                      type={type}
                      dir={dir}
                      autoComplete={autoComplete}
                      value={draft[key]}
                      maxLength={GUEST_LIMITS[key]}
                      onChange={(e) => set(key, e.target.value)}
                      aria-required={key === 'name' ? true : undefined}
                      aria-invalid={problems[key] ? true : undefined}
                      aria-describedby={problems[key] ? `${fieldId(key)}-err` : undefined}
                      className={fieldClass(!!problems[key], 'w-full')}
                    />
                    {problems[key] ? (
                      <p id={`${fieldId(key)}-err`} className="text-xs font-medium text-danger">
                        {problems[key]}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={fieldId('notes')}>{GUEST_WORDS.labels.notes}</FieldLabel>
                <textarea
                  id={fieldId('notes')}
                  ref={(el) => {
                    refs.current.notes = el;
                  }}
                  dir="auto"
                  rows={4}
                  value={draft.notes}
                  maxLength={GUEST_LIMITS.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  aria-invalid={problems.notes ? true : undefined}
                  aria-describedby={`${fieldId('notes')}-hint${problems.notes ? ` ${fieldId('notes')}-err` : ''}`}
                  className={fieldClass(!!problems.notes, 'w-full resize-y leading-relaxed')}
                />
                <p id={`${fieldId('notes')}-hint`} className="text-end text-xs tabular-nums text-ink-2">
                  {draft.notes.length}/{GUEST_LIMITS.notes} characters
                </p>
                {problems.notes ? (
                  <p id={`${fieldId('notes')}-err`} className="text-xs font-medium text-danger">
                    {problems.notes}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-none gap-2 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:justify-end sm:px-6">
              <button type="button" title="Cancel (Esc)" aria-keyshortcuts="Escape" onClick={close} disabled={save.isPending} className="!min-h-[44px] flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-50 sm:flex-none">
                Cancel
              </button>
              <Button type="submit" loading={save.isPending} className="!min-h-[44px] flex-[2] sm:min-w-[8rem] sm:flex-none">
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
