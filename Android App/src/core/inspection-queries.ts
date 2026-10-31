import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices, useUserId } from './providers';
import { refreshInspectionQueries } from './inspection-sync';
import { isNetworkError } from '../lib/api-client';
import { dueChecksCopyKey, inspectionListCopyKey, taskInspectionsCopyKey } from '../lib/offline-copy';

/**
 * The inspection reads (Stage 4). One inspection is read straight from the server: it has no copy
 * in the offline read cache — the outbox's record is its copy on the phone, kept per person and
 * only for someone who can answer it — so with no signal the screen shows that record. A project's
 * inspections, its due checks and a task's inspections go through the offline copy, so the tab
 * opens with no signal (decision 5); the forms and the schedules are read online only, as starting
 * and scheduling need a connection.
 */

/** One inspection; no signal fails at once (the screen then shows the copy on the phone). */
export function useInspection(id: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['inspection', id],
    queryFn: () => resources.inspections.get(id),
    enabled: !!id,
    networkMode: 'always',
    retry: (n, e) => !isNetworkError(e) && n < 1,
  });
}

/** A project's inspections (in progress and finished) and whether the person may start one. */
export function useProjectInspections(projectId: string) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['project-inspections', projectId],
    queryFn: ({ queryKey }) => reads.read(queryKey, inspectionListCopyKey(projectId), () => resources.inspections.listForProject(projectId)),
    enabled: !!projectId,
  });
}

/** A project's open checks, late ones first — the kept due-checks list. */
export function useDueChecks(projectId: string) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['project-inspections', projectId, 'checks'],
    queryFn: ({ queryKey }) => reads.read(queryKey, dueChecksCopyKey(projectId), () => resources.inspections.dueChecks(projectId)),
    enabled: !!projectId,
  });
}

/** The inspection forms there are to start from (and whether the person may make one, on the website). */
export function useInspectionForms(enabled = true) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['inspection-forms'], queryFn: () => resources.inspections.listForms(), staleTime: 30_000, enabled });
}

/** A project's inspection schedules (online only, as on the website: scheduling needs a connection). */
export function useInspectionSchedules(projectId: string) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['project-inspections', projectId, 'schedules'],
    queryFn: () => resources.inspections.schedules(projectId),
    enabled: !!projectId,
  });
}

/** A task's inspections, and the inspection it is a follow-up of. */
export function useTaskInspections(taskId: string) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: ['task-inspections', taskId],
    queryFn: ({ queryKey }) => reads.read(queryKey, taskInspectionsCopyKey(taskId), () => resources.inspections.forTask(taskId)),
    enabled: !!taskId,
  });
}

/**
 * Start an inspection (needs a connection, as on the website — decision 5). One key per Start, so
 * an answer lost on the way never makes two. The started inspection is kept on the phone at once,
 * so it opens with no signal even if its screen never loaded it.
 */
export function useStartInspection(projectId: string) {
  const { resources, inspections } = useServices();
  const ownerId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { formId: string; taskId?: string | null; place?: string | null; key: string }) =>
      resources.inspections.start(projectId, { formId: v.formId, taskId: v.taskId ?? null, place: v.place ?? null }, v.key),
    onSuccess: async (detail) => {
      // Kept only once the phone's records are read (Final I1).
      await inspections.ready;
      if (ownerId) inspections.outboxFor(ownerId).remember(ownerId, detail);
      refreshInspectionQueries(qc, detail.id, projectId);
    },
  });
}
