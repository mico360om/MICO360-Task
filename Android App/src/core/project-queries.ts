import { useCallback } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { projectProgressQuery } from './queries';
import { useDebouncedValue } from './useDebounced';
import { codeProblem } from '../lib/project-identity';
import { saveProject, type PictureChoice, type ProjectDraft, type SaveOutcome } from '../lib/project-form';
import { statusChangeRequest } from '../lib/project-list';
import type { ApiMember, ApiProject, ApiProjectProgress } from '../lib/types';

/**
 * Projects and their dashboard (5b): the cards' progress, the project form's code check and save,
 * an administrator's status and owner changes, the team's changes and Home's all-projects totals.
 * Every change needs a connection, as on the website (nothing is kept for later); the reads go
 * through the offline copy.
 */

const membersKey = (projectId: string) => ['project', projectId, 'members'];
const detailsKey = (projectId: string) => ['project', projectId, 'details'];

/** Each listed project's progress (one small request each, kept offline), by project id. */
export function useProjectsProgress(projectIds: string[]): Record<string, ApiProjectProgress | undefined> {
  const services = useServices();
  const results = useQueries({ queries: projectIds.map((id) => projectProgressQuery(services, id)) });
  const out: Record<string, ApiProjectProgress | undefined> = {};
  projectIds.forEach((id, i) => {
    out[id] = results[i]?.data as ApiProjectProgress | undefined;
  });
  return out;
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
    async (o: { saved: ApiProject | null; initial: ProjectDraft; draft: ProjectDraft; picture: PictureChoice; idempotencyKey: string }): Promise<SaveOutcome> => {
      const out = await saveProject(
        {
          create: (input, key) => resources.projects.create(input, key),
          update: (id, patch) => resources.projects.update(id, patch),
          uploadImage: (id, part) => resources.projects.uploadImage(id, part),
          removeImage: (id) => resources.projects.removeImage(id),
        },
        o,
      );
      if (out.kind === 'done' || out.kind === 'partly') refreshed(out.project);
      return out;
    },
    [resources, refreshed],
  );
}

/** An administrator's status change (Archived through the archive action). */
export function useProjectStatus() {
  const { resources } = useServices();
  const refreshed = useProjectRefresh();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      statusChangeRequest(status) === 'archive' ? resources.projects.archive(id) : resources.projects.update(id, { status }),
    onSuccess: refreshed,
  });
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
