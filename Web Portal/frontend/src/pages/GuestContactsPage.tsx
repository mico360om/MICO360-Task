import { useEffect, useId, useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { companiesApi } from '../api/companies';
import { guestsApi, type ApiAdminGuest } from '../api/guests';
import { COMPANIES_KEY, problemText } from '../components/company/company-admin';
import { GuestEditDialog } from '../components/guests/GuestEditDialog';
import { GuestMergeDialog } from '../components/guests/GuestMergeDialog';
import { MIXED_COMPANIES, mergedText, onTasksText, TICK_TWO, tickedText } from '../components/guests/guest-admin-words';
import { Badge } from '../components/ui/Badge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { PageHeader } from '../components/ui/PageHeader';
import { guestLabel, GUEST_WORDS } from '../lib/guest-contacts';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';
import { useMediaQuery } from '../lib/useMediaQuery';

type Status = 'active' | 'retired' | 'all';
const STATUSES: { key: Status; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'retired', label: 'Retired' },
  { key: 'all', label: 'All' },
];

/** Below 768px (the md width, in em as the layout's widths are): one card per guest instead of the table. */
const PHONE_QUERY = '(max-width: 47.9375em)';
const ACTION = `rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-brand/30 hover:bg-ground hover:text-ink ${TOUCH_TALL}`;
/** A control that can't be used now but still says why (focusable, with the reason as its tooltip). */
const UNAVAILABLE = 'cursor-not-allowed opacity-50 hover:border-line hover:bg-transparent hover:text-ink-2';
const segment = (active: boolean) =>
  `rounded-lg px-3 py-1 text-sm font-medium transition-colors ${TOUCH_SQUARE} ${active ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`;
const SELECT = `rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${TOUCH_TALL}`;

/** The admins' guest list for these filters (every list of guests is under ['guests']). */
const guestsAdminKey = (filters: { companyId: string; q: string; status: Status }) => ['guests', 'admin', filters] as const;

/** The search box asks the server once typing pauses. */
function useSettled(value: string, ms = 300): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

const NOTES_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

/** A blank detail. */
const none = <span className="text-ink-3">—</span>;
const text = (value: string | null, ltr = false): ReactNode => (value ? <bdi dir={ltr ? 'ltr' : 'auto'} className="[overflow-wrap:anywhere]">{value}</bdi> : none);

/**
 * 1.24 Guest contacts (Admin), administrators only: each company's reusable list of guests — people
 * outside it named on tasks for the record (they never sign in or get emails). Search by name, company,
 * email or phone; edit a guest (every task with them shows the new details); retire one (hidden from
 * picking, kept on their tasks) or use them again; remove one that is on no task; merge duplicates of
 * one company into the one to keep. Guests are added on tasks, not here.
 */
export function GuestContactsPage() {
  const qc = useQueryClient();
  const api = guestsApi(apiClient);
  const ids = { company: useId(), reason: useId() };
  const phone = useMediaQuery(PHONE_QUERY);

  const companiesQ = useQuery({ queryKey: COMPANIES_KEY, queryFn: () => companiesApi(apiClient).list() });
  const companies = (Array.isArray(companiesQ.data) ? [...companiesQ.data] : []).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  // A one-company site looks as it always did: no picker, no company column.
  const multi = companies.length >= 2;

  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [search, setSearch] = useState('');
  const q = useSettled(search.trim());
  const company = multi ? companyId : '';
  const filters = { companyId: company, q, status };
  const listQ = useQuery({
    queryKey: guestsAdminKey(filters),
    queryFn: () => api.adminList({ companyId: company || undefined, q, status }),
    placeholderData: keepPreviousData,
  });
  const guests = Array.isArray(listQ.data) ? listQ.data : [];
  const filtered = q !== '' || company !== '' || status !== 'active';
  const showCompany = multi && company === '';

  // Ticked for a merge (kept while the search changes, so duplicates found by two searches can be merged).
  const [ticked, setTicked] = useState<Map<string, ApiAdminGuest>>(new Map());
  // As the list now shows them (an edit or a retire since the tick), else as ticked.
  const tickedList = [...ticked.values()].map((g) => guests.find((x) => x.id === g.id) ?? g);
  const mixed = new Set(tickedList.map((g) => g.companyId)).size > 1;
  const canMerge = tickedList.length >= 2 && !mixed;
  const toggleTick = (g: ApiAdminGuest) =>
    setTicked((m) => {
      const next = new Map(m);
      if (next.has(g.id)) next.delete(g.id);
      else next.set(g.id, g);
      return next;
    });

  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [editing, setEditing] = useState<ApiAdminGuest | null>(null);
  const [removing, setRemoving] = useState<ApiAdminGuest | null>(null);
  const [merging, setMerging] = useState(false);
  // The list, and every task view that shows guests (an edit or merge changes what they show).
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['guests'] });
    void qc.invalidateQueries({ predicate: (q) => ['task', 'tasks', 'board', 'project-tasks', 'my-tasks', 'calendar', 'search'].includes(String(q.queryKey[0])) });
  };

  const retireMut = useMutation({
    mutationFn: (g: ApiAdminGuest) => (g.retiredAt ? api.unretire(g.id) : api.retire(g.id)),
    onMutate: () => setNotice(null),
    onSuccess: (saved, g) => {
      setNotice({ text: saved.retiredAt ? `${guestLabel(g)} retired: hidden from picking, kept on their tasks.` : `${guestLabel(g)} can be picked again.` });
      refresh();
    },
    onError: (err, g) => setNotice({ text: problemText(err, `Couldn’t change ${guestLabel(g)}. Please try again.`), error: true }),
  });
  const removeMut = useMutation({
    mutationFn: (g: ApiAdminGuest) => api.remove(g.id),
    onSuccess: (_, g) => {
      setRemoving(null);
      setNotice({ text: `${guestLabel(g)} removed from the list.` });
      setTicked((m) => {
        if (!m.has(g.id)) return m;
        const next = new Map(m);
        next.delete(g.id);
        return next;
      });
      refresh();
    },
  });

  const askRemove = (g: ApiAdminGuest) => {
    if (g.taskCount > 0) {
      setNotice({ text: GUEST_WORDS.inUse, error: true });
      return;
    }
    removeMut.reset();
    setRemoving(g);
  };

  const actions = (g: ApiAdminGuest) => {
    const label = guestLabel(g);
    const inUse = g.taskCount > 0;
    return (
      <>
        <button type="button" onClick={() => setEditing(g)} aria-label={`Edit ${label}`} className={ACTION}>
          Edit
        </button>
        <button type="button" onClick={() => retireMut.mutate(g)} disabled={retireMut.isPending} aria-label={g.retiredAt ? `Use ${label} again` : `Retire ${label}`} className={`${ACTION} disabled:opacity-50`}>
          {g.retiredAt ? 'Use again' : 'Retire'}
        </button>
        <button
          type="button"
          onClick={() => askRemove(g)}
          aria-label={`Remove ${label}`}
          aria-disabled={inUse ? true : undefined}
          title={inUse ? GUEST_WORDS.inUse : undefined}
          className={`${ACTION} ${inUse ? UNAVAILABLE : 'hover:text-danger'}`}
        >
          Remove
        </button>
      </>
    );
  };
  const tick = (g: ApiAdminGuest) => (
    <label className={`inline-grid place-items-center rounded ${TOUCH_SQUARE}`}>
      <input type="checkbox" checked={ticked.has(g.id)} onChange={() => toggleTick(g)} aria-label={`Select ${guestLabel(g)}`} className="h-4 w-4 cursor-pointer accent-brand" />
    </label>
  );
  const name = (g: ApiAdminGuest) => (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <bdi className="font-medium text-ink [overflow-wrap:anywhere]">{g.name}</bdi>
      {g.notes ? (
        <span role="img" aria-label="Has notes" title={g.notes} className="inline-flex text-ink-2">
          {NOTES_ICON}
        </span>
      ) : null}
      {g.retiredAt ? (
        <>
          {' '}
          <Badge>{GUEST_WORDS.retired}</Badge>
        </>
      ) : null}
    </span>
  );

  return (
    <div>
      <PageHeader eyebrow="Admin" title={GUEST_WORDS.adminTitle} subtitle={GUEST_WORDS.adminHint} />

      {notice ? (
        <div role={notice.error ? 'alert' : 'status'} className={`mb-4 flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-sm ${notice.error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <p className="[overflow-wrap:anywhere]">{notice.text}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className={`shrink-0 opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>✕</button>
        </div>
      ) : null}

      <div className="card mb-4 flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          {multi ? (
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={ids.company} className="text-xs font-medium text-ink-2">Company list</label>
              <select id={ids.company} value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={`max-w-[16rem] ${SELECT}`}>
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.status === 'ARCHIVED' ? `${c.name} (archived)` : c.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div role="group" aria-label="Status" className="inline-flex gap-0.5 rounded-xl border border-line bg-surface p-0.5">
            {STATUSES.map((s) => (
              <button key={s.key} type="button" aria-pressed={status === s.key} onClick={() => setStatus(s.key)} className={segment(status === s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={120}
          placeholder={GUEST_WORDS.search}
          aria-label="Search guests"
          className={`w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand ${TOUCH_TALL}`}
        />
      </div>

      {tickedList.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2">
          <span className="text-sm font-semibold text-ink">{tickedText(tickedList.length)}</span>
          {!canMerge ? (
            <p id={ids.reason} className={`min-w-0 flex-1 text-sm ${mixed ? 'font-medium text-danger' : 'text-ink-2'}`}>
              {mixed ? MIXED_COMPANIES : TICK_TWO}
            </p>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={() => {
              if (canMerge) setMerging(true);
            }}
            aria-disabled={canMerge ? undefined : true}
            aria-describedby={canMerge ? undefined : ids.reason}
            className={`rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:brightness-95 ${TOUCH_TALL} ${canMerge ? '' : 'cursor-not-allowed opacity-50'}`}
          >
            Merge…
          </button>
          <button type="button" onClick={() => setTicked(new Map())} className={`rounded-lg px-2 py-1.5 text-sm font-medium text-ink-2 hover:bg-ground hover:text-ink ${TOUCH_TALL}`}>
            Clear
          </button>
        </div>
      ) : null}

      {listQ.isError && listQ.data ? <LoadError className="mb-3" what="the guest list" onRetry={() => void listQ.refetch()} /> : null}

      <div className={phone ? '' : 'card overflow-x-auto'}>
        {listQ.isLoading ? (
          <p className="p-4 text-ink-2">Loading…</p>
        ) : listQ.isError && !listQ.data ? (
          <LoadError className="p-4" what="the guest list" onRetry={() => void listQ.refetch()} />
        ) : guests.length === 0 ? (
          <EmptyState
            bare={!phone}
            title={filtered ? 'No guest matches' : 'No guests yet'}
            description={
              filtered
                ? 'Try other words, another company or another status.'
                : 'Guests are added on tasks: in the Assign box choose Guest, then + New guest.'
            }
          />
        ) : phone ? (
          <ul aria-label="Guests" className="flex flex-col gap-2">
            {guests.map((g) => (
              <li key={g.id} className="min-w-0 rounded-xl border border-line bg-surface p-3 shadow-soft">
                <div className="flex items-start gap-2">
                  <div className="-ms-2 -mt-1.5 flex-none">{tick(g)}</div>
                  <div className="min-w-0 flex-1">
                    {name(g)}
                    {g.company || g.designation ? (
                      <p className="text-sm text-ink-2 [overflow-wrap:anywhere]">
                        <bdi>{[g.company, g.designation].filter(Boolean).join(' · ')}</bdi>
                      </p>
                    ) : null}
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 text-sm min-[400px]:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-3">{GUEST_WORDS.labels.email}</dt>
                    <dd className="text-ink">{text(g.email, true)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-3">{GUEST_WORDS.labels.phone}</dt>
                    <dd className="text-ink">{text(g.phone, true)}</dd>
                  </div>
                  {showCompany ? (
                    <div className="min-w-0">
                      <dt className="text-xs text-ink-3">Company list</dt>
                      <dd className="text-ink-2">{text(g.companyName)}</dd>
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <dt className="text-xs text-ink-3">Tasks</dt>
                    <dd className="text-ink-2">{onTasksText(g.taskCount)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2">{actions(g)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <table aria-label="Guests" className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-2">
                <th className="w-10 p-3">
                  <span className="sr-only">Select</span>
                </th>
                <th className="min-w-[10rem] p-3">Name</th>
                <th className="p-3">Company</th>
                <th className="p-3">Designation</th>
                <th className="p-3">Email</th>
                <th className="p-3">Phone</th>
                {showCompany ? <th className="p-3">Company list</th> : null}
                <th className="p-3">Tasks</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id} className={`border-b border-line last:border-0 ${ticked.has(g.id) ? 'bg-brand/5' : ''}`}>
                  <td className="px-3 py-2">{tick(g)}</td>
                  <td className="p-3">{name(g)}</td>
                  <td className="p-3 text-ink-2">{text(g.company)}</td>
                  <td className="p-3 text-ink-2">{text(g.designation)}</td>
                  <td className="p-3 text-ink-2">{text(g.email, true)}</td>
                  <td className="whitespace-nowrap p-3 text-ink-2">{text(g.phone, true)}</td>
                  {showCompany ? <td className="p-3 text-ink-2">{text(g.companyName)}</td> : null}
                  <td className="whitespace-nowrap p-3 text-ink-2">{onTasksText(g.taskCount)}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2">{actions(g)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing ? (
        <GuestEditDialog
          key={editing.id}
          guest={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setNotice({ text: `${guestLabel(saved)} saved.` });
            refresh();
          }}
        />
      ) : null}
      {merging && canMerge ? (
        <GuestMergeDialog
          guests={tickedList}
          onClose={() => setMerging(false)}
          onMerged={(result) => {
            setTicked(new Map());
            setNotice({ text: mergedText(guestLabel(result.guest), result.tasks) });
            refresh();
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove ${guestLabel(removing)}?`}
          confirmLabel="Remove guest"
          keepLabel="Cancel"
          busy={removeMut.isPending}
          error={removeMut.isError ? problemText(removeMut.error, `Couldn’t remove ${guestLabel(removing)}. Please try again.`) : null}
          onConfirm={() => removeMut.mutate(removing)}
          onClose={() => setRemoving(null)}
        >
          They come off the company’s guest list. They’re on no task, so no task changes. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
