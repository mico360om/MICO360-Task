import { count, TEMPLATE_START_WORDS } from './template-words';
import type { ProjectTemplateSummary, TemplatePlan } from './templates-api';
import { displayName } from './types';

/**
 * A new project's template, its start day and who fills each of its roles (role id → person id), as
 * the website's TemplateStart keeps them. A role nobody fills is left out: its tasks go to the
 * project's owner, as any new task.
 */
export interface TemplateChoice {
  id: string;
  startDate: string;
  roles: Record<string, string | null>;
}

/** Picking a template (or "Blank project": ''): the start day stays, the roles start afresh. */
export function chooseTemplate(prev: TemplateChoice | null, id: string, today: string): TemplateChoice | null {
  return id ? { id, startDate: prev?.startDate || today, roles: {} } : null;
}

/** A role's person picked ('' = nobody: the owner gets its tasks). */
export function withFiller(choice: TemplateChoice, roleId: string, personId: string): TemplateChoice {
  const roles = { ...choice.roles };
  if (personId) roles[roleId] = personId;
  else delete roles[roleId];
  return { ...choice, roles };
}

/** The preview of the chosen template only (an older answer for another one doesn't count). */
export function planFor(plan: TemplatePlan | undefined, choice: TemplateChoice | null): TemplatePlan | undefined {
  return plan && choice && plan.template?.id === choice.id ? plan : undefined;
}

/** The project templates as the server listed them (a row without a name or task count is left out). */
export function usableProjectTemplates(data: unknown): ProjectTemplateSummary[] {
  return Array.isArray(data) ? (data as ProjectTemplateSummary[]).filter((t) => !!t && typeof t.name === 'string' && typeof t.taskCount === 'number') : [];
}

/** The picker: "Blank project", each template with its task count, and the chosen one while the list loads. */
export function templateOptions(list: unknown, choice: TemplateChoice | null, plan: TemplatePlan | undefined): Array<{ value: string; label: string; hint?: string }> {
  const templates = usableProjectTemplates(list);
  const current = planFor(plan, choice);
  return [
    { value: '', label: TEMPLATE_START_WORDS.blank, hint: TEMPLATE_START_WORDS.blankHint },
    ...templates.map((t) => ({ value: t.id, label: t.name, hint: count(t.taskCount, 'task') })),
    ...(choice && current && !templates.some((t) => t.id === choice.id) ? [{ value: choice.id, label: current.template.name }] : []),
  ];
}

/** Who can fill a role: "Nobody — the owner gets these tasks", then the active people. */
export function fillerOptions(people: ReadonlyArray<{ id: string; username: string; firstName?: string; lastName?: string; active?: boolean }>): Array<{ value: string; label: string; hint?: string }> {
  return [
    { value: '', label: TEMPLATE_START_WORDS.nobody },
    ...people.filter((u) => u.active !== false).map((u) => ({ value: u.id, label: displayName(u), hint: `@${u.username}` })),
  ];
}
