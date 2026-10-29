import { useMemo, useState, type ReactNode } from 'react';
import { Avatar } from '../ui/Avatar';
import { ComboPicker } from '../task-drawer/combo-picker';

export interface PersonOption {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string | null;
}

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ًͯ-ٟ]/g, '');

/**
 * Who works on a task: the chosen people as removable chips, and a search box listing the rest of
 * the project's team (by name or username, with their pictures). The words can be changed for other
 * lists of people (a new project's team).
 */
export function AssigneeSelect({
  people,
  value,
  onChange,
  note,
  noteId,
  disabled = false,
  listLabel = 'Assigned people',
  addLabel = 'Add people',
  noPeopleText = 'No one is on this project yet',
  allChosenText = 'Everyone on this project is assigned.',
  required,
  invalid,
  describedBy,
}: {
  people: PersonOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  /** Shown under the box — e.g. who gets the task when nobody is picked. */
  note?: ReactNode;
  /** The note's id, for a label elsewhere to point at. */
  noteId?: string;
  disabled?: boolean;
  /** What the chips are called (a screen reader reads it). */
  listLabel?: string;
  /** The search box's name. */
  addLabel?: string;
  /** The box's placeholder when there is nobody to pick. */
  noPeopleText?: string;
  /** Said when everyone has been picked. */
  allChosenText?: string;
  /** At least one person must be picked (said to a screen reader on the search box). */
  required?: boolean;
  invalid?: boolean;
  /** Ids of what describes the search box (a problem with the pick). */
  describedBy?: string;
}) {
  const [query, setQuery] = useState('');
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const chosen = value.map((id) => byId.get(id) ?? { id, name: 'Someone' });
  const rest = people.filter((p) => !value.includes(p.id));
  const q = fold(query.trim());
  const matches = q ? rest.filter((p) => fold(p.name).includes(q) || (p.username ? fold(p.username).includes(q) : false)) : rest;

  return (
    <div className="flex flex-col gap-2">
      {chosen.length ? (
        <ul aria-label={listLabel} className="flex flex-wrap gap-1.5">
          {chosen.map((p) => (
            <li key={p.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-ground py-1 pe-1 ps-1 text-sm text-ink">
              <span aria-hidden="true" className="flex"><Avatar name={p.name} size="sm" src={p.avatarUrl} /></span>
              <span dir="auto" className="min-w-0 truncate">{p.name}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((id) => id !== p.id))}
                disabled={disabled}
                aria-label={`Remove ${p.name}`}
                title={`Remove ${p.name}`}
                className="grid h-6 w-6 flex-none place-items-center rounded-full text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger [@media(pointer:coarse)]:-my-2.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ComboPicker
        label={addLabel}
        placeholder={people.length ? 'Search by name…' : noPeopleText}
        query={query}
        onQuery={setQuery}
        openOnFocus
        inline
        disabled={disabled || people.length === 0}
        required={required}
        invalid={invalid}
        describedBy={describedBy}
        options={matches.map((p) => ({
          id: p.id,
          label: p.name,
          lead: <span aria-hidden="true" className="flex"><Avatar name={p.name} size="sm" src={p.avatarUrl} /></span>,
          trail: p.username ? <span className="flex-none text-xs text-ink-2">@{p.username}</span> : undefined,
        }))}
        emptyText={rest.length === 0 ? allChosenText : `No one matches “${query.trim()}”.`}
        onPick={(id) => {
          onChange([...value, id]);
          setQuery('');
        }}
      />
      {note ? <p id={noteId} className="text-xs text-ink-2">{note}</p> : null}
    </div>
  );
}
