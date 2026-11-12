import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { BIN_KEY, binApi, type BinQuery, type BinRow, type EraseResult, type RestoreResult } from '../api/recycle-bin';
import { ApiError } from '../lib/api-client';
import { binCountdown, binDay, eraseText, restoreText, type BinTone } from '../lib/recycle-bin';
import { invalidateTaskQueries } from '../lib/task-cache';
import { isBackwards, isWholeDate } from '../lib/date-box';
import { todayKey } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useOpenTask } from '../lib/useOpenTask';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useMyCompanies } from '../hooks/useMyCompanies';
import { TOUCH_SQUARE, TOUCH_TALL } from '../lib/touch';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { StatusPill } from '../components/ui/StatusPill';
import { TaskKey } from '../components/TaskKey';
import { ProjectAvatar } from '../components/ProjectAvatar';

/** Rows per page ("Show more" asks for the next page). */
export const BIN_PAGE_SIZE = 50;
/** The server restores or deletes at most this many tasks per request. */
const PER_REQUEST = 200;
const chunks = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / PER_REQUEST) }, (_, i) => ids.slice(i * PER_REQUEST, (i + 1) * PER_REQUEST));
/** A tick box with a 44px target on a touch screen (the box itself stays its size). */
const TICK = `inline-flex items-center justify-center ${TOUCH_SQUARE}`;

const TONE_CLASS: Record<BinTone, string> = {
  neutral: 'bg-ground text-ink-2',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

/** "12 days left" as a pill: amber at 7 or less, red at 2 or less, "Erased tonight" on the last day. */
function Countdown({ daysLeft }: { daysLeft: number }) {
  const c = binCountdown(daysLeft);
  return (
    <span data-tone={c.tone} className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[c.tone]}`}>
      {c.text}
    </span>
  );
}

const BinIcon = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v6M14 11v6" />
  </svg>
);

const inputClass = 'w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand [@media(pointer:coarse)]:min-h-11';

/** The address's filters (so a project page's "Deleted tasks" opens the bin filtered to it). */
function filtersFrom(params: URLSearchParams) {
  return {
    q: params.get('q') ?? '',
    project: params.get('project') ?? '',
    deletedBy: params.get('deletedBy') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    soon: params.get('soon') === '1',
    company: params.get('company') ?? '',
    sort: params.get('sort') === 'daysLeft' ? ('daysLeft' as const) : ('deleted' as const),
  };
}
type Filters = ReturnType<typeof filtersFrom>;

/**
 * Recycle Bin: deleted tasks, kept 60 days. Admins see every deleted task, the people who run a project
 * its own. Search (number, title, description), filters, sort; select many → Restore (and Delete forever
 * for admins). Each row: the task, its project, who deleted it and when, the days left (amber ≤ 7, red ≤ 2),
 * its people and its status when deleted. Phones: cards with the same actions.
 */
export function RecycleBinPage() {
  const [params, setParams] = useSearchParams();
  // The filters live in the address, mirrored here so a tick box or a date answers at once (the router
  // applies an address change as a transition); Back/forward (the address changing alone) resets them.
  const fromAddress = filtersFrom(params);
  const addressKey = JSON.stringify(fromAddress);
  const [filters, setFilters] = useState<Filters>(fromAddress);
  const [lastAddress, setLastAddress] = useState(addressKey);
  if (addressKey !== lastAddress) {
    setLastAddress(addressKey);
    setFilters(fromAddress);
  }
  const queryClient = useQueryClient();
  const timeZone = useCompanyTimeZone();
  const today = todayKey(timeZone);
  const openTask = useOpenTask();
  const { companies, pick } = useMyCompanies();

  // The search box answers as typing pauses; the address keeps it (Back returns to it).
  const [typed, setTyped] = useState(filters.q);
  const settled = useDebouncedValue(typed, 300);
  const set = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === '' || v === false || (k === 'sort' && v === 'deleted')) next.delete(k);
          else next.set(k, v === true ? '1' : String(v));
        }
        return next;
      },
      { replace: true },
    );
  };
  useEffect(() => {
    if (settled !== filters.q) set({ q: settled.trim() ? settled : '' });
    // Only the settled words write the address (not every render).
  }, [settled]);

  const backwards = isBackwards(filters.from, filters.to);
  const query: BinQuery = {
    q: filters.q || undefined,
    project: filters.project || undefined,
    deletedBy: filters.deletedBy || undefined,
    from: isWholeDate(filters.from) ? filters.from : undefined,
    to: isWholeDate(filters.to) ? filters.to : undefined,
    soon: filters.soon || undefined,
    company: filters.company || undefined,
    sort: filters.sort === 'daysLeft' ? 'daysLeft' : undefined,
  };
  const list = useInfiniteQuery({
    queryKey: [...BIN_KEY, 'list', query, pick],
    enabled: !backwards,
    queryFn: ({ pageParam }) => binApi(apiClient).list({ ...query, limit: BIN_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.limit < last.total ? last.offset + last.limit : undefined),
  });
  const first = list.data?.pages[0];
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages ?? []).flatMap((p) => p.rows).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  }, [list.data]);
  const canErase = first?.canErase ?? false;
  const total = first?.total ?? 0;
  const filtered = Boolean(filters.q || filters.project || filters.deletedBy || filters.from || filters.to || filters.soon || filters.company);

  // Selection: the rows ticked (only those still listed count).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const selected = rows.filter((r) => picked.has(r.id));
  const allPicked = rows.length > 0 && selected.length === rows.length;
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const [askBatch, setAskBatch] = useState<BinRow | null>(null);
  const [askErase, setAskErase] = useState<BinRow[] | null>(null);
  const done = (text: string, problem = false) => {
    setMessage({ text, problem });
    setPicked(new Set());
    void queryClient.invalidateQueries({ queryKey: BIN_KEY });
  };
  const failed = (e: unknown) => setMessage({ text: e instanceof ApiError && e.message ? e.message : 'Couldn’t do that. Check your connection and try again.', problem: true });
  const restoreM = useMutation({
    mutationFn: async ({ ids, whole }: { ids: string[]; whole: boolean }) => {
      // The server takes 200 at a time: a longer selection goes in turns, one answer for all of it.
      const all: RestoreResult = { restored: [], notRestored: [] };
      for (const part of chunks(ids)) {
        const r = await binApi(apiClient).restore(part, whole);
        all.restored.push(...r.restored);
        all.notRestored.push(...r.notRestored);
      }
      return all;
    },
    onSuccess: (r) => {
      setAskBatch(null);
      if (r.restored.length) void invalidateTaskQueries(queryClient);
      done(restoreText(r), r.restored.length === 0);
    },
    onError: failed,
  });
  const eraseM = useMutation({
    mutationFn: async (ids: string[]) => {
      const all: EraseResult = { erased: [], notErased: [] };
      for (const part of chunks(ids)) {
        const r = await binApi(apiClient).erase(part);
        all.erased.push(...r.erased);
        all.notErased.push(...r.notErased);
      }
      return all;
    },
    onSuccess: (r) => {
      setAskErase(null);
      done(eraseText(r), r.erased.length === 0);
    },
    onError: (e) => {
      setAskErase(null);
      failed(e);
    },
  });
  const busy = restoreM.isPending || eraseM.isPending;
  const restoreRow = (r: BinRow) => (r.batch ? setAskBatch(r) : restoreM.mutate({ ids: [r.id], whole: false }));

  const projectOptions = [{ value: '', label: 'All projects' }, ...(first?.facets.projects ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code }))];
  const deleterOptions = [{ value: '', label: 'Anyone' }, ...(first?.facets.deleters ?? []).map((p) => ({ value: p.id, label: p.name }))];
  // A site with several companies, nothing picked at the top: the bin can be narrowed to one company.
  const companyOptions = companies.length > 1 && pick === null ? [{ value: '', label: 'All companies' }, ...companies.map((c) => ({ value: c.id, label: c.name }))] : null;
  const forbidden = list.error instanceof ApiError && list.error.status === 403;
  const when = (iso: string) => binDay(iso, timeZone, today);
  const people = (r: BinRow) => (r.assignees.length ? r.assignees.map((a) => a.name).join(', ') : '—');

  const rowActions = (r: BinRow) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button size="sm" variant="secondary" onClick={() => restoreRow(r)} disabled={busy} aria-label={`Restore ${r.key}`} className={TOUCH_TALL}>
        Restore
      </Button>
      {canErase ? (
        <Button size="sm" variant="ghost" onClick={() => setAskErase([r])} disabled={busy} aria-label={`Delete forever: ${r.key}`} className={`!text-danger hover:!bg-danger-soft ${TOUCH_TALL}`}>
          Delete forever
        </Button>
      ) : null}
    </div>
  );
  const taskButton = (r: BinRow) => (
    <button type="button" onClick={() => openTask(r.id)} className={`group flex min-w-0 items-center gap-2 text-start ${TOUCH_TALL}`}>
      <TaskKey value={r.key} />
      <span dir="auto" className="min-w-0 truncate font-medium text-ink group-hover:text-brand group-hover:underline">
        {r.title}
      </span>
    </button>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Recycle Bin"
        subtitle="Deleted tasks are kept 60 days, then erased. Restore one to bring it back with everything it had."
      />

      <div className="card mb-4 grid grid-cols-2 items-end gap-2 p-2.5 lg:flex lg:flex-wrap">
        <label className="col-span-2 flex min-w-0 flex-col gap-0.5 text-[11px] text-ink-2 lg:w-64">
          Search
          <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Number, title or description" maxLength={200} aria-label="Search deleted tasks" className={inputClass} />
        </label>
        <div className="min-w-0 lg:w-48">
          <SearchableSelect ariaLabel="Filter by project" value={filters.project} onChange={(v) => set({ project: v })} options={projectOptions} />
        </div>
        <div className="min-w-0 lg:w-44">
          <SearchableSelect ariaLabel="Filter by who deleted it" value={filters.deletedBy} onChange={(v) => set({ deletedBy: v })} options={deleterOptions} />
        </div>
        {companyOptions ? (
          <div className="min-w-0 lg:w-44">
            <SearchableSelect ariaLabel="Filter by company" value={filters.company} onChange={(v) => set({ company: v })} options={companyOptions} />
          </div>
        ) : null}
        <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-ink-2">
          Deleted from
          <input type="date" aria-label="Deleted from" value={filters.from} max={filters.to || undefined} aria-invalid={backwards || undefined} onChange={(e) => set({ from: e.target.value })} className={inputClass} />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-ink-2">
          Deleted to
          <input type="date" aria-label="Deleted to" value={filters.to} min={filters.from || undefined} aria-invalid={backwards || undefined} onChange={(e) => set({ to: e.target.value })} className={inputClass} />
        </label>
        <label className={`flex items-center gap-2 self-center rounded-lg px-1 text-sm text-ink ${TOUCH_TALL}`}>
          <input type="checkbox" checked={filters.soon} onChange={(e) => set({ soon: e.target.checked })} className="h-4 w-4 accent-brand" />7 days or less left
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-ink-2 lg:ms-auto">
          Sort
          <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })} aria-label="Sort" className={inputClass}>
            <option value="deleted">Deleted on, newest first</option>
            <option value="daysLeft">Days left, fewest first</option>
          </select>
        </label>
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setTyped('');
              set({ q: '', project: '', deletedBy: '', from: '', to: '', soon: false, company: '' });
            }}
            className={`col-span-2 self-center justify-self-start rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink ${TOUCH_TALL}`}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {message ? (
        <p role={message.problem ? 'alert' : 'status'} className={`mb-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-medium ${message.problem ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}>
          <span>{message.text}</span>
          <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss" className={`text-current opacity-80 hover:opacity-100 ${TOUCH_SQUARE}`}>
            ✕
          </button>
        </p>
      ) : null}

      {selected.length ? (
        <div role="region" aria-label="Selected tasks" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-soft">
          <span className="text-sm font-semibold text-ink">{selected.length} selected</span>
          <Button size="sm" onClick={() => restoreM.mutate({ ids: selected.map((r) => r.id), whole: false })} disabled={busy} loading={restoreM.isPending} className={TOUCH_TALL}>
            Restore
          </Button>
          {canErase ? (
            <Button size="sm" variant="danger" onClick={() => setAskErase(selected)} disabled={busy} className={TOUCH_TALL}>
              Delete forever
            </Button>
          ) : null}
          <button type="button" onClick={() => setPicked(new Set())} className={`rounded-lg px-2 text-sm font-medium text-ink-2 hover:bg-ground hover:text-ink ${TOUCH_TALL}`}>
            Clear selection
          </button>
        </div>
      ) : null}

      {backwards ? (
        <p role="alert" className="card card-pad text-sm text-danger">
          The start date must be on or before the end date.
        </p>
      ) : forbidden ? (
        <EmptyState icon={BinIcon} title="The Recycle Bin is for administrators and the people who run a project." />
      ) : list.isLoading ? (
        <p role="status" className="card card-pad text-ink-2">
          Loading…
        </p>
      ) : list.isError ? (
        <p role="alert" className="card card-pad text-danger">
          Couldn’t load the Recycle Bin.{' '}
          <button type="button" onClick={() => void list.refetch()} className="font-semibold underline">
            Retry
          </button>
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BinIcon}
          title={filtered ? 'No deleted tasks match these filters' : 'The Recycle Bin is empty'}
          description={filtered ? 'Try other words, or clear the filters.' : 'Deleted tasks are kept here for 60 days, then erased.'}
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-ink-2" aria-live="polite">
            {total === 1 ? '1 deleted task' : `${total} deleted tasks`}
          </p>
          {/* Desktop and tablet: a table. */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Deleted tasks</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
                  <th scope="col" className="w-10 px-3 py-2">
                    <label className={TICK}>
                      <input
                        type="checkbox"
                        aria-label="Select every task shown"
                        checked={allPicked}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.id)))}
                        className="h-4 w-4 accent-brand"
                      />
                    </label>
                  </th>
                  <th scope="col" className="px-3 py-2">Task</th>
                  <th scope="col" className="px-3 py-2">Project</th>
                  <th scope="col" className="px-3 py-2">Deleted by</th>
                  <th scope="col" className="px-3 py-2">Deleted on</th>
                  <th scope="col" className="px-3 py-2">Days left</th>
                  <th scope="col" className="hidden px-3 py-2 xl:table-cell">Assigned to</th>
                  <th scope="col" className="hidden px-3 py-2 lg:table-cell">Status</th>
                  <th scope="col" className="px-3 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-bin-row={r.id} className="border-b border-line last:border-0 hover:bg-ground/60">
                    <td className="px-3 py-2">
                      <label className={TICK}>
                        <input type="checkbox" aria-label={`Select ${r.key}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-brand" />
                      </label>
                    </td>
                    <td className="max-w-[22rem] px-3 py-2">
                      {taskButton(r)}
                      {r.batch ? <p className="mt-0.5 text-xs text-ink-3">Deleted with its series ({r.batch.size} tasks)</p> : null}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <ProjectAvatar project={r.project} size="xs" />
                        <bdi className="truncate">{r.project.name}</bdi>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">{r.deletedBy?.name ?? 'Unknown'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-2">{when(r.deletedAt)}</td>
                    <td className="px-3 py-2">
                      <Countdown daysLeft={r.daysLeft} />
                    </td>
                    <td className="hidden max-w-[12rem] truncate px-3 py-2 text-ink-2 xl:table-cell">{people(r)}</td>
                    <td className="hidden px-3 py-2 lg:table-cell">
                      <StatusPill category={r.status.category} label={r.status.name} />
                    </td>
                    <td className="px-3 py-2">{rowActions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phones: cards with the same facts and actions. */}
          <ul className="space-y-2 md:hidden" aria-label="Deleted tasks">
            {rows.map((r) => (
              <li key={r.id} data-bin-card={r.id} className="card p-3">
                <div className="flex items-start gap-3">
                  <label className={`mt-1 flex-none ${TICK} min-h-11 min-w-11`}>
                    <input type="checkbox" aria-label={`Select ${r.key}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="h-5 w-5 accent-brand" />
                  </label>
                  <div className="min-w-0 flex-1">
                    {taskButton(r)}
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2">
                      <ProjectAvatar project={r.project} size="xs" />
                      <bdi className="truncate">{r.project.name}</bdi>
                    </p>
                    <p className="mt-1 text-xs text-ink-2">
                      Deleted by {r.deletedBy?.name ?? 'Unknown'} on {when(r.deletedAt)}
                      {r.batch ? ` · with its series (${r.batch.size} tasks)` : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Countdown daysLeft={r.daysLeft} />
                      <StatusPill category={r.status.category} label={r.status.name} />
                    </div>
                    {r.assignees.length ? <p className="mt-1 text-xs text-ink-2">Assigned to {people(r)}</p> : null}
                    <div className="mt-2">{rowActions(r)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage} className={TOUCH_TALL}>
                Show more
              </Button>
            </div>
          ) : null}
        </>
      )}

      {askBatch ? (
        <ConfirmDialog
          title={`Restore ${askBatch.key}?`}
          tone="primary"
          confirmLabel={`Restore all ${askBatch.batch?.size ?? ''}`.trim()}
          keepLabel="Cancel"
          busy={restoreM.isPending}
          onConfirm={() => restoreM.mutate({ ids: [askBatch.id], whole: true })}
          onClose={() => setAskBatch(null)}
        >
          <p>It was deleted with its repeating series ({askBatch.batch?.size} tasks). Restore all of them, or only this task?</p>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => restoreM.mutate({ ids: [askBatch.id], whole: false })} disabled={restoreM.isPending} className={TOUCH_TALL}>
              Only this task
            </Button>
          </div>
        </ConfirmDialog>
      ) : null}
      {askErase ? (
        <ConfirmDialog
          title="Delete forever?"
          confirmLabel="Delete forever"
          busy={eraseM.isPending}
          onConfirm={() => eraseM.mutate(askErase.map((r) => r.id))}
          onClose={() => setAskErase(null)}
        >
          {askErase.length === 1 ? `${askErase[0]!.key} “${askErase[0]!.title}”` : `${askErase.length} tasks`} and everything {askErase.length === 1 ? 'it' : 'they'} had — comments, files, checklists and history — will be deleted. This can’t be undone.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
