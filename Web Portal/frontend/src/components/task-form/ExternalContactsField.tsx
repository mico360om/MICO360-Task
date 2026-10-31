import { useEffect, useId, useState } from 'react';
import { EXTERNAL_CONTACT_WORDS as W, MAX_EXTERNAL_CONTACTS, type ExternalContactFields } from '../../lib/external-contacts';
import { ContactCard, ContactEditor, type SuggestContacts } from '../task-drawer/external-contacts';

/** A contact in the task form: its fields, the server's id once it has one, and a key for the list. */
export interface FormContact extends ExternalContactFields {
  key: string;
  id?: string;
}

let seq = 0;
export const formContact = (fields: ExternalContactFields, id?: string): FormContact => ({ ...fieldsOnly(fields), key: id ?? `new-${++seq}`, ...(id ? { id } : {}) });
export const fieldsOnly = (c: ExternalContactFields): ExternalContactFields => ({ name: c.name, company: c.company, designation: c.designation, email: c.email, phone: c.phone, remarks: c.remarks });
const FIELDS = ['name', 'company', 'designation', 'email', 'phone', 'remarks'] as const;
/** Only the fields that changed (to send as a contact's change, so a field someone else changed meanwhile is kept). */
export function changedContactFields(before: ExternalContactFields, after: ExternalContactFields): Partial<ExternalContactFields> {
  const patch: Partial<Record<(typeof FIELDS)[number], string | null>> = {};
  for (const f of FIELDS) if ((before[f] ?? null) !== (after[f] ?? null)) patch[f] = after[f];
  return patch as Partial<ExternalContactFields>;
}

/**
 * The New / Edit task form's "External contacts": people outside the company responsible for the
 * task, kept in the form until it is saved (the same add / suggest / edit / remove as the task panel).
 * Says whether a contact is being typed in, so the form can ask for it to be saved first.
 */
export function ExternalContactsField({
  contacts,
  onChange,
  suggest,
  onEditingChange,
  disabled,
}: {
  contacts: FormContact[];
  onChange: (next: FormContact[]) => void;
  suggest?: SuggestContacts;
  onEditingChange?: (editing: boolean) => void;
  disabled?: boolean;
}) {
  const headingId = useId();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => onEditingChange?.(adding || editing !== null), [adding, editing, onEditingChange]);
  const full = contacts.length >= MAX_EXTERNAL_CONTACTS;
  return (
    <div role="group" aria-labelledby={headingId} className="rounded-xl border border-line px-3.5 py-3">
      <p className="text-sm font-semibold text-ink">
        <span id={headingId}>{W.heading}</span> <span className="font-normal text-ink-3">(optional)</span>
      </p>
      <p className="mt-0.5 text-xs text-ink-2">{W.hint}</p>
      {contacts.length > 0 ? (
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {contacts.map((c) => (
            <li key={c.key} className="py-2 first:pt-0 last:pb-0">
              {editing === c.key ? (
                <ContactEditor
                  title={W.editTitle}
                  initial={c}
                  suggest={suggest}
                  onSubmit={(fields) => {
                    onChange(contacts.map((x) => (x.key === c.key ? { ...x, ...fieldsOnly(fields) } : x)));
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <ContactCard
                  contact={c}
                  onEdit={disabled ? undefined : () => setEditing(c.key)}
                  onRemove={disabled ? undefined : () => onChange(contacts.filter((x) => x.key !== c.key))}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <div className="mt-2">
          <ContactEditor
            title={W.addTitle}
            suggest={suggest}
            onSubmit={(fields) => {
              onChange([...contacts, formContact(fields)]);
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : full ? (
        <p className="mt-2 text-xs text-ink-2">{W.full}</p>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={disabled}
          className="mt-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/10 disabled:opacity-60 [@media(pointer:coarse)]:h-11"
        >
          <span aria-hidden="true">+</span>
          {W.add}
        </button>
      )}
    </div>
  );
}
