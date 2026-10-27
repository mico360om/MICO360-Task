import type { Priority } from '../tasks/task-repository';

export type ColumnCategory = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

/** One of a project template's board columns. */
export interface TemplateColumn {
  name: string;
  category: ColumnCategory;
  color: string;
}

/** A role a template's tasks name instead of a person ("Inspector"). */
export interface TemplateRole {
  id: string;
  name: string;
}

/** One of a project template's standard tasks. */
export interface ProjectTemplateTaskRecord {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  /** Calendar days after the project's start it is due (0 = the start day; negative = before); null = no due date. */
  dueOffsetDays: number | null;
  /** The role whose person does it; null = the project's usual default (its owner). */
  roleId: string | null;
  /** Its checklist items' text, in order. */
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
  /** Who made it (they may change and delete it); null when unknown. */
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A project template with everything in it. */
export interface ProjectTemplateRecord extends ProjectTemplateSummary {
  columns: TemplateColumn[];
  roles: TemplateRole[];
  tasks: ProjectTemplateTaskRecord[];
}

/**
 * A project template as saved (created or replaced whole). Roles are named by a `key` the tasks refer
 * to: an existing role's id keeps that role (its id stays the same), any other key makes a new one.
 */
export interface ProjectTemplateInput {
  name: string;
  description: string | null;
  columns: TemplateColumn[];
  roles: { key: string; name: string }[];
  tasks: {
    title: string;
    description: string | null;
    priority: Priority;
    dueOffsetDays: number | null;
    roleKey: string | null;
    checklist: string[];
  }[];
}

/** A task template: what it fills in on the New task form. */
export interface TaskTemplateRecord {
  id: string;
  /** What it is called in the list ("Weekly site inspection"). */
  name: string;
  title: string;
  description: string | null;
  priority: Priority;
  checklist: string[];
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskTemplateInput {
  name: string;
  title: string;
  description: string | null;
  priority: Priority;
  checklist: string[];
}

/** What saving a project as a template reads of it. */
export interface ProjectSnapshot {
  id: string;
  name: string;
  startDate: Date | null;
  createdAt: Date;
  /** Its board as people see it: the columns that are switched on, in order. */
  columns: TemplateColumn[];
  /** Its live tasks, oldest first — one per repeating series (its first live copy). */
  tasks: {
    id: string;
    title: string;
    description: string | null;
    priority: Priority;
    dueDate: Date | null;
    /** Who is on it, in the order they were assigned. */
    assigneeIds: string[];
    checklist: string[];
  }[];
}

/** What saving a task as a template reads of it. */
export interface TaskSnapshot {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  priority: Priority;
  checklist: string[];
}

export interface TemplateRepository {
  /** Every project template, by name. */
  listProjectTemplates(): Promise<ProjectTemplateSummary[]>;
  findProjectTemplate(id: string): Promise<ProjectTemplateRecord | null>;
  createProjectTemplate(input: ProjectTemplateInput, actorId: string): Promise<ProjectTemplateRecord>;
  /** Replace a template's contents whole, in one transaction (null when it is gone). */
  updateProjectTemplate(id: string, input: ProjectTemplateInput, actorId: string): Promise<ProjectTemplateRecord | null>;
  /** Delete a template (with its roles and tasks); false when it was already gone. Projects are never touched. */
  deleteProjectTemplate(id: string): Promise<boolean>;
  /** Every task template, by name. */
  listTaskTemplates(): Promise<TaskTemplateRecord[]>;
  findTaskTemplate(id: string): Promise<TaskTemplateRecord | null>;
  createTaskTemplate(input: TaskTemplateInput, actorId: string): Promise<TaskTemplateRecord>;
  updateTaskTemplate(id: string, input: TaskTemplateInput, actorId: string): Promise<TaskTemplateRecord | null>;
  deleteTaskTemplate(id: string): Promise<boolean>;
  /** A live project's board and tasks (null when it is gone). */
  projectSnapshot(projectId: string): Promise<ProjectSnapshot | null>;
  /** A live task's title, description, priority and checklist (null when it is gone). */
  taskSnapshot(taskId: string): Promise<TaskSnapshot | null>;
}
