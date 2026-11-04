import { Suspense, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useOutletContext, useParams } from 'react-router-dom';
import type { PortalModules, PortalProjectView } from '../../api/portal';
import { isNotShared } from '../../api/portal';
import { ProjectAvatar } from '../../components/ProjectAvatar';
import { usePortalProject } from '../../components/portal/portal-queries';
import { BackLink, CompanyMark, LoadFailed, Loading, NotShared, StatusBadge, TOUCH } from '../../components/portal/portal-ui';
import { dateTimeText } from '../../lib/day-words';
import { usePageName } from '../../lib/page-meta';

/** What a project page hands its tabs and pages. */
export interface PortalProjectContext {
  projectId: string;
  view: PortalProjectView;
}

export const usePortalProjectContext = () => useOutletContext<PortalProjectContext>();

type Tab = keyof PortalModules;
const TABS: { module: Tab; path: string; label: string; also: string }[] = [
  { module: 'progress', path: 'progress', label: 'Progress & tasks', also: 'tasks' },
  { module: 'meetings', path: 'meetings', label: 'Meetings & minutes', also: 'meetings' },
];

/** The tab a module that isn't granted falls back to (the first granted one), or null when none is. */
export function firstTab(modules: PortalModules): Tab | null {
  return TABS.find((t) => modules[t.module])?.module ?? null;
}

/**
 * 1.23 One shared project in the Client portal: its header, and a tab for each granted module only
 * ("Progress & tasks", "Meetings & minutes"); its tabs and its task and meeting pages open below.
 * The server answers 404 for a project that isn't shared with this client (or not any more).
 */
export function PortalProjectLayout() {
  const { projectId = '' } = useParams();
  const q = usePortalProject(projectId);
  const { pathname } = useLocation();
  usePageName(q.data?.project.name ?? null);

  if (q.isPending) return <Loading what="the project" />;
  if (q.isError) return isNotShared(q.error) ? <NotShared /> : <LoadFailed what="the project" onRetry={() => void q.refetch()} />;

  const view = q.data;
  const { project } = view;
  const base = `/portal/projects/${encodeURIComponent(projectId)}`;
  const details = [project.code, project.number ? `Project no. ${project.number}` : null, project.clientName].filter(Boolean) as string[];
  const tabs = TABS.filter((t) => view.modules[t.module]);
  const [, section = '', item = ''] = pathname.slice(base.length).split('/');
  // On a task or meeting page the header is one compact line, so the item itself is on a phone's first screen.
  const compact = Boolean(item);

  return (
    <div className="flex flex-col gap-5">
      <BackLink to="/portal">Your projects</BackLink>
      <header className="rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-6">
        {compact ? (
          <div className="flex min-w-0 items-center gap-3">
            <ProjectAvatar project={project} size="md" />
            <div className="min-w-0 flex-1">
              <h1 dir="auto" className="truncate font-display text-lg font-bold text-ink" title={project.name}>{project.name}</h1>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                <span dir="auto">{project.code}</span>
                {project.company ? (
                  <span className="min-w-0 truncate">
                    <span aria-hidden="true" className="me-2">·</span>
                    <bdi>{project.company.name}</bdi>
                  </span>
                ) : null}
              </p>
            </div>
            <StatusBadge label={project.statusLabel} />
          </div>
        ) : (
          <>
        {project.company ? (
          <div className="mb-4 flex min-w-0 items-center gap-2 border-b border-line pb-3">
            <CompanyMark company={project.company} className="h-8" />
            <span className="min-w-0 truncate text-xs font-semibold text-ink-2"><bdi>{project.company.name}</bdi></span>
          </div>
        ) : null}
        <div className="flex min-w-0 items-start gap-4">
          <ProjectAvatar project={project} size="xl" className="shadow-soft max-sm:h-14 max-sm:w-14" />
          <div className="min-w-0 flex-1">
            <h1 dir="auto" className="break-words font-display text-2xl font-bold text-ink sm:text-3xl">{project.name}</h1>
            {details.length ? (
              <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-ink-2">
                {details.map((d, i) => (
                  <span key={i} dir="auto">
                    {i > 0 ? <span aria-hidden="true" className="me-2">·</span> : null}
                    {d}
                  </span>
                ))}
              </p>
            ) : null}
            <div className="mt-2">
              <StatusBadge label={project.statusLabel} />
            </div>
            <p className="mt-2 text-xs text-ink-2">
              Updated <time dateTime={view.generatedAt}>{dateTimeText(view.generatedAt, view.timeZone)}</time>
            </p>
          </div>
        </div>
          </>
        )}
        {tabs.length ? (
          <nav aria-label="Project sections" className={`flex gap-1 overflow-x-auto border-t border-line ${compact ? 'mt-3 pt-2' : 'mt-4 pt-3'}`}>
            {tabs.map((t) => {
              const active = section === t.path || section === t.also;
              return (
                <Link
                  key={t.module}
                  to={`${base}/${t.path}`}
                  aria-current={active ? 'page' : undefined}
                  className={`${TOUCH} inline-flex flex-none items-center rounded-xl px-4 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40 ${
                    active ? 'bg-brand/10 text-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </header>
      {/* The project's header stays while a tab's page loads. */}
      <Suspense fallback={<Loading what="the page" />}>
        <Outlet context={{ projectId, view } satisfies PortalProjectContext} />
      </Suspense>
    </div>
  );
}

/** The project's address on its own: its first granted tab. */
export function PortalProjectIndex() {
  const { view, projectId } = usePortalProjectContext();
  const tab = firstTab(view.modules);
  return tab ? <Navigate to={`/portal/projects/${encodeURIComponent(projectId)}/${tab}`} replace /> : <NotShared />;
}

/** A tab (or page) of a module this client isn't given: their first granted tab instead. */
export function NeedsModule({ module, children }: { module: Tab; children: ReactNode }) {
  const { view, projectId } = usePortalProjectContext();
  if (view.modules[module]) return <>{children}</>;
  const tab = firstTab(view.modules);
  return tab ? <Navigate to={`/portal/projects/${encodeURIComponent(projectId)}/${tab}`} replace /> : <NotShared />;
}
