import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { readUserValue, writeUserValue } from '../lib/user-storage';
import { ALL_PROJECTS, boardProjects } from '../lib/board';
import { ProjectFilter } from '../components/board/ProjectFilter';
import { Board } from '../components/board/Board';
import { useCurrentProject } from '../components/CurrentProject';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { useAuthStore } from '../stores/auth-store';
import { projectOption } from '../components/project-option';
import { useProjectsWith } from '../lib/useProjectsWith';
import { projectReadOnly } from '../lib/project-archive';

// The board itself (1.22.3) is components/board/Board.tsx — the same one a project page's Board tab shows.
export { emptyDayText } from '../components/board/Board';

/** Per-user (see lib/user-storage) memory of the last project viewed on the board ('all': every project). */
const PROJECT_PREF = 'board.projectId';
/** Per-user memory of the projects left out of the All projects board (so a new project shows). */
const HIDDEN_PREF = 'board.hiddenProjects';

function readHidden(userId: string | undefined): Set<string> {
  try {
    const ids: unknown = JSON.parse(readUserValue(userId, HIDDEN_PREF) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

const ALL_OPTION = {
  value: ALL_PROJECTS,
  label: 'All projects',
  icon: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

/**
 * The Kanban Board page: a project's board — the one its link names (/board?project=<id>, e.g. "Open
 * board" on a project page), else the last one this person viewed, else the first — or All projects.
 * The page chooses the project (its picker, and the projects left out of All projects); the board is
 * components/board/Board.tsx.
 */
export function BoardPage() {
  const userId = useAuthStore((s) => s.user?.id);
  // A link like /board?project=<id> (e.g. "Open board" on a project page) wins; otherwise the
  // last project this user viewed (remembered per user), else the first.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlProjectId = searchParams.get('project') ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState(() => readUserValue(useAuthStore.getState().user?.id, PROJECT_PREF) ?? '');
  // 1.22: a board opened by its link shows its project even when an administrator's "Show my projects
  // only" leaves it off their list (opening by link stays admin-wide).
  const { projects, listQ: projectsQ, fetchingExtra: linking } = useProjectsWith(urlProjectId === ALL_PROJECTS ? null : urlProjectId);
  // One project at a time, or All projects (offered when there is more than one).
  const has = (id: string) => !!id && (id === ALL_PROJECTS ? projects.length > 1 : projects.some((p) => p.id === id));
  // (No other board flashes up while a linked project loads.)
  const projectId = linking ? undefined : has(urlProjectId) ? urlProjectId : has(selectedProjectId) ? selectedProjectId : projects[0]?.id;
  const isAll = projectId === ALL_PROJECTS;
  const project = isAll ? undefined : projects.find((p) => p.id === projectId);
  const shownProjects = useMemo(() => boardProjects(projects), [projects]);
  const [hiddenProjects, setHiddenProjects] = useState(() => readHidden(useAuthStore.getState().user?.id));
  const chooseHidden = (next: Set<string>) => {
    setHiddenProjects(next);
    writeUserValue(userId, HIDDEN_PREF, JSON.stringify([...next]));
  };
  // New task from the header starts in the board's project (on All projects, the one used last).
  useCurrentProject(isAll ? undefined : projectId);
  const urlProjectValid = has(urlProjectId);
  useEffect(() => {
    // Remember a project opened by link too, so returning to /board shows it again.
    if (projectId && urlProjectValid) writeUserValue(userId, PROJECT_PREF, projectId);
  }, [projectId, urlProjectValid, userId]);
  const chooseProject = (id: string) => {
    setSelectedProjectId(id);
    writeUserValue(userId, PROJECT_PREF, id);
    if (urlProjectId) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('project', id);
          return next;
        },
        { replace: true },
      );
    }
  };
  // Taken off the board's project: forget it (the board has said so and left the address).
  const forgetProject = useCallback(() => {
    setSelectedProjectId('');
    writeUserValue(userId, PROJECT_PREF, null);
  }, [userId]);

  return (
    <Board
      projectId={projectId}
      projects={projects}
      list={{ loading: projectsQ.isLoading, failed: projectsQ.isError, retry: () => void projectsQ.refetch() }}
      linking={linking}
      hiddenProjects={hiddenProjects}
      onRemoved={forgetProject}
      // 1.22.3 review: an archived or completed project chosen in the picker — the project page's rule.
      readOnly={project ? projectReadOnly(project) : null}
      // Owner, 10 Nov: the chosen project's basics above the columns (not on All projects).
      projectStrip
      header={(boardActions) => (
        <PageHeader
          eyebrow="Workspace"
          title="Kanban Board"
          // The chosen project is in the picker. A subtitle here would squeeze the title (a long project
          // name cut it to "Kanban …"); the All projects hint sits in the date row instead.
          subtitle={projectsQ.isSuccess && !projectId ? 'Drag tasks across columns to update their status.' : undefined}
          actions={
            projectsQ.isLoading ? (
              <span className="skeleton block h-10 w-72 max-w-full" aria-hidden="true" />
            ) : projectId ? (
              <>
                {projects.length > 1 ? (
                  <div className="w-52 xl:w-64" title={isAll ? ALL_OPTION.label : project?.name}>
                    <SearchableSelect
                      ariaLabel="Select project"
                      value={projectId}
                      onChange={(v) => chooseProject(v)}
                      options={[ALL_OPTION, ...projects.map(projectOption)]}
                    />
                  </div>
                ) : null}
                {isAll ? <ProjectFilter projects={shownProjects} hidden={hiddenProjects} onChange={chooseHidden} /> : null}
                {boardActions}
              </>
            ) : undefined
          }
        />
      )}
    />
  );
}
