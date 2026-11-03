import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { companiesApi, type ApiCompany, type CompanyPeopleChange, type CompanyPerson } from '../../api/companies';
import { usersApi } from '../../api/users';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { fieldClass } from '../ui/Field';
import { companyPeopleKey, peopleChangeText, personName, problemText, refreshCompanies } from './company-admin';

const STATUS_WORD: Record<CompanyPerson['status'], string> = { ACTIVE: 'Active', INACTIVE: 'Inactive', SUSPENDED: 'Suspended' };
/** A finger-sized target on a touch screen. */
const TOUCH = '[@media(pointer:coarse)]:!min-h-11';

/**
 * A company's people (the Companies page's People tab): who is in it, their primary company marked,
 * a ✕ to take someone out (the server refuses it, with its words, when they must keep a company),
 * and "Add people" to put more in.
 */
export function CompanyPeoplePanel({ company }: { company: ApiCompany }) {
  const qc = useQueryClient();
  const api = companiesApi(apiClient);
  const q = useQuery({ queryKey: companyPeopleKey(company.id), queryFn: () => api.people(company.id) });
  const people = Array.isArray(q.data) ? q.data : [];
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<{ text: string; more?: { key: string; text: string }[]; error?: boolean } | null>(null);

  const removeMut = useMutation({
    mutationFn: (p: CompanyPerson) => api.removePerson(company.id, p.id),
    onMutate: () => setNote(null),
    onSuccess: () => refreshCompanies(qc),
    onError: (err, p) => setNote({ text: problemText(err, `Couldn’t take ${personName(p)} out of ${company.name}. Please try again.`), error: true }),
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">People ({q.isSuccess ? people.length : company.counts.people})</h3>
        {adding ? null : (
          <Button variant="secondary" size="sm" onClick={() => { setNote(null); setAdding(true); }} className={TOUCH}>
            Add people
          </Button>
        )}
      </div>
      {note ? (
        <div role={note.error ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${note.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <p>{note.text}</p>
          {note.more?.length ? (
            <details className="mt-1">
              <summary className="cursor-pointer font-medium">Show all</summary>
              <ul className="mt-1 list-disc pl-5">{note.more.map((m) => <li key={m.key}>{m.text}</li>)}</ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {adding ? (
        <AddPeople
          company={company}
          members={people}
          onCancel={() => setAdding(false)}
          onDone={(result) => {
            setAdding(false);
            const { text, more } = peopleChangeText(result, 'added', 'not added');
            setNote({ text, more, error: result.changed === 0 && result.refused.length > 0 });
          }}
        />
      ) : null}
      {q.isLoading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : q.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn’t load the people.{' '}
          <button type="button" onClick={() => void q.refetch()} className="font-semibold underline">Retry</button>
        </p>
      ) : people.length === 0 ? (
        <p className="text-sm text-ink-2">No one in <bdi>{company.name}</bdi> yet.</p>
      ) : (
        <ul aria-label={`People in ${company.name}`} className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <bdi className="block truncate text-sm font-medium text-ink">{personName(p)}</bdi>
                <span className="block truncate text-xs text-ink-2">@{p.username}</span>
              </div>
              {p.isPrimary ? <span title="Their emails use this company’s logo and name"><Badge tone="brand">Primary</Badge></span> : null}
              {p.status !== 'ACTIVE' ? <Badge>{STATUS_WORD[p.status]}</Badge> : null}
              <button
                type="button"
                onClick={() => removeMut.mutate(p)}
                disabled={removeMut.isPending && removeMut.variables?.id === p.id}
                aria-label={`Remove ${personName(p)} from ${company.name}`}
                title={`Remove from ${company.name}`}
                className="grid h-8 w-8 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Add people": everyone not in the company yet, A–Z, found by name, username or email; ticked ones are added. */
function AddPeople({ company, members, onCancel, onDone }: { company: ApiCompany; members: CompanyPerson[]; onCancel: () => void; onDone: (result: CompanyPeopleChange) => void }) {
  const qc = useQueryClient();
  const searchId = useId();
  const usersQ = useQuery({ queryKey: ['users'], queryFn: () => usersApi(apiClient).list() });
  const [find, setFind] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const inside = new Set(members.map((m) => m.id));
  const q = find.trim().toLocaleLowerCase('en');
  const candidates = (Array.isArray(usersQ.data) ? usersQ.data : [])
    .filter((u) => !inside.has(u.id))
    .sort((a, b) => personName(a).localeCompare(personName(b), 'en'));
  const shown = q ? candidates.filter((u) => [personName(u), u.username, u.email].some((t) => t.toLocaleLowerCase('en').includes(q))) : candidates;

  const addMut = useMutation({
    mutationFn: (ids: string[]) => companiesApi(apiClient).addPeople(company.id, ids),
    onSuccess: (result) => {
      refreshCompanies(qc);
      onDone(result);
    },
    onError: (err) => setProblem(problemText(err, 'Couldn’t add them. Please try again.')),
  });

  const toggle = (userId: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  const n = chosen.size;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-ground/60 p-3">
      {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{problem}</p> : null}
      <label htmlFor={searchId} className="sr-only">Find people</label>
      <input id={searchId} type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find people" className={fieldClass(false, '[@media(pointer:coarse)]:min-h-11')} />
      {usersQ.isLoading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : usersQ.isError ? (
        <p role="alert" className="text-sm text-danger">Couldn’t load the people.</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-ink-2">Everyone is in <bdi>{company.name}</bdi> already.</p>
      ) : (
        <div role="group" aria-label={`People to add to ${company.name}`} className="flex max-h-56 flex-col overflow-y-auto">
          {shown.length === 0 ? <p className="px-1 py-2 text-sm text-ink-2">No one matches.</p> : null}
          {shown.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface [@media(pointer:coarse)]:min-h-11">
              <input type="checkbox" checked={chosen.has(u.id)} onChange={() => toggle(u.id)} className="h-4 w-4 flex-none accent-brand" />
              <span className="min-w-0">
                <bdi className="block truncate text-sm text-ink">{personName(u)}</bdi>
                <span className="block truncate text-xs text-ink-2">@{u.username}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} className={TOUCH}>Cancel</Button>
        <Button size="sm" disabled={n === 0} loading={addMut.isPending} onClick={() => addMut.mutate([...chosen])} className={TOUCH}>
          {n === 0 ? 'Add' : `Add ${n === 1 ? '1 person' : `${n} people`}`}
        </Button>
      </div>
    </div>
  );
}
