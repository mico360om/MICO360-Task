import type { ApiClient } from '../lib/api-client';
import type { ApiProject, NewProjectInput } from './projects';
import type { Priority } from './tasks';

export type ColumnCategory = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

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

export interface TaskTemplate {
  id: string;
  name: string;
  title: string;
  description: string | null;
  priority: Priority;
  checklist: string[];
  createdById: string | null;
  createdByName: string | null;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
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

export function templatesApi(client: ApiClient) {
  return {
    listProjects: () => client.get<{ data: ProjectTemplateSummary[] }>('/templates/projects').then((r) => r.data),
    getProject: (id: string) => client.get<{ data: ProjectTemplate }>(`/templates/projects/${id}`).then((r) => r.data),
    plan: (id: string, start: string) => client.get<{ data: TemplatePlan }>(`/templates/projects/${id}/plan?start=${encodeURIComponent(start)}`).then((r) => r.data),
    createProjectTemplate: (input: ProjectTemplateInput) => client.post<{ data: ProjectTemplate }>('/templates/projects', input).then((r) => r.data),
    updateProjectTemplate: (id: string, input: ProjectTemplateInput) => client.put<{ data: ProjectTemplate }>(`/templates/projects/${id}`, input).then((r) => r.data),
    removeProjectTemplate: (id: string) => client.del<void>(`/templates/projects/${id}`),
    projectDraft: (projectId: string) => client.get<{ data: ProjectTemplateDraft }>(`/templates/projects/from-project/${projectId}`).then((r) => r.data),
    saveProject: (projectId: string, input: { name: string; description?: string | null; roles: { userId: string; name: string }[]; includeDescriptions?: boolean }) =>
      client.post<{ data: ProjectTemplate }>(`/templates/projects/from-project/${projectId}`, input).then((r) => r.data),
    /** Make a project from a template: the project, its board, tasks, checklists and team in one go. */
    createProject: (templateId: string, input: ProjectFromTemplateInput) =>
      client.post<{ data: ApiProject & { taskCount: number } }>(`/templates/projects/${templateId}/projects`, input).then((r) => r.data),
    listTasks: () => client.get<{ data: TaskTemplate[] }>('/templates/tasks').then((r) => r.data),
    createTaskTemplate: (input: TaskTemplateInput) => client.post<{ data: TaskTemplate }>('/templates/tasks', input).then((r) => r.data),
    updateTaskTemplate: (id: string, input: TaskTemplateInput) => client.put<{ data: TaskTemplate }>(`/templates/tasks/${id}`, input).then((r) => r.data),
    removeTaskTemplate: (id: string) => client.del<void>(`/templates/tasks/${id}`),
    saveTask: (taskId: string, input: { name?: string; includeDescription?: boolean } = {}) => client.post<{ data: TaskTemplate }>(`/templates/tasks/from-task/${taskId}`, input).then((r) => r.data),
  };
}

/** "Due on the start day", "5 days after the start", "2 days before the start", "No due date". */
export function offsetLabel(offset: number | null): string {
  if (offset === null) return 'No due date';
  if (offset === 0) return 'Due on the start day';
  const n = Math.abs(offset);
  return `Due ${n} day${n === 1 ? '' : 's'} ${offset > 0 ? 'after' : 'before'} the start`;
}

/** "Start + 5", the short form a task row shows. */
export function offsetShort(offset: number | null): string {
  if (offset === null) return 'No date';
  if (offset === 0) return 'Start';
  return `Start ${offset > 0 ? '+' : '−'} ${Math.abs(offset)}`;
}
