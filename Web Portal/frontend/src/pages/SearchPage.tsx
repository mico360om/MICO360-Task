import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useOpenTask } from '../lib/useOpenTask';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { taskSearchApi, type TaskSearchParams } from '../api/search';
import { projectsApi } from '../api/projects';
import { usersApi } from '../api/users';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadError } from '../components/ui/LoadError';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { fieldClass } from '../components/ui/Field';
import { Highlighted } from '../components/ui/Highlighted';
import { MAX_QUERY_LETTERS, resultsQuery, type ResultsFilters, type TaskSearchHit } from '../lib/search-highlight';
import { STATUS_META, STATUS_ORDER } from '../lib/taskStatus';
import { formatDueDay } from '../lib/due-display';
import { isOverdue } from '../lib/due-date';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useAuthStore } from '../stores/auth-store';
import { isProjectArchived } from '../lib/project-archive';
import { FoundTaskKey } from '../components/TaskKey';

/** Words of at least this length are searched (as in the top-bar search). */
const MIN_LETTERS = 2;

/** The filters as the address keeps them (q, project, status, assignee, done, archived). */
function filtersFrom(params: URLSearchParams): ResultsFilters {
  const done = params.get('done');
  return {
    q: params.get('q') ?? '',
    ...(params.get('project') ? { projectId: params.get('project')! } : {}),
    ...(params.get('status') && STATUS_META[params.get('status')!] ? { status: params.get('status')! } : {}),
    ...(params.get('assignee') ? { assigneeId: params.get('assignee')! } : {}),
    ...(done === 'true' || done === 'false' ? { done: done === 'true' } : {}),
    ...(params.get('archived') === 'true' ? { archived: true } : {}),
  };
}

const hasFilters = (f: ResultsFilters) => Boolean(f.projectId || f.status || f.assigneeId || f.done !== undefined || f.archived);

/** "Bilal Ahmed +2", or "Unassigned". */
function assigneeSummary(t: TaskSearchHit): string {
  const first = t.assignees?.[0];
  if (!first) return 'Unassigned';
  const more = (t.assigneeCount ?? t.assignees!.length) - 1;
  return more > 0 ? `${first.name} +${more}` : first.name;
}

const DONE_CHOICES: { label: string; value: boolean | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Open', value: false },
  { label: 'Done', value: true },
];

/**
 * Search results: every task the person can open that holds all the words — in its title, key,
 * description, comments, checklist, people, external contacts, tags or file names — a page at a
 * time, with where each matched and the words marked. The words and the filters (project, status,
 * assignee, done or open, archived projects) live in the address, so the page can be shared and
 * the browser's Back returns to it. A result opens in the task panel.
 */
export function SearchPage({ debounceMs = 300 }: { debounceMs?: number }) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const timeZone = useCompanyTimeZone();
  const myId = useAuthStore((s) => s.user?.id);

  /** Change the filters in the address (the task panel's `task` stays). */
  const update = (patch: Partial<ResultsFilters>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(resultsQuery({ ...filtersFrom(prev), ...patch }));
        const task = prev.get('task');
        if (task) next.set('task', task);
        return next;
      },
      { replace: true },
    );

  // The box: what is typed reaches the address (and the search) once typing pauses — trimmed, as the
  // address keeps it, while the box keeps what was typed (a space before the next word). Words put in
  // the address from elsewhere (the top-bar search's "See all results") replace what the box shows.
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
      update({ q: typed });
    }, debounceMs);
    return () => clearTimeout(t);
    // `update` reads the address when it runs, so it is not a dependency.
  }, [term, debounceMs]);

  const words = filters.q.trim();
  const searching = words.length >= MIN_LETTERS;
  const ask: Omit<TaskSearchParams, 'cursor'> = { q: words, projectId: filters.projectId, status: filters.status, assigneeId: filters.assigneeId, done: filters.done, archived: filters.archived };
  const results = useInfiniteQuery({
    queryKey: ['search-tasks', ask],
    queryFn: ({ pageParam }) => taskSearchApi(apiClient).search({ ...ask, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: searching,
  });
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi(apiClient).list() });
  const peopleQ = useQuery({ queryKey: ['directory'], queryFn: () => usersApi(apiClient).directory() });

  const hits = useMemo(() => {
    const seen = new Set<string>();
    return (results.data?.pages ?? []).flatMap((p) => p.data).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }, [results.data]);
  // A page whose tasks all changed since they were indexed comes back empty: ask for the next one.
  const lastPage = results.data?.pages[results.data.pages.length - 1];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results;
  useEffect(() => {
    if (lastPage && lastPage.data.length === 0 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [lastPage, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const first = results.data?.pages[0];
  const count = first ? (first.totalCapped ? '1000+ tasks' : `${first.total ?? hits.length} ${(first.total ?? hits.length) === 1 ? 'task' : 'tasks'}`) : null;

  const projects = (Array.isArray(projectsQ.data) ? projectsQ.data : [])
    .filter((p) => filters.archived || !isProjectArchived(p) || p.id === filters.projectId)
    // Archived projects (or all their companies archived) after the others.
    .sort((a, b) => Number(isProjectArchived(a)) - Number(isProjectArchived(b)) || a.name.localeCompare(b.name, 'en'));
  const people = (Array.isArray(peopleQ.data) ? peopleQ.data : [])
    .filter((u) => u.id !== myId && (u.active !== false || u.id === filters.assigneeId))
    .map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  // In the app's task panel (?task=), with the results shown so far as its list for Previous / Next.
  const showTask = useOpenTask();
  const openTask = (id: string) => showTask(id, hits.map((h) => h.id));

  const toggleArchived = () => {
    const on = !filters.archived;
    // Turned off: an archived project chosen before is no longer one of the choices.
    const chosen = projectsQ.data?.find?.((p) => p.id === filters.projectId);
    update({ archived: on || undefined, ...(!on && chosen && isProjectArchived(chosen) ? { projectId: undefined } : {}) });
  };

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors [@media(pointer:coarse)]:!min-h-11 ${active ? 'bg-brand text-white shadow-brand' : 'border border-line text-ink-2 hover:bg-ground'}`;
  const select = fieldClass(false, 'w-full py-1.5');

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Workspace" title="Search results" subtitle="Every task you can open that holds all the words — in its title, description, comments, checklist, people, external contacts, tags or files." />

      <div className="card mb-4 flex flex-col gap-3 p-3">
        <div>
          <input
            type="search"
            role="searchbox"
            aria-label="Search tasks"
            aria-describedby="search-tips"
            dir="auto"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Words to find in tasks…"
            maxLength={MAX_QUERY_LETTERS}
            className={fieldClass(false, 'w-full')}
          />
          <p id="search-tips" className="mt-1 text-xs text-ink-3">
            A task must hold every word, anywhere in it; part of a word is enough. Put a phrase in quotes (“hot work”) to find it as written.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
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
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Status
            <select value={filters.status ?? ''} onChange={(e) => update({ status: e.target.value || undefined })} className={select}>
              <option value="">Any status</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s]!.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
            Assignee
            <select value={filters.assigneeId ?? ''} onChange={(e) => update({ assigneeId: e.target.value || undefined })} className={select}>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div role="group" aria-label="Done or open" className="flex flex-wrap gap-1.5">
            {DONE_CHOICES.map((c) => (
              <button key={c.label} type="button" aria-pressed={filters.done === c.value} onClick={() => update({ done: c.value })} className={chip(filters.done === c.value)}>
                {c.label}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-2 text-sm text-ink">
            <Toggle on={Boolean(filters.archived)} onChange={toggleArchived} label="Include archived projects" />
            <span aria-hidden="true">Include archived projects</span>
          </span>
          {hasFilters(filters) ? (
            <Button variant="secondary" size="sm" onClick={() => update({ projectId: undefined, status: undefined, assigneeId: undefined, done: undefined, archived: undefined })}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      {!searching ? (
        <p className="text-sm text-ink-2">Type 2 or more letters to search every task you can open.</p>
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
          title={`No tasks match “${words}”.`}
          description={hasFilters(filters) ? 'Try fewer words, or clear the filters.' : 'Try fewer words, or part of a word.'}
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-2" aria-live="polite">
            {count}
          </p>
          <ul className="flex flex-col gap-2">
            {hits.map((t) => {
              const status = t.status ? STATUS_META[t.status.category] : undefined;
              const late = !t.done && t.dueDate ? isOverdue(t.dueDate, timeZone) : false;
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => openTask(t.id)} className="flex w-full flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-start transition-colors hover:bg-ground focus-visible:bg-ground [@media(pointer:coarse)]:!min-h-11">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <FoundTaskKey value={t.key} former={t.formerKeys} />
                      <span dir="auto" className={`min-w-0 text-sm font-semibold [overflow-wrap:anywhere] ${t.done ? 'text-ink-2' : 'text-ink'}`}>
                        <Highlighted text={t.title} ranges={t.titleRanges} />
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-2">
                      {t.project ? <span dir="auto">{t.project.archived ? `${t.project.name} (archived)` : t.project.name}</span> : null}
                      {t.status ? (
                        <span className="inline-flex items-center gap-1">
                          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: status?.color }} />
                          <span dir="auto">{t.status.name}</span>
                        </span>
                      ) : null}
                      {t.dueDate ? <span className={late ? 'text-danger' : undefined}>Due {formatDueDay(t.dueDate, timeZone)}</span> : null}
                      <span dir="auto">{assigneeSummary(t)}</span>
                    </span>
                    {(t.matches ?? []).map((m, i) => (
                      <span key={i} dir="auto" className="block text-xs text-ink-3 [overflow-wrap:anywhere]">
                        <span className="font-medium text-ink-2">{m.label}: </span>
                        <Highlighted text={m.snippet} ranges={m.ranges} />
                      </span>
                    ))}
                  </button>
                </li>
              );
            })}
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
