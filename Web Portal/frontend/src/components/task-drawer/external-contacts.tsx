import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../lib/api-client';
import {
  EXTERNAL_CONTACT_LIMITS,
  EXTERNAL_CONTACT_WORDS as W,
  MAX_EXTERNAL_CONTACTS,
  checkExternalContact,
  contactRoleLine,
  mailHref,
  phoneHref,
  suggestionText,
  type ExternalContactField,
  type ExternalContactFields,
} from '../../lib/external-contacts';
import { FieldError, FieldLabel, fieldClass } from '../ui/Field';
import { PencilIcon } from './inline-text';
import { useOwnEscape } from './save-state';

/** A contact as the task panel shows it. */
export interface DrawerExternalContact extends ExternalContactFields {
  id: string;
}

/** Earlier contacts of the project whose name or company has a word starting with what was typed. */
export type SuggestContacts = (typed: string) => Promise<ExternalContactFields[]>;

type Problems = Partial<Record<ExternalContactField, string>>;

const EMPTY: ExternalContactFields = { name: '', company: null, designation: null, email: null, phone: null, remarks: null };
const fieldsOf = (c: ExternalContactFields): ExternalContactFields => ({ name: c.name, company: c.company, designation: c.designation, email: c.email, phone: c.phone, remarks: c.remarks });
const ORDER: ExternalContactField[] = ['name', 'company', 'designation', 'email', 'phone', 'remarks'];

/** A failed save in words: the field problems the server named, and its reason (or what to try). */
export function contactProblem(err: unknown, fallback: string): { fields: Problems; message: string | null } {
  if (err instanceof ApiError) {
    const fields = ((err.details as { fields?: Problems } | undefined)?.fields ?? {}) as Problems;
    if (Object.keys(fields).length > 0) return { fields, message: null };
    if (err.status === 403) return { fields: {}, message: err.message || 'You don’t have permission to do that.' };
    return { fields: {}, message: err.message || fallback };
  }
  return { fields: {}, message: `${fallback} Check your connection and try again.` };
}

const linkClass = 'inline-flex min-h-7 max-w-full items-center gap-1 text-xs font-medium text-brand hover:underline [@media(pointer:coarse)]:min-h-11';
const iconButton =
  'grid h-9 w-9 flex-none place-items-center rounded-lg text-ink-3 transition-colors hover:bg-ground hover:text-ink sm:h-7 sm:w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

const MailIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);
const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
  </svg>
);

/**
 * The contact's name, with earlier contacts of the project suggested as it is typed (the ARIA
 * combobox pattern): ↑/↓ move through them, Enter picks the highlighted one (Enter with none
 * highlighted keeps what was typed), Escape closes the list; picking copies all six fields.
 */
function NameField({
  id,
  value,
  onChange,
  onPick,
  suggest,
  invalid,
  describedBy,
  inputRef,
  onEnter,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPick: (c: ExternalContactFields) => void;
  /** Enter with no suggestion picked: save the contact (never the form around it). */
  onEnter: () => void;
  suggest?: SuggestContacts;
  invalid: boolean;
  describedBy?: string;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const listId = useId();
  const [options, setOptions] = useState<ExternalContactFields[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Only what the person types asks for suggestions (not a pick filling the box).
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => {
    // What was suggested for the earlier text is not offered for this one.
    setOptions([]);
    setActive(-1);
    if (!suggest || typed === null || !typed.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      suggest(typed.trim()).then(
        (found) => {
          // Only for the box still being typed in (not one that was left meanwhile).
          if (!live || document.activeElement !== inputRef.current) return;
          setOptions(found);
          setActive(-1);
          setOpen(true);
        },
        () => live && setOptions([]),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [typed, suggest, inputRef]);
  const listed = open && options.length > 0;
  const pick = (c: ExternalContactFields) => {
    setOpen(false);
    setTyped(null);
    setOptions([]);
    onPick(c);
  };
  // Escape closes the list first (and only the list), before the form or the panel hear it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !listed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [listed, inputRef]);
  const optionId = (i: number) => `${listId}-o${i}`;
  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={listed}
        aria-controls={listed ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={listed && active >= 0 ? optionId(active) : undefined}
        aria-required="true"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        dir="auto"
        value={value}
        maxLength={EXTERNAL_CONTACT_LIMITS.name + 20}
        onChange={(e) => {
          onChange(e.target.value);
          setTyped(e.target.value);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(listed && active >= 0)) {
            e.preventDefault();
            onEnter();
            return;
          }
          if (!listed) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((active + 1) % options.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((active - 1 + options.length) % options.length);
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            e.stopPropagation();
            pick(options[active]!);
          }
        }}
        className={fieldClass(invalid, 'h-10 w-full sm:h-9 [@media(pointer:coarse)]:h-11')}
      />
      {listed ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-lg border border-line bg-surface py-1 shadow-lift">
          <p className="px-3 pb-1 pt-0.5 text-[11px] text-ink-3" aria-hidden="true">
            {W.suggestionHint}
          </p>
          <ul id={listId} role="listbox" aria-label={W.suggestions} tabIndex={-1} className="max-h-60 overflow-y-auto">
            {options.map((c, i) => (
              <li
                key={`${c.name}|${c.company ?? ''}|${i}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the box
                  pick(c);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-[40px] cursor-pointer items-center px-3 py-1.5 text-sm [@media(pointer:coarse)]:min-h-11 ${i === active ? 'bg-brand/10' : 'hover:bg-ground'}`}
              >
                <span dir="auto" className="min-w-0 flex-1 truncate text-start text-ink">
                  {suggestionText(c)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The six fields of one contact, to add or change it. Not a <form>: it is used inside the New and
 * Edit task form too (a form can't hold another), so Save is a plain button and Enter in a
 * one-line box saves this contact only. Problems are shown at their fields — the shared check's
 * first, then the server's.
 */
export function ContactEditor({
  title,
  initial = EMPTY,
  suggest,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: ExternalContactFields;
  suggest?: SuggestContacts;
  /** Save the cleaned contact; reject with the reason (an ApiError's field problems are shown at the fields). */
  onSubmit: (fields: ExternalContactFields) => Promise<void> | void;
  onCancel: () => void;
}) {
  const base = useId();
  const [draft, setDraft] = useState<ExternalContactFields>(() => fieldsOf(initial));
  // 1.22 review: typed and not saved yet — the task panel asks before Previous / Next drops it.
  const changed = ORDER.some((f) => (draft[f] ?? '') !== (initial[f] ?? ''));
  const [problems, setProblems] = useState<Problems>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const refs = useRef<Partial<Record<ExternalContactField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  useOwnEscape(rootRef, () => {
    if (!saving) onCancel();
  });
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const idOf = (f: ExternalContactField) => `${base}-${f}`;
  const errorId = (f: ExternalContactField) => `${base}-${f}-error`;
  const set = (f: ExternalContactField, v: string) => {
    setDraft((d) => ({ ...d, [f]: f === 'name' ? v : v === '' ? null : v }));
    if (problems[f]) setProblems((p) => ({ ...p, [f]: undefined }));
  };
  const focusFirst = (p: Problems) => {
    const first = ORDER.find((f) => p[f]);
    if (first === 'name') nameRef.current?.focus();
    else if (first) refs.current[first]?.focus();
  };

  async function save() {
    if (saving) return;
    setMessage(null);
    const check = checkExternalContact(draft);
    if (!check.ok) {
      setProblems(check.problems);
      focusFirst(check.problems);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(check.contact);
    } catch (err) {
      const why = contactProblem(err, W.saveFailed);
      setProblems(why.fields);
      setMessage(why.message);
      focusFirst(why.fields);
    } finally {
      setSaving(false);
    }
  }
  const saveOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.defaultPrevented) {
      e.preventDefault();
      void save();
    }
  };

  const box = (f: Exclude<ExternalContactField, 'name' | 'remarks'>, type: 'text' | 'email' | 'tel') => (
    <div className="flex min-w-0 flex-col gap-1">
      <FieldLabel htmlFor={idOf(f)}>{W.labels[f]}</FieldLabel>
      <input
        ref={(el) => {
          refs.current[f] = el;
        }}
        id={idOf(f)}
        type={type}
        dir={type === 'text' ? 'auto' : 'ltr'}
        autoComplete="off"
        inputMode={type === 'email' ? 'email' : type === 'tel' ? 'tel' : undefined}
        value={draft[f] ?? ''}
        aria-invalid={problems[f] ? true : undefined}
        aria-describedby={problems[f] ? errorId(f) : undefined}
        onChange={(e) => set(f, e.target.value)}
        onKeyDown={saveOnEnter}
        className={fieldClass(Boolean(problems[f]), 'h-10 w-full sm:h-9 [@media(pointer:coarse)]:h-11')}
      />
      <FieldError id={errorId(f)}>{problems[f]}</FieldError>
    </div>
  );

  return (
    <div ref={rootRef} role="group" aria-labelledby={`${base}-title`} data-unsaved={changed || undefined} className="rounded-xl border border-line bg-ground/40 p-3">
      <h4 id={`${base}-title`} className="mb-2 text-sm font-semibold text-ink">
        {title}
      </h4>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
          <FieldLabel htmlFor={idOf('name')} required>
            {W.labels.name}
          </FieldLabel>
          <NameField
            id={idOf('name')}
            inputRef={nameRef}
            value={draft.name}
            onChange={(v) => set('name', v)}
            onPick={(c) => {
              setDraft(fieldsOf(c));
              setProblems({});
            }}
            suggest={suggest}
            onEnter={() => void save()}
            invalid={Boolean(problems.name)}
            describedBy={problems.name ? errorId('name') : undefined}
          />
          <FieldError id={errorId('name')}>{problems.name}</FieldError>
        </div>
        {box('company', 'text')}
        {box('designation', 'text')}
        {box('email', 'email')}
        {box('phone', 'tel')}
        <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
          <FieldLabel htmlFor={idOf('remarks')}>{W.labels.remarks}</FieldLabel>
          <textarea
            ref={(el) => {
              refs.current.remarks = el;
            }}
            id={idOf('remarks')}
            dir="auto"
            rows={2}
            value={draft.remarks ?? ''}
            aria-invalid={problems.remarks ? true : undefined}
            aria-describedby={problems.remarks ? errorId('remarks') : `${base}-remarks-count`}
            onChange={(e) => set('remarks', e.target.value)}
            className={fieldClass(Boolean(problems.remarks), 'w-full resize-y')}
          />
          <div className="flex items-start justify-between gap-2">
            <FieldError id={errorId('remarks')}>{problems.remarks}</FieldError>
            <span id={`${base}-remarks-count`} className="ms-auto text-[11px] tabular-nums text-ink-3">
              {(draft.remarks ?? '').length} / {EXTERNAL_CONTACT_LIMITS.remarks}
            </span>
          </div>
        </div>
      </div>
      {message ? (
        <p role="alert" className="mt-2 rounded-md bg-danger-soft px-2 py-1 text-xs font-medium text-danger">
          {message}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="h-9 rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60 [@media(pointer:coarse)]:h-11"
        >
          {saving ? 'Saving…' : W.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="h-9 rounded-lg px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-ground disabled:opacity-60 [@media(pointer:coarse)]:h-11"
        >
          {W.cancel}
        </button>
      </div>
    </div>
  );
}

/** One contact: who they are and how to reach them (mail and call links), with Edit and Remove when allowed. */
export function ContactCard({
  contact,
  onEdit,
  onRemove,
  focusEdit = false,
}: {
  contact: ExternalContactFields;
  onEdit?: () => void;
  /** Remove it (asked first); rejects with the reason to show. */
  onRemove?: () => Promise<void> | void;
  /** Put focus on its Edit button (back from editing it). */
  focusEdit?: boolean;
}) {
  const editRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusEdit) editRef.current?.focus();
  }, [focusEdit]);
  const [asking, setAsking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  useOwnEscape(askRef, () => setAsking(false), asking);
  const role = contactRoleLine(contact);
  const mail = mailHref(contact.email);
  const call = phoneHref(contact.phone);
  const remove = async () => {
    setRemoving(true);
    setProblem(null);
    try {
      await onRemove?.();
      setAsking(false);
    } catch (err) {
      setProblem(contactProblem(err, W.removeFailed).message ?? W.removeFailed);
    } finally {
      setRemoving(false);
    }
  };
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate text-start text-sm font-semibold text-ink" title={contact.name}>
          {contact.name}
        </p>
        {role ? (
          <p dir="auto" className="truncate text-start text-xs text-ink-2" title={role}>
            {role}
          </p>
        ) : null}
        {mail || call ? (
          <div className="mt-0.5 flex flex-wrap gap-x-3">
            {mail ? (
              <a href={mail} className={linkClass}>
                <MailIcon />
                <span className="truncate" dir="ltr">{contact.email}</span>
              </a>
            ) : null}
            {call ? (
              <a href={call} className={linkClass}>
                <PhoneIcon />
                <span dir="ltr">{contact.phone}</span>
              </a>
            ) : null}
          </div>
        ) : null}
        {contact.remarks ? (
          <p dir="auto" className="mt-0.5 whitespace-pre-line break-words text-start text-xs text-ink-2">
            {contact.remarks}
          </p>
        ) : null}
        {asking ? (
          <div ref={askRef} role="group" aria-label={W.confirmRemove} className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-md bg-danger-soft px-2 py-1">
            <span className="text-xs font-medium text-danger">{W.confirmRemove}</span>
            <button type="button" onClick={() => void remove()} disabled={removing} className="min-h-8 rounded bg-danger px-2 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-60 [@media(pointer:coarse)]:!min-h-11">
              {W.remove}
            </button>
            <button ref={keepRef} type="button" onClick={() => setAsking(false)} disabled={removing} className="min-h-8 rounded px-2 text-xs font-medium text-ink-2 hover:bg-surface [@media(pointer:coarse)]:!min-h-11">
              {W.keep}
            </button>
          </div>
        ) : null}
        {problem ? (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">
            {problem}
          </p>
        ) : null}
      </div>
      {onEdit || onRemove ? (
        <div className="flex flex-none items-center">
          {onEdit ? (
            <button ref={editRef} type="button" onClick={onEdit} aria-label={`${W.edit} ${contact.name}`} title={W.edit} className={iconButton}>
              <PencilIcon />
            </button>
          ) : null}
          {onRemove ? (
            <button type="button" onClick={() => setAsking(true)} aria-label={`${W.remove} ${contact.name}`} title={W.remove} className={`${iconButton} hover:!bg-danger-soft hover:!text-danger`}>
              <TrashIcon />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "External contacts": the people outside the company responsible for the task, kept apart from
 * its assignees. Each shows name, company · designation, email and phone (links) and remarks; with
 * the handlers, they can be added, changed and removed (asked first). Never emailed or notified.
 */
export function ExternalContactsSection({
  contacts,
  onAdd,
  onSave,
  onRemove,
  suggest,
}: {
  contacts: DrawerExternalContact[];
  onAdd?: (fields: ExternalContactFields) => Promise<void> | void;
  onSave?: (id: string, fields: ExternalContactFields) => Promise<void> | void;
  onRemove?: (id: string) => Promise<void> | void;
  suggest?: SuggestContacts;
}) {
  const headingId = useId();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // Back from editing a contact: focus returns to its Edit button.
  const [backTo, setBackTo] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const full = contacts.length >= MAX_EXTERNAL_CONTACTS;
  /** Focus Add (or the heading, when the task is full), once the change has shown. */
  const focusAdd = () => setTimeout(() => (addRef.current ?? headingRef.current)?.focus(), 0);
  const closeAdd = () => {
    setAdding(false);
    focusAdd();
  };
  const closeEdit = (id: string) => {
    setEditing(null);
    setBackTo(id);
  };
  return (
    <section role="region" aria-labelledby={headingId} className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="eyebrow outline-none">
          {W.heading}
        </h3>
        {contacts.length > 0 ? <span className="text-xs tabular-nums text-ink-3" aria-hidden="true">{contacts.length}</span> : null}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{W.hint}</p>
      {contacts.length === 0 && !adding ? <p className="mt-2 text-sm text-ink-3">{W.none}</p> : null}
      {contacts.length > 0 ? (
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {contacts.map((c) => (
            <li key={c.id} className="py-2 first:pt-0 last:pb-0">
              {editing === c.id && onSave ? (
                <ContactEditor
                  title={W.editTitle}
                  initial={c}
                  suggest={suggest}
                  onSubmit={async (fields) => {
                    await onSave(c.id, fields);
                    closeEdit(c.id);
                  }}
                  onCancel={() => closeEdit(c.id)}
                />
              ) : (
                <ContactCard
                  contact={c}
                  focusEdit={backTo === c.id}
                  onEdit={
                    onSave
                      ? () => {
                          setBackTo(null);
                          setEditing(c.id);
                        }
                      : undefined
                  }
                  onRemove={
                    onRemove
                      ? async () => {
                          await onRemove(c.id);
                          focusAdd();
                        }
                      : undefined
                  }
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {adding && onAdd ? (
        <div className="mt-2">
          <ContactEditor
            title={W.addTitle}
            suggest={suggest}
            onSubmit={async (fields) => {
              await onAdd(fields);
              closeAdd();
            }}
            onCancel={closeAdd}
          />
        </div>
      ) : null}
      {onAdd && !adding ? (
        full ? (
          <p className="mt-2 text-xs text-ink-2">{W.full}</p>
        ) : (
          <button
            ref={addRef}
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/10 [@media(pointer:coarse)]:h-11"
          >
            <span aria-hidden="true">+</span>
            {W.add}
          </button>
        )
      ) : null}
    </section>
  );
}
