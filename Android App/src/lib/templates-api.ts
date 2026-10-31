import type { ApiClient } from './api-client';
import { idempotencyHeaders } from './idempotency';
import type { ApiProject, ColumnCategory, Priority, TaskTemplate } from './types';
import type { ProjectInput as NewProjectInput } from './project-form';

/**
 * Templates — the website's `api/templates.ts`, use only: list the project templates, preview one for
 * a start day, make a project from it, save a project or a task as a template, list the task
 * templates. Making and editing templates stays on the website (its Templates page). The calls that
 * create something send an idempotency key, so a retried tap never makes two.
 * `TaskTemplate` is Stage 2's (lib/types.ts); it is re-exported here with the other template types.
 */
export type { TaskTemplate };

export interface TemplateColumn {
  name: string;
  category: ColumnCategory;
  color: string;
}

export interface TemplateRole {
  id: string;
  name: string;
}

export interface ProjectTemplateTask {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  /** Calendar days after the project's start it is due (0 = the start day, negative = before); null = no due date. */
  dueOffsetDays: number | null;
  /** The role whose person does it; null = the project's usual default (its owner). */
  roleId: string | null;
  checklist: string[];
}

/** A project template as the Templates page lists it. */
export interface ProjectTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  columnCount: number;
  roleCount: number;
  taskCount: number;
  createdById: string | null;
  createdByName: string | null;
  /** You may change and delete it (you made it, or you are an administrator). */
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTemplate extends ProjectTemplateSummary {
  columns: TemplateColumn[];
  roles: TemplateRole[];
  tasks: ProjectTemplateTask[];
}

/** A project template as saved (whole). Roles are named by a key the tasks refer to: an existing role's id keeps it. */
export interface ProjectTemplateInput {
  name: string;
  description: string | null;
  columns: TemplateColumn[];
  roles: { key: string; name: string }[];
  tasks: { title: string; description: string | null; priority: Priority; dueOffsetDays: number | null; roleKey: string | null; checklist: string[] }[];
}

/** A template's tasks for one start day (the New project form's preview). */
export interface TemplatePlan {
  template: { id: string; name: string; description: string | null; columns: TemplateColumn[]; roles: TemplateRole[]; updatedAt: string };
  startDate: string;
  today: string;
  /** The company's working days (0 = Sunday … 6 = Saturday). */
  workingDays: number[];
  /** The column (its place in the board) the tasks start in. */
  startColumn: number;
  tasks: {
    position: number;
    title: string;
    priority: Priority;
    dueDate: string | null;
    /** The day off its offset fell on, when it was moved to the next working day. */
    movedFrom: string | null;
    offset: number | null;
    roleId: string | null;
    checklistCount: number;
    hasDescription: boolean;
  }[];
  /** Tasks whose due day is already past (a start date in the past). */
  overdue: number;
  /** Tasks moved off a day off. */
  moved: number;
}

/** What "Save as template" will take from a project. */
export interface ProjectTemplateDraft {
  project: { id: string; name: string };
  /** The day the due offsets count from: the project's start, else the day it was created. */
  base: { day: string; from: 'start' | 'created' };
  taskCount: number;
  /** Columns kept (the first 20 of its switched-on ones), out of `columnsTotal`. */
  columnCount: number;
  columnsTotal: number;
  maxTasks: number;
  /** Checklist items kept in all (the first 100 of each task's); at most `maxChecklistItems`. */
  checklistItems: number;
  maxChecklistItems: number;
  /** Tasks with more than 100 checklist items (only their first 100 are kept). */
  checklistTrimmed: number;
  /** Each task's people, in the order they were assigned (what each role gets follows from it: role-counts). */
  assignments: string[][];
  /** The people its tasks are assigned to, most tasks first. */
  people: { id: string; name: string | null; taskCount: number }[];
}

export interface TaskTemplateInput {
  name: string;
  title: string;
  description: string | null;
  priority: Priority;
  checklist: string[];
}

/** A new project from a template: the New project form's fields, its start day and who fills each role (role id → person). */
export type ProjectFromTemplateInput = NewProjectInput & {
  startDate: string;
  roles?: Record<string, string | null>;
  /** The template's `updatedAt` as its preview showed it: a later change is refused (409 TEMPLATE_CHANGED). */
  expectedUpdatedAt?: string;
};

export const PROJECT_TEMPLATES_KEY = ['templates', 'projects'] as const;
export const TASK_TEMPLATES_KEY = ['templates', 'tasks'] as const;

const seg = encodeURIComponent;

export function templatesApi(client: Pick<ApiClient, 'get' | 'post'>) {
  return {
    listProjects: () => client.get<{ data: ProjectTemplateSummary[] }>('/templates/projects').then((r) => r.data),
    plan: (id: string, start: string) => client.get<{ data: TemplatePlan }>(`/templates/projects/${seg(id)}/plan?start=${seg(start)}`).then((r) => r.data),
    projectDraft: (projectId: string) => client.get<{ data: ProjectTemplateDraft }>(`/templates/projects/from-project/${seg(projectId)}`).then((r) => r.data),
    saveProject: (
      projectId: string,
      input: { name: string; description?: string | null; roles: { userId: string; name: string }[]; includeDescriptions?: boolean },
      idempotencyKey?: string,
    ) => client.post<{ data: ProjectTemplate }>(`/templates/projects/from-project/${seg(projectId)}`, input, idempotencyHeaders(idempotencyKey)).then((r) => r.data),
    /** Make a project from a template: the project, its board, tasks, checklists and team in one go. */
    createProject: (templateId: string, input: ProjectFromTemplateInput, idempotencyKey?: string) =>
      client.post<{ data: ApiProject & { taskCount: number } }>(`/templates/projects/${seg(templateId)}/projects`, input, idempotencyHeaders(idempotencyKey)).then((r) => r.data),
    listTasks: () => client.get<{ data: TaskTemplate[] }>('/templates/tasks').then((r) => r.data),
    saveTask: (taskId: string, input: { name?: string; includeDescription?: boolean } = {}, idempotencyKey?: string) =>
      client.post<{ data: TaskTemplate }>(`/templates/tasks/from-task/${seg(taskId)}`, input, idempotencyHeaders(idempotencyKey)).then((r) => r.data),
  };
}

export type TemplatesApi = ReturnType<typeof templatesApi>;
