import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from './providers';
import { PROJECT_TEMPLATES_KEY, TASK_TEMPLATES_KEY, type TemplatesApi } from '../lib/templates-api';
import { isWholeDate } from '../lib/reports';
import type { TemplateChoice } from '../lib/template-choice';

/** The task templates' cache key (the website's TASK_TEMPLATES_KEY; lib/templates-api holds both keys). */
export { TASK_TEMPLATES_KEY };

/**
 * The task templates New task can start from (GET /templates/tasks; making and editing them stays on
 * the website). Read through the person's offline copy, so the picker is there without signal; only
 * while `enabled` (New task, not Edit task); asked again after 30 s, as the website (at once when the
 * offline copy answered).
 */
export function useTaskTemplates(enabled: boolean) {
  const { resources, reads } = useServices();
  return useQuery({
    queryKey: TASK_TEMPLATES_KEY,
    queryFn: ({ queryKey }) => reads.read(queryKey, 'templates.tasks', () => resources.templates.listTasks()),
    enabled,
    staleTime: (q) => (reads.answeredFromCopy(q) ? 0 : 30_000),
  });
}

/** The project templates a new project can start from (GET /templates/projects) — online, as the New project form needs a connection anyway. */
export function useProjectTemplates() {
  const { resources } = useServices();
  return useQuery({ queryKey: PROJECT_TEMPLATES_KEY, queryFn: () => resources.templates.listProjects() });
}

/**
 * The chosen template's tasks for its start day (the form's preview, and what Create checks the
 * template against). Under PROJECT_TEMPLATES_KEY, so refreshing the list refreshes it; the last
 * preview stays shown while the next day's loads.
 */
export function useTemplatePlan(choice: TemplateChoice | null) {
  const { resources } = useServices();
  return useQuery({
    queryKey: ['templates', 'projects', choice?.id, 'plan', choice?.startDate],
    queryFn: () => resources.templates.plan(choice!.id, choice!.startDate),
    enabled: !!choice && isWholeDate(choice.startDate),
    placeholderData: keepPreviousData,
  });
}

/** What "Save as template" will take from a project (asked afresh each time the sheet opens). */
export function useProjectTemplateDraft(projectId: string, enabled: boolean) {
  const { resources } = useServices();
  return useQuery({ queryKey: ['templates', 'from-project', projectId], queryFn: () => resources.templates.projectDraft(projectId), enabled, staleTime: 0 });
}

type SaveProjectInput = Parameters<TemplatesApi['saveProject']>[1];
type SaveTaskInput = NonNullable<Parameters<TemplatesApi['saveTask']>[1]>;

/** Save a project as a template (whoever runs it; the server checks too), under the sheet's key; the template lists refresh. */
export function useSaveProjectTemplate(projectId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: { input: SaveProjectInput; key: string }) => resources.templates.saveProject(projectId, input, key),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PROJECT_TEMPLATES_KEY }),
  });
}

/** Save a task as a task template (whoever runs its project), under the sheet's key; the task templates refresh. */
export function useSaveTaskTemplate(taskId: string) {
  const { resources } = useServices();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: { input: SaveTaskInput; key: string }) => resources.templates.saveTask(taskId, input, key),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TASK_TEMPLATES_KEY }),
  });
}
