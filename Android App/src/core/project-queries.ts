import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { owned } from './queries';
import { useDebouncedValue } from './useDebounced';
import { PROJECTS_OVERVIEW_COPY } from '../lib/offline-copy';
import { PROJECTS_OVERVIEW_KEY } from '../lib/refresh';
import { codeProblem } from '../lib/project-identity';
import { saveProject, type ProjectSaveApi, type SaveOutcome } from '../lib/project-form';
import { changeProjectStatus, type StatusChangeOutcome } from '../lib/project-status';
import type { ApiMember, ApiProject, ProjectOverview } from '../lib/types';

/**
 * Projects and their dashboard (5b): the Projects page's overview list, the project form's code
 * check and save, status and owner changes, the team's changes and the Dashboard's all-projects totals.
 * Every change needs a connection, as on the website (nothing is kept for later); the reads go
 * through the offline copy.
 */

const membersKey = (projectId: string) => ['project', projectId, 'members'];
const detailsKey = (projectId: string) => ['project', projectId, 'details'];

/**
 * The Projects page's list (GET /projects/overview): every project you can see with its card's
 * figures — open, overdue (the server's, never a task waiting for approval), next due, progress,
 * team, owner — from ONE request, as the website's page reads it. Through the offline copy.
 */
export function useProjectsOverview() {
  const { resources, reads } = useServices();
  return useQuery<ProjectOverview[]>({
    queryKey: PROJECTS_OVERVIEW_KEY,
    queryFn: ({ queryKey }) => reads.read(queryKey, PROJECTS_OVERVIEW_COPY, () => resources.projects.overview()),
    // Fresh for a minute; a task or project change marks it out of date at once (lib/refresh, the status change).
    staleTime: 60_000,
  });
}

/** After a project changed: its details, the list, and anything showing it. */
function useProjectRefresh() {
  const qc = useQueryClient();
  return useCallback(
    (project: ApiProject) => {
      qc.setQueryData(detailsKey(project.id), project);
      qc.setQueryData<ApiProject[]>(['projects'], (list) => list?.map((p) => (p.id === project.id ? { ...p, ...project } : p)));
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: detailsKey(project.id) });
    },
    [qc],
  );
}

/** Is the code typed for a new project free? Asked once the typing pauses, and only for a well-formed code. */
export function useCodeCheck(code: string, enabled: boolean) {
  const { resources } = useServices();
  const settled = useDebouncedValue(code, 350);
  return useQuery({
    queryKey: ['project-code-check', settled],
    queryFn: () => resources.projects.checkCode(settled),
    enabled: enabled && !!settled && !codeProblem(settled),
    staleTime: 10_000,
    retry: false,
  });
}

/** Save the project form (create or edit, then the picture), as the website does. */
export function useSaveProject() {
  const { resources } = useServices();
  const refreshed = useProjectRefresh();
  return useCallback(
    async (o: Parameters<typeof saveProject>[1], over?: Pick<ProjectSaveApi, 'create'>): Promise<SaveOutcome> => {
      const out = await saveProject(
        {
          // A new project from a template is created through the template's endpoint (Stage 4).
          create: over?.create ?? ((input, key) => resources.projects.create(input, key)),
          update: (id, patch) => resources.projects.update(id, patch),
          uploadImage: (id, part) => resources.projects.uploadImage(id, part),
          removeImage: (id) => resources.projects.removeImage(id),
          // After a lost answer: the project that now has the code (5b review).
          findByCode: async (code) => (await resources.projects.list()).find((p) => p.code === code) ?? null,
        },
        o,
      );
      if (out.kind === 'done' || out.kind === 'partly') refreshed(out.project);
      return out;
    },
    [resources, refreshed],
  );
}

/**
 * A status change from the Projects page, for whoever may change the project (changeProjectStatus):
 * shown at once, sent as the signed-in person (Archived through the archive action), put back with
 * the reason when it didn't go through; the list is read again either way. Online only.
 */
export function useProjectStatus(): (project: Pick<ProjectOverview, 'id' | 'name'>, status: string) => Promise<StatusChangeOutcome> {
  const services = useServices();
  const qc = useQueryClient();
  return useCallback(
    (project, status) => {
      const projects = owned(services).resources.projects;
      return changeProjectStatus(qc, { update: (id, s) => projects.update(id, { status: s }), archive: (id) => projects.archive(id) }, project, status);
    },
    [services, qc],
  );
}

/** An administrator's change of owner, from the project's Overview. */
export function useProjectOwner(projectId: string) {
  const { resources } = useServices();
  const refreshed = useProjectRefresh();
  return useMutation({ mutationFn: (ownerId: string | null) => resources.projects.update(projectId, { ownerId }), onSuccess: refreshed });
}

/**
 * The team's changes (administrators and the project's managers): the team as the server now has
 * it shows at once; the project's tasks are read again (someone taken off is taken off its tasks).
 */
export function useTeamChanges(projectId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  const settled = (list?: ApiMember[]) => {
    if (list) qc.setQueryData(membersKey(projectId), list);
    void qc.invalidateQueries({ queryKey: membersKey(projectId) });
  };
  const add = useMutation({ mutationFn: (userId: string) => resources.projects.addMembers(projectId, [userId]), onSuccess: (list) => settled(list) });
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'MEMBER' | 'MANAGER' }) => resources.projects.setMemberRole(projectId, userId, role),
    onSuccess: (list) => settled(list),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => resources.projects.removeMember(projectId, userId),
    onSuccess: (_r, userId) => {
      qc.setQueryData<ApiMember[]>(membersKey(projectId), (list) => list?.filter((m) => m.id !== userId));
      settled();
      void qc.invalidateQueries({ queryKey: ['tasks', 'project', projectId] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  return { add, setRole, remove };
}

/** Home for administrators: every project's totals and the tasks by status (through the offline copy). */
export function useAdminTotals(enabled: boolean) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['dashboard', 'admin-totals'],
    queryFn: ({ queryKey }) =>
      reads.read(queryKey, 'dashboard.admin-totals', async () => {
        const [projects, status] = await Promise.all([resources.reports.projects(), resources.reports.status()]);
        return { projects, status };
      }),
    enabled,
  });
}
