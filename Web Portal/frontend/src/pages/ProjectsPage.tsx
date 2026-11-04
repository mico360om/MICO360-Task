import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROJECTS_OVERVIEW_KEY, projectsApi, type ApiProject, type ProjectOverview, type ProjectStatus } from '../api/projects';
import { apiClient } from '../api/client';
import { ProjectCard } from '../components/projects/ProjectCard';
import { ProjectFormDialog } from '../components/project-form/ProjectFormDialog';
import { PageTitle } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { LoadError } from '../components/ui/LoadError';
import { useShortcut } from '../components/shortcuts/ShortcutProvider';
import { useAuthStore } from '../stores/auth-store';
import { useCompanyTimeZone } from '../lib/useCompanyTimeZone';
import { useNow } from '../lib/useNow';
import { todayKey } from '../lib/due-date';
import {
  DEFAULT_LIST_STATE,
  PROJECT_SORTS,
  STATUS_TABS,
  countLine,
  filterProjects,
  headerSummary,
  inTab,
  ownerOptions,
  sortProjects,
  tabCounts,
  type ProjectSort,
  type StatusTab,
} from '../lib/project-list';
import { useProjectListState } from '../lib/useProjectListState';
import { useNewFromAddress } from '../lib/useNewFromAddress';
import { revealInRow, useScrollRow } from '../lib/scroll-row';
import { useMyProjectsOnly, useSetMyProjectsOnly } from '../lib/useMyProjectsOnly';
import { MY_PROJECTS_WORDS } from '../components/settings/MyProjectsSettings';
import { MyProjectsLine } from '../components/projects/MyProjectsLine';

/** The list as the server scopes it — and, for an administrator's untick for this visit, every project. */
const OVERVIEW_KEY = PROJECTS_OVERVIEW_KEY;

const FOLDER_ICON = (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v5M9.5 13.5h5" />
  </svg>
);
const PANEL_ID = 'projects-panel';
const tabId = (t: StatusTab) => `projects-tab-${t}`;

/** What an empty tab says when nothing is filtered. */
const EMPTY_TAB: Record<StatusTab, string> = {
  all: 'No open projects',
  active: 'No active projects',
  planning: 'No projects in planning',
  'on-hold': 'No projects on hold',
  completed: 'No completed projects',
  archived: 'No archived projects',
};

/** Owner and Sort: side by side at half width on a phone, their own width on a larger screen. */
const SELECT_BOX =
  'flex h-10 min-w-0 flex-[1_1_9rem] [@media(pointer:coarse)]:h-11 items-center gap-1.5 rounded-xl border border-line bg-surface ps-3 text-sm transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 sm:flex-none';
const SELECT = 'h-full min-w-0 cursor-pointer rounded-xl bg-transparent pe-2 text-sm font-medium text-ink outline-none';

/**
 * Projects: find a project fast, see how each is doing, and manage them. Status tabs with counts,
 * one search box, owner and sort (all kept in the address, so Back and shared links work), and a
 * compact card per project with its figures — the whole list from one request. Anyone may create a
 * project; a card offers its status menu, Edit and Archive to those who may change it (an admin,
 * or its owner, named manager or a manager on its team — the server says which).
 */
export function ProjectsPage() {
  const qc = useQueryClient();
  const admin = useAuthStore((s) => s.isAdmin());
  const timeZone = useCompanyTimeZone();
  const now = useNow();
  const today = todayKey(timeZone, now);
  const [state, update] = useProjectListState();
  // The project form: null = closed, 'new' = create, a project = edit it (loaded in full first).
  const [form, setForm] = useState<'new' | ApiProject | null>(null);
  const [archiving, setArchiving] = useState<ProjectOverview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Set when a card is about to leave the current tab, so focus can land on the list instead of nowhere.
  const refocusList = useRef(false);
  useShortcut('new', () => setForm('new'));
  // /projects?new=1 (e.g. "New project" where there is no project yet) opens the form on arrival.
  useNewFromAddress(() => setForm('new'));

  // 1.22.1 (owner, 4 Nov): an administrator's "Only my projects" IS their "Show my projects only"
  // (Settings): ticking or unticking it saves it on the server — every device, session and page — and
  // the server then lists only their own projects. Everyone else only sees theirs anyway.
  const myOnly = useMyProjectsOnly();
  const saveMyOnly = useSetMyProjectsOnly();
  const mineTicked = saveMyOnly.isPending ? saveMyOnly.variables === true : myOnly;
  // Companies: a project whose companies are all archived comes as ARCHIVED (the server says so).
  const query = useQuery({ queryKey: OVERVIEW_KEY, queryFn: () => projectsApi(apiClient).overview() });
  const all = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  const owners = useMemo(() => ownerOptions(all), [all]);
  // An owner (from a shared link) who owns none of the projects this person can see is ignored.
  const unknownOwner = query.isSuccess && state.owner !== '' && !owners.some((o) => o.id === state.owner);
  const owner = unknownOwner ? '' : state.owner;
  const { q } = state;
  const filtered = useMemo(() => filterProjects(all, { ...DEFAULT_LIST_STATE, q, owner }), [all, q, owner]);
  const counts = tabCounts(filtered);
  const visible = sortProjects(filtered.filter((p) => inTab(p, state.status)), state.sort, today, timeZone);
  // The order as shown, handed on to the project opened (its Previous / Next project, 1.22).
  const order = visible.map((p) => p.id);
  const filtersOn = Boolean(q.trim() || owner);

  // …and taken out of the address, in place.
  useEffect(() => {
    if (unknownOwner) update({ owner: '' }, { replace: true });
  }, [unknownOwner]);

  useEffect(() => {
    if (!refocusList.current) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      refocusList.current = false;
      panelRef.current?.focus();
    }
  });

  const invalidate = (id: string) => {
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['project', id] });
  };
  /** Show a new status at once; the card may leave this tab. */
  const setStatusLocally = (id: string, status: ProjectStatus) => {
    if (!inTab({ status }, state.status)) refocusList.current = true;
    qc.setQueryData<ProjectOverview[]>(OVERVIEW_KEY, (list) => list?.map((p) => (p.id === id ? { ...p, status } : p)));
  };

  const statusMut = useMutation({
    mutationFn: ({ project, status }: { project: ProjectOverview; status: ProjectStatus }) => projectsApi(apiClient).update(project.id, { status }),
    onMutate: async ({ project, status }) => {
      setProblem(null);
      await qc.cancelQueries({ queryKey: OVERVIEW_KEY });
      const before = qc.getQueryData<ProjectOverview[]>(OVERVIEW_KEY);
      setStatusLocally(project.id, status);
      return { before };
    },
    onError: (_err, { project }, ctx) => {
      if (ctx?.before) qc.setQueryData(OVERVIEW_KEY, ctx.before);
      setProblem(`Couldn’t change the status of ${project.name}. Try again.`);
    },
    onSettled: (_d, _e, { project }) => invalidate(project.id),
  });

  // Archiving is the first-class archive action (audited), always asked first.
  const archiveMut = useMutation({
    mutationFn: (project: ProjectOverview) => projectsApi(apiClient).archive(project.id),
    onSuccess: (_d, project) => {
      setStatusLocally(project.id, 'ARCHIVED');
      setArchiving(null);
      invalidate(project.id);
    },
  });

  /** The list carries only what the cards show, so Edit loads the whole project first. */
  async function openEdit(project: ProjectOverview) {
    setProblem(null);
    try {
      setForm(await qc.fetchQuery({ queryKey: ['project', project.id], queryFn: () => projectsApi(apiClient).get(project.id), staleTime: 0 }));
    } catch {
      setProblem(`Couldn’t open ${project.name} for editing. Try again.`);
    }
  }

  const changeStatus = (project: ProjectOverview, status: ProjectStatus) => {
    if (status === 'ARCHIVED') {
      archiveMut.reset();
      setArchiving(project);
    } else statusMut.mutate({ project, status });
  };

  // On a phone the tabs are one row that scrolls sideways: the chosen one is kept in view — again
  // once the list has loaded, as the counts it brings widen the tabs.
  const tabRow = useScrollRow<HTMLDivElement>();
  const countsShown = query.isSuccess;
  useEffect(() => {
    const chosen = document.getElementById(tabId(state.status));
    if (tabRow.el && chosen) revealInRow(tabRow.el, chosen);
  }, [state.status, tabRow.el, countsShown]);

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const at = STATUS_TABS.findIndex((t) => t.value === state.status);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: STATUS_TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = STATUS_TABS[(to + STATUS_TABS.length) % STATUS_TABS.length]!.value;
    update({ status: next });
    document.getElementById(tabId(next))?.focus();
  }

  function clearFilters() {
    update({ q: '', owner: '', mine: false });
    searchRef.current?.focus();
  }

  const loading = query.isLoading;
  const summary = loading || query.isError || all.length === 0 ? null : headerSummary(all, today, timeZone);
  // No project at all yet: the tabs, search and filters have nothing to work on, so only the invitation
  // shows. (An administrator who sees only their own may have none of their own: not a first run.)
  const firstRun = query.isSuccess && all.length === 0 && !myOnly;
  // One or two projects in a wide grid: a tile to start another sits beside them, so they don't look lost.
  const offerAnother = !filtersOn && visible.length > 0 && visible.length <= 2 && (state.status === 'all' || state.status === 'active' || state.status === 'planning');

  return (
    <div>
      <div className="relative z-20 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 animate-fade-in-up">
        <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <PageTitle eyebrow="Workspace" title="Projects" />
          {summary ? <p className="text-sm text-ink-2">{summary}</p> : loading ? <span className="skeleton inline-block h-4 w-40 self-center" aria-hidden="true" /> : null}
        </div>
        <Button onClick={() => setForm('new')} title="New project" shortcut="new" className="[@media(pointer:coarse)]:!min-h-11">
          + New project
        </Button>
      </div>

      {firstRun ? (
        <EmptyState
          icon={FOLDER_ICON}
          title="No projects yet"
          description={
            admin
              ? 'A project holds one piece of work — a contract, a client job or an in-house task list — with its board, people, meetings and inspections. Create the first one to get started.'
              : 'Projects you’re part of will appear here — or create one with “New project”.'
          }
          action={<Button onClick={() => setForm('new')} className="[@media(pointer:coarse)]:!min-h-11">+ New project</Button>}
        />
      ) : (
      <>
      {/* Status at a glance — also the main filter. Below 768px one row that scrolls sideways (three
          rows of tabs came before the first card), with a fade where more tabs are hidden. */}
      <div
        ref={tabRow.ref}
        data-more={tabRow.more}
        role="tablist"
        aria-label="Project status"
        onKeyDown={onTabKey}
        className="scroll-row relative mb-3 flex gap-2 overflow-x-auto max-md:-mx-1 max-md:-mt-1 max-md:mb-2 max-md:p-1 md:flex-wrap md:overflow-visible"
      >
        {STATUS_TABS.map((t) => {
          const selected = t.value === state.status;
          return (
            <button
              key={t.value}
              id={tabId(t.value)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => update({ status: t.value })}
              className={`inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors [@media(pointer:coarse)]:h-11 ${
                selected ? 'border-transparent bg-brand-gradient text-white shadow-sm' : 'border-line bg-surface text-ink-2 hover:border-brand/30 hover:text-ink'
              }`}
            >
              {t.label}{' '}
              <span className={`min-w-[1.5rem] rounded-full px-1.5 text-center text-xs tabular-nums ${selected ? 'bg-white/20 text-white' : 'bg-ground text-ink-2'}`}>
                {loading || query.isError ? '–' : counts[t.value]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-[1_1_18rem]">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-2">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </span>
          <input
            ref={searchRef}
            type="search"
            data-page-search
            aria-label="Search projects"
            dir="auto"
            value={state.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Search name, code, client or project number…"
            className="h-10 w-full rounded-xl border border-line bg-surface pe-3 ps-9 text-sm [@media(pointer:coarse)]:h-11 text-ink outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className={SELECT_BOX}>
          <label htmlFor="pl-owner" className="flex-none text-ink-2">Owner</label>
          <select id="pl-owner" value={owner} onChange={(e) => update({ owner: e.target.value })} className={`${SELECT} flex-1 sm:max-w-[12rem]`}>
            <option value="">Anyone</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className={SELECT_BOX}>
          <label htmlFor="pl-sort" className="flex-none text-ink-2">Sort</label>
          <select id="pl-sort" value={state.sort} onChange={(e) => update({ sort: e.target.value as ProjectSort })} className={`${SELECT} flex-1`}>
            {PROJECT_SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        {admin ? (
          <label className="flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap px-1 text-sm text-ink-2 hover:text-ink [@media(pointer:coarse)]:h-11">
            <input
              type="checkbox"
              checked={mineTicked}
              disabled={saveMyOnly.isPending}
              onChange={(e) => saveMyOnly.mutate(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--c-brand))]"
            />
            Only my projects
          </label>
        ) : null}
      </div>
      {saveMyOnly.isError ? <p role="alert" className="-mt-1 mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{MY_PROJECTS_WORDS.failed}</p> : null}
      {myOnly ? <MyProjectsLine className="-mt-1 mb-3" /> : null}

      {problem ? (
        <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>{problem}</span>
          <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss" className="shrink-0 rounded px-1 opacity-80 hover:opacity-100">✕</button>
        </div>
      ) : null}

      <div ref={panelRef} role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(state.status)} tabIndex={-1} className="outline-none">
        {/* Announced as the tab, search or filters change. */}
        <p role="status" data-testid="projects-count" className="mb-3 min-h-[1.25rem] text-sm text-ink-2">
          {loading || query.isError ? '' : countLine(visible.length, state.sort)}
        </p>

        {loading ? (
          <div className="grid project-grid gap-4" aria-busy="true" role="status" aria-label="Loading projects">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-4">
                <div className="flex gap-3">
                  <div className="skeleton h-11 w-11 flex-none rounded-xl" />
                  <div className="flex-1">
                    <div className="skeleton h-4 w-40 max-w-full" />
                    <div className="skeleton mt-2 h-3 w-28" />
                  </div>
                </div>
                <div className="skeleton mt-4 h-2 w-full rounded-full" />
                <div className="skeleton mt-4 h-12 w-full" />
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <LoadError what="projects" onRetry={() => void query.refetch()} />
        ) : visible.length > 0 ? (
          <div className="grid project-grid gap-4 animate-fade-in">
            {visible.map((p) => {
              const can = admin || p.canManage === true;
              return (
                <ProjectCard
                  key={p.id}
                  project={p}
                  today={today}
                  now={now}
                  timeZone={timeZone}
                  onChangeStatus={can ? changeStatus : undefined}
                  onEdit={can ? (project) => void openEdit(project) : undefined}
                  onArchive={can ? (project) => changeStatus(project, 'ARCHIVED') : undefined}
                  order={order}
                />
              );
            })}
            {offerAnother ? (
              <button
                type="button"
                onClick={() => setForm('new')}
                // Beside two cards it only fills a third column (a laptop and up); alone on a row of its own it would just be a hole.
                className={`group flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-center sm:min-h-[12rem] ${visible.length === 2 ? 'max-xl:hidden' : ''} transition-colors hover:border-brand/50 hover:bg-brand/5 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand/10 text-brand transition-transform group-hover:scale-105" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </span>
                <span className="font-semibold text-ink">Start another project</span>
                <span className="max-w-[16rem] text-sm text-ink-2">Keep each job, client or site in a project of its own.</span>
              </button>
            ) : null}
          </div>
        ) : filtersOn ? (
          <EmptyState
            title="No projects match"
            description="Try other words or another owner, or clear the filters to see every project."
            action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            title={EMPTY_TAB[state.status]}
            description={state.status === 'archived' ? 'Archived projects are kept here, out of the other lists.' : undefined}
          />
        )}
      </div>
      </>
      )}

      {form ? <ProjectFormDialog project={form === 'new' ? null : form} onClose={() => setForm(null)} /> : null}
      {archiving ? (
        <ConfirmDialog
          title={`Archive ${archiving.name}?`}
          confirmLabel="Archive"
          tone="primary"
          busy={archiveMut.isPending}
          error={archiveMut.isError ? 'Couldn’t archive the project. Try again.' : null}
          onConfirm={() => archiveMut.mutate(archiving)}
          onClose={() => setArchiving(null)}
        >
          It moves to the Archived tab, out of the other lists. Its tasks stay as they are, and you can change its status back at any time.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
