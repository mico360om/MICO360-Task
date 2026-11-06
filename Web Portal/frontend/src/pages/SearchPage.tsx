import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOpenTask } from '../lib/useOpenTask';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { searchEverythingApi } from '../api/search';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { fieldClass } from '../components/ui/Field';
import { ResultRow } from '../components/search/ResultRow';
import { AiPanel } from '../components/search/AiPanel';
import { TasksUnavailable } from '../components/search/TasksUnavailable';
import { Understood } from '../components/search/Understood';
import { SaveSearch, SavedSearchesPanel } from '../components/search/SavedSearches';
import { MAX_QUERY_LETTERS } from '../lib/search-highlight';
import { DensityButton } from '../components/DensityButton';
import { KIND_META, SEARCH_KINDS, everythingAddress, everythingFilters, hasEverythingFilters, taskPanelOf, type EverythingFilters, type ReaderChipKey, type SearchHit, type SearchKind } from '../lib/search-everything';
import { STATUS_META, STATUS_ORDER } from '../lib/taskStatus';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useAuthStore } from '../stores/auth-store';
import { isProjectArchived } from '../lib/project-archive';
import { useTaskSteps } from '../lib/task-steps';

/** Words of at least this length are searched (as in the top-bar search). */
const MIN_LETTERS = 2;

const DONE_CHOICES: { label: string; value: boolean | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Open', value: false },
  { label: 'Done', value: true },
];

/** "24 results", "1 result", "1000+ results". */
function countText(n: number, capped: boolean): string {
  if (capped) return '1000+ results';
  return `${n} ${n === 1 ? 'result' : 'results'}`;
}

/**
 * Search results (1.23 Search everything): every item the person can open — tasks, projects, meetings,
 * meeting notes, minutes, files (their text too), inspections and (1.23.6) checklist items and clients &
 * contacts — that holds the words, best first, a page at a time, each with its kind, the words marked,
 * its project, state and date, and a direct link. 1.23.6: plain English is read on the server ("overdue
 * MICO tasks assigned to me" → chips, each removable, or "Search the words instead"); filters work
 * without words; a search can be saved, pinned and shared with a team.
 * The AI panel above answers the question from those same items when AI is on (asked with Enter, "Ask
 * AI", or from the top bar); the normal results never wait for it. The words and the filters (kind,
 * project, task status, person or "Only mine", dates, open or done, archived projects) live in the
 * address, so the page can be shared and Back returns to it. The top bar's company picker narrows it.
 */
export function SearchPage({ debounceMs = 300 }: { debounceMs?: number }) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => everythingFilters(params), [params]);
  const timeZone = useCompanyTimeZone();
  const myId = useAuthStore((s) => s.user?.id);

  /**
   * Change the filters in the address (the task panel's `task` and `file` stay). Any change but an ask
   * clears `ai` (review I5): the AI answers the new search when asked again — never once per chip or
   * keystroke.
   */
  const update = (patch: Partial<EverythingFilters>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(everythingAddress({ ...everythingFilters(prev), ai: undefined, ...patch }));
        // (1.23.6, review M11: and a marked checklist item or contact.)
        for (const keep of ['task', 'file', 'item', 'contact']) {
          const v = prev.get(keep);
          if (v) next.set(keep, v);
        }
        return next;
      },
      { replace: true },
    );

  // The box: what is typed reaches the address (and the search) once typing pauses — trimmed, as the
  // address keeps it, while the box keeps what was typed. Enter searches at once and asks the AI.
  const [term, setTerm] = useState(filters.q);
  const pushed = useRef(filters.q);
  useEffect(() => {
    if (filters.q !== pushed.current) {
      pushed.current = filters.q;
      setTerm(filters.q);
    }
  }, [filters.q]);
  useEffect(() => {
    const typed = term.trim().slice(0, MAX_QUERY_LETTERS);
    if (typed === pushed.current) return;
    const t = setTimeout(() => {
      pushed.current = typed;
      // New words: the AI answers them when asked again, and they are read afresh (1.23.6).
      update({ q: typed, ai: undefined, off: undefined, plain: undefined });
    }, debounceMs);
    return () => clearTimeout(t);
    // `update` reads the address when it runs, so it is not a dependency.
  }, [term, debounceMs]);
  const submit = () => {
    const typed = term.trim().slice(0, MAX_QUERY_LETTERS);
    const fresh = typed !== filters.q;
    pushed.current = typed;
    update({ q: typed, ai: typed.length >= MIN_LETTERS ? true : undefined, ...(fresh ? { off: undefined, plain: undefined } : {}) });
  };

  const words = filters.q.trim();
  // 1.23.6: filters alone search too (the server lists every item they hold) — not "Include archived" alone.
  const searching = words.length >= MIN_LETTERS || hasEverythingFilters({ ...filters, archived: undefined });
  const { ai: _asked, ...ask } = filters;
  void _asked;
  const results = useInfiniteQuery({
    queryKey: ['search-all', ask],
    queryFn: ({ pageParam }) => searchEverythingApi(apiClient).search(ask, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: searching,
  });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const peopleQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  const hits = useMemo(() => {
    const seen = new Set<string>();
    return (results.data?.pages ?? []).flatMap((p) => p.data).filter((h) => (seen.has(`${h.kind}:${h.id}`) ? false : (seen.add(`${h.kind}:${h.id}`), true)));
  }, [results.data]);
  // A page whose items all changed since they were indexed comes back empty: ask for the next one.
  const lastPage = results.data?.pages[results.data.pages.length - 1];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results;
  useEffect(() => {
    if (lastPage && lastPage.data.length === 0 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [lastPage, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const first = results.data?.pages[0];
  const counts = first?.counts;
  const corrected = first?.corrected ?? [];
  // 1.23.6: what the reader understood (kept while the next search loads, so the chips don't jump).
  const [understood, setUnderstood] = useState(first?.understood);
  useEffect(() => {
    if (results.data) setUnderstood(results.data.pages[0]?.understood);
    else if (!searching) setUnderstood(undefined);
  }, [results.data, searching]);
  // The type the reader read ("tasks") shows as the chosen type until one is chosen.
  const activeType = filters.type ?? (understood?.kinds?.length === 1 ? understood.kinds[0] : undefined);
  const withOff = (key: ReaderChipKey) => [...new Set([...(filters.off ?? []), key])];

  const projects = (Array.isArray(projectsQ.data) ? projectsQ.data : [])
    .filter((p) => filters.archived || !isProjectArchived(p) || p.id === filters.projectId)
    .sort((a, b) => Number(isProjectArchived(a)) - Number(isProjectArchived(b)) || a.name.localeCompare(b.name, 'en'));
  const people = (Array.isArray(peopleQ.data) ? peopleQ.data : [])
    .filter((u) => u.id !== myId && (u.active !== false || u.id === filters.person))
    .map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  // A task opens in the app's task panel, the results' tasks as its list (Previous / Next); a file
  // opens its task with the file marked; everything else is a link (ResultRow).
  const showTask = useOpenTask();
  const open = (hit: SearchHit) => {
    const taskIds = hits.filter((h) => h.kind === 'task').map((h) => h.id);
    if (hit.target.type === 'task') return showTask(hit.target.taskId, taskIds);
    // A file, a checklist item (1.23.6) or an external contact (1.23.6): its task, with it marked.
    const panel = taskPanelOf(hit);
    if (panel?.mark) {
      const [param, value] = panel.mark;
      useTaskSteps.getState().open(null, '/search');
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('task', panel.task);
        for (const other of ['file', 'item', 'contact']) next.delete(other);
        next.set(param, value);
        return next;
      });
    }
  };

  const toggleArchived = () => {
    const on = !filters.archived;
    const chosen = projectsQ.data?.find?.((p) => p.id === filters.projectId);
    update({ archived: on || undefined, ...(!on && chosen && isProjectArchived(chosen) ? { projectId: undefined } : {}) });
  };
  // "All" with a type the reader read takes its chip off; a type chosen wins over it (the server leaves its chip out).
  const chooseType = (type: SearchKind | undefined) => update({ type, ...(type !== 'task' ? { status: undefined } : {}), ...(!type && understood?.kinds?.length ? { off: withOff('kind') } : {}) });

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors [@media(pointer:coarse)]:!min-h-11 ${active ? 'bg-brand text-white shadow-brand' : 'border border-line text-ink-2 hover:bg-ground'}`;
  const select = fieldClass(false, 'w-full py-1.5');
  // Counts stop at 1000 (a kind with more says "1000+", review M2).
  const shown = (n: number) => (n > 1000 ? '1000+' : String(n));
  const allCount = counts ? SEARCH_KINDS.reduce((n, k) => n + (counts[k] ?? 0), 0) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Workspace" title="Search results" subtitle="Everything you can open — tasks, projects, meetings, notes, minutes, files, inspections, checklist items, clients and contacts — that holds the words or matches the filters." />

      <div className="card mb-4 flex flex-col gap-3 p-3">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            type="search"
            role="searchbox"
            aria-label="Search everything"
            aria-describedby="search-tips"
            dir="auto"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search tasks, projects, meetings, files…"
            maxLength={MAX_QUERY_LETTERS}
            className={fieldClass(false, 'w-full')}
          />
          <p id="search-tips" className="mt-1 text-xs text-ink-3">
            Part of a word is enough, and a small spelling mistake is forgiven. Plain English works too: “overdue tasks assigned to me”, “high priority in MICO”, “meetings last week”. Put a phrase in quotes (“hot work”) to find it as written. Press Enter to ask AI too.
          </p>
        </form>

        {/* 1.23.6: what the words were read as — each chip removable, or every word as typed. */}
        <Understood
          understood={searching ? understood : null}
          plain={Boolean(filters.plain) && words.length >= MIN_LETTERS}
          onRemove={(key) => update({ off: withOff(key) })}
          onPlain={() => update({ plain: true, off: undefined })}
          onRead={() => update({ plain: undefined })}
          onRestore={() => update({ off: undefined })}
        />

        <div className="flex items-start gap-2">
          <div role="group" aria-label="Type" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            <button type="button" aria-pressed={!activeType} onClick={() => chooseType(undefined)} className={chip(!activeType)}>
              All{allCount !== null ? ` ${shown(allCount)}` : ''}
            </button>
            {SEARCH_KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={activeType === k} onClick={() => chooseType(k)} className={chip(activeType === k)}>
                {KIND_META[k].plural}
                {counts ? ` ${shown(counts[k] ?? 0)}` : ''}
              </button>
            ))}
          </div>
          {/* Compact rows (1.23.0): the quick button, as on the other lists' toolbars (hidden on phones and touch). */}
          <DensityButton />
        </div>

        <div className={`grid gap-2 ${activeType === 'task' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Project
            <select value={filters.projectId ?? ''} onChange={(e) => update({ projectId: e.target.value || undefined })} className={select}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {isProjectArchived(p) ? `${p.name} (archived)` : p.name}
                </option>
              ))}
            </select>
          </label>
          {activeType === 'task' ? (
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
              Status
              <select value={filters.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined, ...(filters.type ? {} : { type: 'task' as const }) })} className={select}>
                <option value="">Any status</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s]!.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Assignee or organizer
            <select value={filters.person ?? ''} onChange={(e) => update({ person: e.target.value || undefined })} className={select}>
              <option value="">Anyone</option>
              <option value="me">Me</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            From
            <input type="date" value={filters.from ?? ''} max={filters.to} onChange={(e) => update({ from: e.target.value || undefined })} className={select} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            To
            <input type="date" value={filters.to ?? ''} min={filters.from} onChange={(e) => update({ to: e.target.value || undefined })} className={select} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="group" aria-label="Done or open" className="flex flex-wrap gap-1.5">
            {DONE_CHOICES.map((c) => (
              <button key={c.label} type="button" aria-pressed={filters.done === c.value} onClick={() => update({ done: c.value })} className={chip(filters.done === c.value)}>
                {c.label}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-2 text-sm text-ink">
            <Toggle on={filters.person === 'me'} onChange={() => update({ person: filters.person === 'me' ? undefined : 'me' })} label="Only mine" />
            <span aria-hidden="true">Only mine</span>
          </span>
          <span className="flex items-center gap-2 text-sm text-ink">
            <Toggle on={Boolean(filters.archived)} onChange={toggleArchived} label="Include archived projects" />
            <span aria-hidden="true">Include archived projects</span>
          </span>
          {hasEverythingFilters(filters) ? (
            <Button variant="secondary" size="sm" onClick={() => update({ type: undefined, projectId: undefined, status: undefined, person: undefined, from: undefined, to: undefined, done: undefined, archived: undefined })}>
              Clear filters
            </Button>
          ) : null}
        </div>
        {/* 1.23.6: the words and filters under a name (the side menu shows the pinned ones). */}
        {searching ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <SaveSearch filters={filters} suggested={understood?.chips.length ? [...understood.chips.map((c) => c.label), ...(understood.words ? [understood.words] : [])].join(' · ') : words || 'My search'} />
          </div>
        ) : null}
      </div>

      <SavedSearchesPanel filters={filters} searching={searching} />

      {words.length >= MIN_LETTERS ? <AiPanel filters={filters} asked={Boolean(filters.ai)} onAsk={() => update({ ai: true })} onOpen={open} timeZone={timeZone} /> : null}

      {/* 1.23.1: the server couldn't search the tasks this time; what else it found is below. */}
      {searching && results.isSuccess && results.data.pages.some((p) => p.tasksUnavailable) ? <TasksUnavailable className="mb-2" onRetry={() => void results.refetch()} /> : null}
      {!searching ? (
        <p className="text-sm text-ink-2">Type 2 or more letters to search everything you can open — or write what you need, like “overdue tasks assigned to me”.</p>
      ) : results.isLoading || (hits.length === 0 && (hasNextPage || isFetchingNextPage)) ? (
        <div className="flex flex-col gap-2" aria-label="Searching…">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-lg" />
          ))}
        </div>
      ) : results.isError && hits.length === 0 ? (
        <LoadError what="the search results" onRetry={() => void results.refetch()} />
      ) : hits.length === 0 ? (
        <EmptyState
          title={words ? `Nothing matches “${words}”.` : 'Nothing matches these filters.'}
          description={understood?.chips.length ? 'Remove a filter above, or search the words instead.' : hasEverythingFilters(filters) ? 'Try fewer words, or clear the filters.' : 'Try fewer words, or part of a word.'}
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-2" aria-live="polite">
            {countText(first?.total ?? hits.length, first?.totalCapped ?? false)}
            {corrected.length ? (
              <span className="block text-xs text-ink-3">
                Also showing close matches:{' '}
                {corrected.map((c, i) => (
                  <span key={c.from} dir="auto">
                    {i ? ', ' : ''}“{c.to}” for “{c.from}”
                  </span>
                ))}
                .
              </span>
            ) : null}
          </p>
          <ul className="flex flex-col gap-2 compact:gap-1">
            {hits.map((h) => (
              <li key={`${h.kind}:${h.id}`}>
                <ResultRow hit={h} timeZone={timeZone} onOpen={open} />
              </li>
            ))}
          </ul>
          {results.hasNextPage ? (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
                {results.isFetchingNextPage ? 'Loading more…' : 'Show more'}
              </Button>
            </div>
          ) : null}
          {results.isError ? <LoadError className="mt-3" what="more results" onRetry={() => void results.fetchNextPage()} /> : null}
        </>
      )}
    </div>
  );
}
