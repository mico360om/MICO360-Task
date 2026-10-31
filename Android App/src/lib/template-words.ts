import { ApiError, isNetworkError } from './api-client';
import { dayText } from './day-words';
import type { RoleCounts } from './role-counts';
import type { ProjectTemplateDraft, TemplatePlan, TemplateRole } from './templates-api';

/**
 * The website's words for templates — the New project form's "Start from a template"
 * (`TemplateStart.tsx`, `ProjectFormDialog.tsx`) and "Save as template" (`SaveAsTemplate.tsx`) —
 * with the small sums they make. Each word is drift-tested against those files.
 */

/** "1 task", "2 tasks" (the website's TemplateCard `count`). */
export const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "Thursday, Friday or Saturday". */
export function listWords(words: string[], joiner: 'and' | 'or' = 'and'): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} ${joiner} ${words[words.length - 1]}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Under the start date: due dates count from it, and where a day off moves a due day. */
export function daysOffNote(workingDays: number[]): string {
  const off = [0, 1, 2, 3, 4, 5, 6].filter((d) => !workingDays.includes(d)).map((d) => DAY_NAMES[d]!);
  const lead = 'Due dates count from this day.';
  return off.length ? `${lead} A due day on a ${listWords(off, 'or')} (${off.length === 1 ? 'a day off' : 'days off'}) moves to the next working day.` : lead;
}

/** "Creates 12 tasks on a board of 4 columns: To do · Doing · Review · Done. The tasks start in To do." */
export function planSummary(plan: TemplatePlan): string {
  const cols = plan.template.columns;
  const base = `Creates ${count(plan.tasks.length, 'task')} on a board of ${count(cols.length, 'column')}: ${cols.map((c) => c.name).join(' · ')}`;
  return plan.tasks.length ? `${base}. The tasks start in ${cols[plan.startColumn]?.name ?? 'the first column'}.` : base;
}

/** When a start date in the past makes tasks overdue at once (null: none). */
export function overdueWarning(n: number): string | null {
  if (!n) return null;
  return `${n === 1 ? '1 task will be overdue as soon as the project is created' : `${n} tasks will be overdue as soon as the project is created`}, because the start date is in the past.`;
}

/** "Due Sun 8 Nov" (the year when it isn't this one), " (moved from Fri)" off a day off; "No due date". */
export function planTaskDue(t: TemplatePlan['tasks'][number], today: string): string {
  if (!t.dueDate) return 'No due date';
  const due = `Due ${dayText(t.dueDate, { weekday: 'short', year: t.dueDate.slice(0, 4) !== today.slice(0, 4) })}`;
  return t.movedFrom ? `${due} (moved from ${dayText(t.movedFrom, { weekday: 'short', year: false }).split(' ')[0] ?? ''})` : due;
}

/** Who will do a previewed task: the person filling its role, else the owner ("Owner (Name)"), else "Unassigned"; then " · {role}". */
export function planTaskWho(
  t: TemplatePlan['tasks'][number],
  roles: TemplateRole[],
  fillers: Record<string, string | null>,
  names: ReadonlyMap<string, string>,
  owner: { id: string; name: string | null } | null,
): string {
  const role = t.roleId ? roles.find((r) => r.id === t.roleId) : undefined;
  const fillerId = role ? fillers[role.id] : null;
  const filler = fillerId ? names.get(fillerId) ?? null : null;
  const who = filler ?? (owner?.id ? `Owner${owner.name ? ` (${owner.name})` : ''}` : 'Unassigned');
  return role ? `${who} · ${role.name}` : who;
}

/** The people picked for roles the template still has (after it changed meanwhile). */
export function keepRoles(picked: Record<string, string | null>, roles: TemplateRole[]): Record<string, string | null> {
  const still = new Set(roles.map((r) => r.id));
  return Object.fromEntries(Object.entries(picked).filter(([roleId]) => still.has(roleId)));
}

/** "Start from a template" in the New project form, verbatim. */
export const TEMPLATE_START_WORDS = {
  heading: 'Start from a template',
  optional: '(optional)',
  template: 'Template',
  blank: 'Blank project',
  blankHint: 'the usual board, no tasks',
  loading: 'Loading…',
  startDate: 'Start date',
  whoFills: 'Who fills each role',
  personFor: 'Person for {role}',
  nobody: 'Nobody — the owner gets these tasks',
  rolesNote: 'The people you pick join the project’s team. One person can fill several roles.',
  planFailed: 'Couldn’t load the template’s tasks.',
  retry: 'Retry',
  planLoading: 'Loading the template’s tasks',
  tasksList: 'Tasks it will create',
  ownerTitle: 'The project’s owner',
  noWholeDate: 'Choose the day the project starts: the template’s due dates count from it.',
  gone: 'That template no longer exists. Choose another one, or start a blank project.',
  createFailed: 'Couldn’t create the project. ',
} as const;

/** A refused create from a template that the form answers itself: the template deleted (404) or changed meanwhile (409 TEMPLATE_CHANGED). */
export function templateCreateProblem(err: unknown): { kind: 'gone' | 'changed'; message: string } | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 404) return { kind: 'gone', message: TEMPLATE_START_WORDS.gone };
  const detailsCode = (err.details as { code?: unknown } | undefined)?.code;
  if (err.code === 'TEMPLATE_CHANGED' || detailsCode === 'TEMPLATE_CHANGED') return { kind: 'changed', message: err.message };
  return null;
}

/** "Save as template" (project and task), verbatim. */
export const TEMPLATE_SAVE_WORDS = {
  projectTitle: 'Save as template',
  projectAction: 'Save as template',
  projectActionHint: 'Save this project’s board and tasks as a template for new projects',
  taskTitle: 'Save task as template',
  taskMenu: 'Save as template…',
  name: 'Template name',
  nameMissing: 'Give the template a name.',
  description: 'Description',
  optional: '(optional)',
  descriptionPlaceholder: 'What kind of project it is for',
  readFailed: 'Couldn’t read the project. ',
  retry: 'Retry',
  reading: 'Reading the project',
  includeDescriptions: 'Include task descriptions',
  includeDescription: 'Include its description',
  rolesHeading: 'Roles for the people on its tasks',
  rolesExplain:
    'Name a role (e.g. Inspector) and their tasks will name it: whoever makes a project from the template picks who fills it. Left empty, their tasks are unassigned in the template and go to the new project’s owner. The same name for two people makes one role.',
  roleFor: 'Role for {name}',
  noRole: 'No role',
  someoneLeft: 'Someone who has left',
  nobodyAssigned: 'Nobody is assigned to its tasks: they are saved unassigned.',
  taskNameHint: 'How it is listed in the New task form.',
  cancel: 'Cancel',
  save: 'Save template',
  close: 'Close',
  savedProject: 'Saved “{name}” as a template.',
  savedProjectWhere: 'Anyone can start a new project from it: it is listed on the Templates page and in the New project form.',
  savedTask: 'Saved “{name}” as a task template.',
  savedTaskWhere: 'Anyone can start a new task from it in the New task form.',
  saveFailed: 'Couldn’t save the template. ',
  unreachable: 'The server couldn’t be reached.',
  tryAgain: 'Please try again.',
  openTemplates: 'Open Templates',
  done: 'Done',
  projectWhat: 'task titles, descriptions and checklists',
  projectWhatNoDescriptions: 'task titles and checklists',
  taskWhat: 'task title, description and checklist',
  taskWhatNoDescription: 'task title and checklist',
} as const;

/** Said before saving: a template is company-wide. */
export const publishWarning = (what: string): string => `Everyone in the company will be able to see this template’s ${what}.`;

/** "Sun 1 Nov 2026". */
const longDay = (key: string) => dayText(key, { weekday: 'short', year: true });

/** What "Save as template" says it takes from the project, with the website's warnings (tone: how it is shown). */
export function saveProjectLines(d: ProjectTemplateDraft, includeDescriptions: boolean): Array<{ text: string; tone: 'plain' | 'warning' | 'danger' }> {
  const lines: Array<{ text: string; tone: 'plain' | 'warning' | 'danger' }> = [
    { text: `Saves its board (${count(d.columnCount, 'column')}) and its ${count(d.taskCount, 'task')}, with their ${includeDescriptions ? 'descriptions, ' : ''}priorities and checklists.`, tone: 'plain' },
    {
      text:
        d.base.from === 'start'
          ? `Due dates are kept as days from the project’s start, ${longDay(d.base.day)}.`
          : `Due dates are kept as days from the day the project was created, ${longDay(d.base.day)} (it has no start date).`,
      tone: 'plain',
    },
  ];
  if (d.columnsTotal > d.columnCount) lines.push({ text: `Only the first ${d.columnCount} of its ${d.columnsTotal} columns are kept.`, tone: 'warning' });
  if (d.checklistTrimmed) {
    lines.push({
      text: d.checklistTrimmed === 1 ? '1 task has more than 100 checklist items: only its first 100 are kept.' : `${d.checklistTrimmed} tasks have more than 100 checklist items: only their first 100 are kept.`,
      tone: 'warning',
    });
  }
  for (const text of overLimits(d)) lines.push({ text, tone: 'danger' });
  return lines;
}

function overLimits(d: ProjectTemplateDraft): string[] {
  const out: string[] = [];
  if (d.taskCount > d.maxTasks) out.push(`This project has ${d.taskCount} tasks; a template can hold at most ${d.maxTasks}.`);
  if (d.checklistItems > d.maxChecklistItems) {
    out.push(`Its checklists hold ${d.checklistItems.toLocaleString('en-US')} items in all; a template can hold at most ${d.maxChecklistItems.toLocaleString('en-US')}.`);
  }
  return out;
}

/** What stops the project from being saved as a template (too many tasks or checklist items); null: nothing. */
export function blockingProblem(d: ProjectTemplateDraft): string | null {
  return overLimits(d)[0] ?? null;
}

/** Under the roles: what each role gets, and how many tasks go to the new project's owner. */
export function rolesSummary(c: RoleCounts): string {
  const named = c.roles.filter((r) => r.tasks);
  const lead = named.length ? `${named.map((r) => `${r.name}: ${count(r.tasks, 'task')}`).join(' · ')}. ` : 'No roles yet. ';
  return `${lead}${c.unassigned ? `${count(c.unassigned, 'task')} will be unassigned (they go to the new project’s owner).` : ''}`.trim();
}

const roleTasks = (role: string, c: RoleCounts) => c.roles.find((r) => r.name.trim().toLowerCase() === role.trim().toLowerCase())?.tasks ?? 0;

/** The typed role names no task (each of the person's tasks names another role first): said as a warning. */
export function roleWontCount(role: string, c: RoleCounts): boolean {
  return !!role.trim() && roleTasks(role, c) === 0;
}

/** What naming this person's role really does, by the rule the server saves with. */
export function personRoleNote(personId: string, role: string, c: RoleCounts, onTasks: number): string {
  const name = role.trim();
  if (!name) return `On ${count(onTasks, 'task')}.`;
  if (roleTasks(name, c) === 0) return `“${name}” won’t become a role: each of these tasks names another role first.`;
  const gets = c.fromPerson.get(personId) ?? 0;
  if (gets === onTasks) return `${name} gets ${onTasks === 1 ? 'this task' : `all ${onTasks} of these tasks`}.`;
  if (gets === 0) return `These tasks name another role first: ${name} gets its tasks from others.`;
  return `${name} gets ${gets} of these ${onTasks} tasks; the others name another role first.`;
}

/** What "Save task as template" takes from the task (`checklistCount` null: the checklist is still loading — "…", never none). */
export function saveTaskLine(t: { description?: string | null; checklistCount: number | null }, includeDescription: boolean): string {
  const withDescription = includeDescription && !!t.description?.trim();
  const items = t.checklistCount === null ? ' (…)' : t.checklistCount ? ` (${count(t.checklistCount, 'item')})` : '';
  return `Saves its title, ${withDescription ? 'description, ' : ''}priority and checklist${items}. Its dates, people and project aren’t saved.`;
}

/** Why a save failed, as the website says it (the server's own words, else no answer, else try again). */
export function templateSaveReason(err: unknown): string {
  if (err instanceof ApiError && err.message && !/^Request failed/.test(err.message)) return err.message;
  return isNetworkError(err) ? TEMPLATE_SAVE_WORDS.unreachable : TEMPLATE_SAVE_WORDS.tryAgain;
}
