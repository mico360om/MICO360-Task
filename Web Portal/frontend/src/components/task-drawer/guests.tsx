import { useEffect, useId, useRef, useState } from 'react';
import type { ApiTask } from '../../api/tasks';
import { useDialog } from '../../hooks/useDialog';
import { GUEST_LIMITS, GUEST_WORDS, cleanNote, noteProblem } from '../../lib/guest-contacts';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { ModalPortal } from '../ui/ModalPortal';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { GuestBadge } from '../task-form/guest-picker';
import { failureMessage, SaveIndicator, useSaveState } from './save-state';

/** 1.24 One of a task's guests as the task panel shows them. */
export interface DrawerGuest {
  guestId: string;
  /** The task's row for them (an old external-contact id — a search result links to it). */
  linkId: string;
  name: string;
  company: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  /** What this task needs from them. */
  note: string | null;
  /** Retired from the company's list (still on this task). */
  retired: boolean;
}

/** A task's guests in order: in full from a single task, else a list row's short ones. */
export function drawerGuests(task: Pick<ApiTask, 'taskGuests' | 'guests'>): DrawerGuest[] {
  if (task.taskGuests) {
    return task.taskGuests.map((g) => ({
      guestId: g.guestId,
      linkId: g.linkId,
      name: g.name,
      company: g.company ?? null,
      designation: g.designation ?? null,
      email: g.email ?? null,
      phone: g.phone ?? null,
      note: g.note ?? null,
      retired: g.retired === true,
    }));
  }
  return (task.guests ?? []).map((g) => ({ guestId: g.id, linkId: g.id, name: g.name, company: g.company ?? null, designation: null, email: null, phone: null, note: null, retired: false }));
}

/** "Ahmed Al Harthy · Acme · Guest" — a guest's chip on the panel (and its name for a screen reader). */
export const guestChipName = (g: { name: string; company: string | null }) => [g.name, g.company, GUEST_WORDS.badge].filter(Boolean).join(' · ');

/** Copy text: the clipboard where the browser allows it, else the old way (a selected hidden box). */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  const ok = document.execCommand?.('copy');
  box.remove();
  if (!ok) throw new Error('copy');
}

type DetailField = 'name' | 'company' | 'designation' | 'phone' | 'email';
const DETAIL_ORDER: DetailField[] = ['name', 'company', 'designation', 'phone', 'email'];

/**
 * A guest's details from the task panel: name, company, designation, phone and email as plain text,
 * each with Copy (guests are never messaged from here — no mail, call or chat links), this task's
 * note (changed by whoever may edit the task) and Remove guest. Opened over the panel.
 */
export function GuestDetailsDialog({
  guest,
  onClose,
  onSetNote,
  onRemove,
}: {
  guest: DrawerGuest;
  onClose: () => void;
  /** Save this task's note for them; rejects with the reason to show. */
  onSetNote?: (note: string | null) => Promise<void> | void;
  /** Take them off the task; rejects with the reason to show. */
  onRemove?: () => Promise<void> | void;
}) {
  const titleId = useId();
  const noteId = useId();
  const noteHelpId = useId();
  const [removing, setRemoving] = useState(false);
  const dialogRef = useDialog(removing ? () => {} : onClose, { initialFocus: 'container' });
  const [copied, setCopied] = useState<DetailField | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const [note, setNote] = useState(guest.note ?? '');
  const [savedNote, setSavedNote] = useState(guest.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [removeProblem, setRemoveProblem] = useState<string | null>(null);
  const save = useSaveState();
  const noteChanged = (cleanNote(note) ?? '') !== (cleanNote(savedNote) ?? '');

  const copy = async (field: DetailField, text: string) => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await copyText(text);
      setCopied(field);
      setCopyFailed(false);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
    timer.current = setTimeout(() => setCopied(null), 2500);
  };
  async function saveNote() {
    if (!onSetNote || save.busy) return;
    const why = noteProblem(note);
    if (why) {
      setProblem(why);
      return;
    }
    setProblem(null);
    const next = cleanNote(note);
    if (await save.run(() => onSetNote(next))) setSavedNote(next ?? '');
  }
  async function remove() {
    if (!onRemove || removing) return;
    setRemoving(true);
    setRemoveProblem(null);
    try {
      await onRemove();
      onClose();
    } catch (err) {
      setRemoveProblem(failureMessage(err, 'Couldn’t remove the guest. Please try again.'));
      setRemoving(false);
    }
  }

  return (
    <ModalPortal>
      <div className={dialogLayer('small', { onTop: true })}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={removing ? undefined : onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-unsaved={noteChanged || undefined}
          className={`card relative ${dialogPanel('small')} animate-scale-in overflow-y-auto p-4 outline-none sm:p-5`}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 id={titleId} dir="auto" className="min-w-0 break-words font-display text-lg font-semibold text-ink">
                  {guest.name}
                </h2>
                <GuestBadge />
                {guest.retired ? <span className="rounded bg-ground px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-ink-2">{GUEST_WORDS.retired}</span> : null}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{GUEST_WORDS.hint}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={removing}
              aria-label="Close"
              title="Close (Esc)"
              className={`grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink ${TOUCH_SQUARE}`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <dl className="mt-3 divide-y divide-line rounded-xl border border-line">
            {DETAIL_ORDER.map((field) => {
              const value = guest[field];
              if (!value) return null;
              const label = GUEST_WORDS.labels[field];
              return (
                // A <dl> row holds only its <dt> and <dd>s (axe: definition-list, dlitem): the label over the
                // value on the left, the Copy button in its own <dd> on the right, across both lines.
                <div key={field} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1.5">
                  <dt className="col-start-1 row-start-1 text-[11px] font-medium text-ink-3">{label}</dt>
                  <dd dir={field === 'phone' || field === 'email' ? 'ltr' : 'auto'} className="col-start-1 row-start-2 min-w-0 select-text break-words text-start text-sm text-ink">
                    {value}
                  </dd>
                  <dd className="col-start-2 row-span-2 row-start-1 flex">
                  <button
                    type="button"
                    onClick={() => void copy(field, value)}
                    aria-label={`${GUEST_WORDS.copy} ${label.toLowerCase()}`}
                    title={`${GUEST_WORDS.copy} ${label.toLowerCase()}`}
                    className={`inline-flex h-8 flex-none items-center gap-1 rounded-lg border border-line px-2 text-xs font-semibold transition-colors hover:border-brand hover:text-brand ${TOUCH_TALL} ${copied === field ? 'text-success' : 'text-ink-2'}`}
                  >
                    {copied === field ? (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="12" height="12" rx="2" />
                        <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                      </svg>
                    )}
                    {copied === field ? GUEST_WORDS.copied : GUEST_WORDS.copy}
                  </button>
                  </dd>
                </div>
              );
            })}
          </dl>
          <p role="status" className="sr-only">
            {copied ? `${GUEST_WORDS.labels[copied]} ${GUEST_WORDS.copied.toLowerCase()}.` : copyFailed ? 'Couldn’t copy it — select the text and copy it instead.' : ''}
          </p>
          {copyFailed ? <p className="mt-1 text-xs text-ink-2">Couldn’t copy it — select the text and copy it instead.</p> : null}

          <div className="mt-4">
            {onSetNote ? (
              <>
                <label htmlFor={noteId} className="text-sm font-medium text-ink">
                  {GUEST_WORDS.note}
                </label>
                <textarea
                  id={noteId}
                  dir="auto"
                  rows={3}
                  value={note}
                  disabled={save.busy}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={noteHelpId}
                  onChange={(e) => {
                    setNote(e.target.value);
                    if (problem) setProblem(null);
                  }}
                  className={`mt-1 block w-full resize-y rounded-lg border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:ring-2 ${
                    problem ? 'border-danger focus:ring-danger/20' : 'border-line focus:border-brand focus:ring-brand/20'
                  }`}
                />
                <div id={noteHelpId} className="mt-1 flex items-start justify-between gap-2">
                  {problem ? (
                    <p role="alert" className="text-xs font-medium text-danger">
                      {problem}
                    </p>
                  ) : (
                    <span />
                  )}
                  <span className="ms-auto flex-none text-[11px] tabular-nums text-ink-3">
                    {note.length} / {GUEST_LIMITS.note}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveNote()}
                    disabled={save.busy || !noteChanged}
                    className={`h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-50 ${TOUCH_TALL}`}
                  >
                    Save note
                  </button>
                </div>
                <SaveIndicator state={save.state} />
              </>
            ) : guest.note ? (
              <>
                <p className="text-[11px] font-medium text-ink-3">{GUEST_WORDS.note}</p>
                <p dir="auto" className="mt-0.5 whitespace-pre-line break-words text-start text-sm text-ink">
                  {guest.note}
                </p>
              </>
            ) : null}
          </div>

          {onRemove ? (
            <div className="mt-4 border-t border-line pt-3">
              {removeProblem ? (
                <p role="alert" className="mb-2 rounded-md bg-danger-soft px-2 py-1 text-xs font-medium text-danger">
                  {removeProblem}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void remove()}
                disabled={removing}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft disabled:opacity-60 ${TOUCH_TALL}`}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
                </svg>
                {removing ? 'Removing…' : GUEST_WORDS.remove}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  );
}
