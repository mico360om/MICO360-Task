import { useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { usersApi } from '../../api/users';
import { Avatar } from '../ui/Avatar';
import { fieldClass } from '../ui/Field';
import { SearchableSelect } from '../ui/SearchableSelect';

/** Someone invited from the new-meeting form: a portal user, or an outside guest by email. */
export type MeetingPerson = { kind: 'user'; id: string; name: string } | { kind: 'guest'; email: string; name: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const personKey = (p: MeetingPerson) => (p.kind === 'user' ? `u:${p.id}` : `e:${p.email.toLowerCase()}`);

/**
 * The new-meeting form's People: team members from the directory and guests by email (named from
 * the part before the @ unless a name is given). The organizer is always in, so isn't offered.
 */
export function PeopleField({ value, onChange, organizerId }: { value: MeetingPerson[]; onChange: (next: MeetingPerson[]) => void; organizerId: string | null }) {
  const dirQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });
  const directory = Array.isArray(dirQ.data) ? dirQ.data : [];
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const chosen = new Set(value.map(personKey));
  const options = directory
    .filter((u) => u.id !== organizerId && !chosen.has(`u:${u.id}`))
    .map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}`.trim() || u.username, hint: `@${u.username}` }));

  const addUser = (id: string) => {
    const u = directory.find((d) => d.id === id);
    if (u) onChange([...value, { kind: 'user', id, name: `${u.firstName} ${u.lastName}`.trim() || u.username }]);
  };
  const addGuest = () => {
    const e = email.trim();
    if (!EMAIL_RE.test(e)) return setProblem('Enter a valid email address, for example name@company.com.');
    if (chosen.has(`e:${e.toLowerCase()}`)) return setProblem('That guest is already invited.');
    setProblem(null);
    onChange([...value, { kind: 'guest', email: e, name: name.trim() || e.split('@')[0]! }]);
    setEmail('');
    setName('');
  };
  // Enter adds the guest; it doesn't send the whole form.
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addGuest();
  };

  return (
    <fieldset role="group" aria-label="People" className="flex flex-col gap-2 rounded-2xl border border-line p-3.5">
      <legend className="px-1 text-sm font-semibold text-ink">People</legend>
      <p className="text-xs text-ink-2">You’re in as the organizer. Invitations go out when you send them from the meeting’s page.</p>
      {value.length ? (
        <ul aria-label="People invited" className="flex flex-wrap gap-1.5">
          {value.map((p) => (
            <li key={personKey(p)} className="flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-1 pr-0.5 text-sm">
              <Avatar size="sm" name={p.name} src={p.kind === 'user' ? directory.find((d) => d.id === p.id)?.avatarUrl : null} />
              <bdi className="truncate text-ink">{p.name}</bdi>
              {p.kind === 'guest' ? <span className="truncate text-xs text-ink-3" dir="ltr">{p.email}</span> : null}
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                onClick={() => onChange(value.filter((x) => personKey(x) !== personKey(p)))}
                className="grid h-8 w-8 flex-none place-items-center rounded-full text-ink-3 hover:bg-ground hover:text-ink"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <SearchableSelect ariaLabel="Add a team member" placeholder="Add a team member…" options={options} value="" onChange={addUser} emptyText="Everyone is already invited" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input aria-label="Guest email" type="email" inputMode="email" dir="ltr" value={email} onChange={(e) => { setEmail(e.target.value); setProblem(null); }} onKeyDown={onEnter} placeholder="Guest email" className={fieldClass(!!problem)} />
        <input aria-label="Guest name (optional)" dir="auto" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} placeholder="Guest name (optional)" className={fieldClass(false)} />
        <button type="button" onClick={addGuest} className="min-h-[44px] rounded-xl border border-line px-4 text-sm font-semibold text-ink hover:bg-ground">
          Add guest
        </button>
      </div>
      {problem ? <p role="alert" className="text-xs font-medium text-danger">{problem}</p> : null}
    </fieldset>
  );
}
