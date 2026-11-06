import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import { MAX_PINS, savedSearchesApi, type SavedSearch } from '../../api/search';
import { ApiError } from '../../lib/api-client';
import { isSavedSearch, savedAddress, savedFiltersOf, type EverythingFilters } from '../../lib/search-everything';
import { useSavedSearchActions, useSavedSearches } from '../../lib/useSavedSearches';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { fieldClass } from '../ui/Field';

const NAME_MAX = 80;
const problemOf = (err: unknown, fallback: string) => (err instanceof ApiError || err instanceof Error ? err.message || fallback : fallback);
const iconButton = 'grid h-8 w-8 flex-none place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink focus-visible:bg-ground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

function PinIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" />
      <path d="M12 15v5" />
    </svg>
  );
}

/**
 * 1.23.6 "★ Save this search": the words and the filters of the page under a name (the reader reads the
 * words again whenever it runs). Once saved — or when the page shows a saved search of the person's —
 * it says so.
 */
export function SaveSearch({ filters, suggested }: { filters: EverythingFilters; suggested: string }) {
  const { list } = useSavedSearches();
  const { create } = useSavedSearchActions();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const current = list.mine.find((s) => isSavedSearch(filters, s));
  if (current && !open) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-ink-2" role="status">
        <span aria-hidden="true" className="text-brand">★</span>
        <span data-saved-as>
          Saved as “<bdi className="font-medium text-ink">{current.name}</bdi>”
        </span>
      </p>
    );
  }
  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setName(suggested.slice(0, NAME_MAX));
          setProblem(null);
          setOpen(true);
        }}
      >
        <span aria-hidden="true">★</span> Save this search
      </Button>
    );
  }
  const save = () => {
    const n = name.trim();
    if (!n) return setProblem('Give the search a name.');
    create.mutate(
      { name: n, q: filters.q.trim(), filters: savedFiltersOf(filters) },
      { onSuccess: () => setOpen(false), onError: (err) => setProblem(problemOf(err, 'The search couldn’t be saved. Try again.')) },
    );
  };
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label htmlFor={inputId} className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 text-xs font-medium text-ink-2">
        Name of the saved search
        <input id={inputId} autoFocus dir="auto" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} className={fieldClass(Boolean(problem), 'w-full py-1.5')} aria-describedby={problem ? `${inputId}-problem` : undefined} />
      </label>
      <Button type="submit" size="sm" disabled={create.isPending}>
        {create.isPending ? 'Saving…' : 'Save'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {problem ? (
        <p id={`${inputId}-problem`} role="alert" className="w-full text-xs text-danger">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

/**
 * 1.23.6 Saved searches on the Search page: the person's own (open, pin, rename, replace with the search
 * shown, share with a team they run, delete) and those shared with them (open and pin — not change).
 * Up to MAX_PINS pinned ones show in the side menu with a live count.
 */
export function SavedSearchesPanel({ filters, searching }: { filters: EverythingFilters; searching: boolean }) {
  const { list, isSuccess } = useSavedSearches();
  const { pin } = useSavedSearchActions();
  const [shown, setShown] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const panelId = useId();
  const total = list.mine.length + list.shared.length;
  if (!isSuccess || total === 0) return null;
  const open = shown ?? !searching;
  const togglePin = (s: SavedSearch) => {
    setProblem(null);
    pin.mutate({ id: s.id, pinned: !s.pinned }, { onError: (err) => setProblem(problemOf(err, 'That couldn’t be pinned. Try again.')) });
  };
  return (
    <section className="card mb-4 p-3" aria-label="Saved searches">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setShown(!open)} className="flex w-full items-center justify-between gap-2 rounded-lg text-start text-sm font-semibold text-ink [@media(pointer:coarse)]:!min-h-11">
        <span>
          <span aria-hidden="true" className="me-1.5 text-brand">★</span>
          Saved searches <span className="font-normal text-ink-2">({total})</span>
        </span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className={`text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id={panelId} hidden={!open} className="mt-2 flex flex-col gap-3">
        {problem ? (
          <p role="alert" className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
            {problem}
          </p>
        ) : null}
        <p className="text-xs text-ink-3">Pin up to {MAX_PINS} to the side menu; each shows how many items it finds now.</p>
        {list.mine.length ? (
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Yours</h3>
            <ul className="flex flex-col gap-1">
              {list.mine.map((s) => (
                <MineRow key={s.id} s={s} filters={filters} searching={searching} onPin={() => togglePin(s)} onProblem={setProblem} />
              ))}
            </ul>
          </div>
        ) : null}
        {list.shared.length ? (
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Shared with you</h3>
            <ul className="flex flex-col gap-1">
              {list.shared.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-ground">
                  <SavedLink s={s} filters={filters} />
                  <span dir="auto" className="hidden truncate text-xs text-ink-3 sm:inline">
                    by {s.owner.name}
                    {s.shared ? ` · ${s.shared.code}` : ''}
                  </span>
                  <PinButton s={s} onClick={() => togglePin(s)} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SavedLink({ s, filters }: { s: SavedSearch; filters: EverythingFilters }) {
  const here = isSavedSearch(filters, s);
  return (
    <Link to={`/search?${savedAddress(s)}`} aria-current={here ? 'page' : undefined} dir="auto" className={`min-w-0 flex-1 truncate rounded-md py-1 text-sm hover:text-brand hover:underline [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-3 ${here ? 'font-semibold text-brand' : 'text-ink'}`}>
      {s.name}
    </Link>
  );
}

function PinButton({ s, onClick }: { s: SavedSearch; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={s.pinned} aria-label={s.pinned ? `Unpin “${s.name}” from the side menu` : `Pin “${s.name}” to the side menu`} title={s.pinned ? 'Pinned to the side menu' : 'Pin to the side menu'} onClick={onClick} className={`${iconButton} ${s.pinned ? 'text-brand' : ''}`}>
      <PinIcon on={s.pinned} />
    </button>
  );
}

/** One of the person's own: open, pin, and (Manage) rename, replace with the search shown, share, delete. */
function MineRow({ s, filters, searching, onPin, onProblem }: { s: SavedSearch; filters: EverythingFilters; searching: boolean; onPin: () => void; onProblem: (p: string | null) => void }) {
  const { update, share, remove } = useSavedSearchActions();
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState(s.name);
  const [deleting, setDeleting] = useState(false);
  const id = useId();
  const options = useQuery({ queryKey: ['saved-search-share-options'], queryFn: () => savedSearchesApi(apiClient).shareOptions(), enabled: managing, staleTime: 60_000 });
  const projects = Array.isArray(options.data) ? options.data : [];
  const fail = (fallback: string) => (err: unknown) => onProblem(problemOf(err, fallback));
  const differs = searching && !isSavedSearch(filters, s);
  return (
    <li className="rounded-lg px-1.5 py-1 hover:bg-ground">
      <div className="flex items-center gap-2">
        <SavedLink s={s} filters={filters} />
        {s.shared ? <span className="hidden flex-none rounded-md bg-ground px-1.5 py-0.5 text-[11px] font-medium text-ink-2 sm:inline">Shared with {s.shared.code}</span> : null}
        <PinButton s={s} onClick={onPin} />
        <button type="button" aria-expanded={managing} aria-controls={`${id}-manage`} aria-label={`Manage “${s.name}”`} title="Rename, share or delete" onClick={() => setManaging(!managing)} className={iconButton}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="5.5" cy="12" r="1.2" />
            <circle cx="12" cy="12" r="1.2" />
            <circle cx="18.5" cy="12" r="1.2" />
          </svg>
        </button>
      </div>
      {managing ? (
        <div id={`${id}-manage`} className="mt-1.5 flex flex-col gap-2 border-t border-line pt-2">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onProblem(null);
              if (name.trim() && name.trim() !== s.name) update.mutate({ id: s.id, name: name.trim() }, { onError: fail('It couldn’t be renamed. Try again.') });
            }}
          >
            <label className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 text-xs font-medium text-ink-2">
              Name
              <input dir="auto" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} className={fieldClass(false, 'w-full py-1.5')} />
            </label>
            <Button type="submit" variant="secondary" size="sm" disabled={!name.trim() || name.trim() === s.name || update.isPending}>
              Rename
            </Button>
          </form>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Share with a team (they can use and pin it, not change it)
            <select
              value={s.shared?.projectId ?? ''}
              onChange={(e) => {
                onProblem(null);
                share.mutate({ id: s.id, projectId: e.target.value || null }, { onError: fail('It couldn’t be shared. Try again.') });
              }}
              className={fieldClass(false, 'w-full py-1.5')}
            >
              <option value="">Only me</option>
              {s.shared && !projects.some((p) => p.id === s.shared!.projectId) ? <option value={s.shared.projectId}>{`${s.shared.name} team`}</option> : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{`${p.name} team`}</option>
              ))}
            </select>
            {options.isSuccess && projects.length === 0 && !s.shared ? <span className="font-normal text-ink-3">You can share with the team of a project you run.</span> : null}
          </label>
          <div className="flex flex-wrap gap-2">
            {differs ? (
              <Button variant="secondary" size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, q: filters.q.trim(), filters: savedFiltersOf(filters) }, { onError: fail('It couldn’t be changed. Try again.') })}>
                Replace with the search shown
              </Button>
            ) : null}
            <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </div>
        </div>
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete “${s.name}”?`}
          confirmLabel="Delete"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(s.id, { onSuccess: () => setDeleting(false), onError: (err) => { setDeleting(false); onProblem(problemOf(err, 'It couldn’t be deleted. Try again.')); } })}
          onClose={() => setDeleting(false)}
        >
          {s.shared ? `It is shared with the ${s.shared.name} team: it goes for them too.` : 'Only the saved search goes; nothing it finds changes.'}
        </ConfirmDialog>
      ) : null}
    </li>
  );
}
