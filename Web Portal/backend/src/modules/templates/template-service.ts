import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { dueDayKey, todayKey, zonedDayKey } from '../../lib/due-date';
import { boardDateFromKey } from '../tasks/board-date';
import { dueDateOnEntry } from '../projects/project-task-settings';
import { DEFAULT_COLUMNS, type PeopleLookup, type StartingContent } from '../projects/project-repository';
import { planTemplateTasks, offsetBetween, startColumnIndex, type PlannedTask } from './template-plan';
import type {
  ProjectTemplateInput,
  ProjectTemplateRecord,
  ProjectTemplateSummary,
  TaskTemplateInput,
  TaskTemplateRecord,
  TemplateColumn,
  TemplateRepository,
} from './template-repository';

/** How much a template may hold. */
export const TEMPLATE_LIMITS = {
  columns: 20,
  roles: 30,
  tasks: 500,
  checklistItems: 100,
  /** Checklist items in all, across every task of a template. */
  checklistTotal: 5000,
  roleName: 80,
  /** Due offsets: up to a year before the start, ten years after. */
  minOffset: -365,
  maxOffset: 3650,
} as const;

/** Who is asking. */
export interface TemplateActor {
  id: string;
  roles: string[];
}

export interface TemplateServiceDeps {
  repo: TemplateRepository;
  /** May this person see the project at all (a project they can't see answers 404, as everywhere). */
  canViewProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  /** Does this person run the project: an administrator, its owner, named manager or a MANAGER member. */
  canManageProject: (userId: string, roles: string[], projectId: string) => Promise<boolean>;
  /** Who may fill a role: active people only (without it, nobody is checked). */
  people?: PeopleLookup;
  /** The company's working days (0 = Sunday … 6 = Saturday): the meeting hours in System Settings. */
  workingDays: () => Promise<number[]>;
  /** The company's time zone: "today", and the day a project was created on. */
  timeZone: string;
  now?: () => Date;
  /** Display names, for "Made by" and the people a project's tasks are assigned to. */
  names?: (ids: string[]) => Promise<Map<string, string>>;
}

const isAdmin = (actor: TemplateActor) => actor.roles.includes('ADMIN');
/** Administrators change any template; anyone else only the ones they made. */
const mayChange = (t: { createdById: string | null }, actor: TemplateActor) => isAdmin(actor) || (!!t.createdById && t.createdById === actor.id);

const FROM_SCRATCH_IS_ADMINS = 'Only an administrator can create a template from scratch. Anyone who runs a project can save it, or one of its tasks, as a template.';
const NOT_YOURS = 'Only the person who made this template or an administrator can change or delete it.';
const SAVE_REFUSED = 'Only this project’s owner, its managers or an administrator can save it as a template.';
const SAVE_TASK_REFUSED = 'Only the owner or a manager of this task’s project, or an administrator, can save it as a template.';

const sameName = (s: string) => s.trim().toLocaleLowerCase();

/**
 * The rules a template's contents must keep beyond their shape (the routes check that): a board
 * tasks can start on, roles with their own names, and tasks that only name the template's roles.
 */
export function checkProjectTemplate(input: ProjectTemplateInput): void {
  if (!input.columns.some((c) => c.category !== 'DONE')) {
    throw new ValidationError('The board needs at least one column that isn’t Done, for the tasks to start in.', { field: 'columns' });
  }
  const names = new Set<string>();
  const keys = new Set<string>();
  for (const r of input.roles) {
    if (names.has(sameName(r.name))) throw new ValidationError(`Two roles are called “${r.name.trim()}”. Give each role its own name.`, { field: 'roles' });
    if (keys.has(r.key)) throw new ValidationError('Two roles have the same key.', { field: 'roles' });
    names.add(sameName(r.name));
    keys.add(r.key);
  }
  input.tasks.forEach((t, i) => {
    if (t.roleKey && !keys.has(t.roleKey)) throw new ValidationError(`Task ${i + 1} (“${t.title}”) names a role this template doesn’t have.`, { field: 'tasks', index: i });
  });
  const items = checklistTotal(input.tasks);
  if (items > TEMPLATE_LIMITS.checklistTotal) {
    throw new ValidationError(`A template can hold at most ${TEMPLATE_LIMITS.checklistTotal.toLocaleString('en-US')} checklist items in all; this one has ${items.toLocaleString('en-US')}.`, { field: 'tasks' });
  }
}

/** Checklist items across a template's tasks. */
const checklistTotal = (tasks: { checklist: unknown[] }[]) => tasks.reduce((n, t) => n + t.checklist.length, 0);

/** The message when a template changed after its preview was shown. */
export const TEMPLATE_CHANGED_MESSAGE = 'This template was changed while you were looking at it — check the preview again.';

/** The day a stored project start (or creation) falls on. */
function baseDayOf(project: { startDate: Date | null; createdAt: Date }, timeZone: string): { day: string; from: 'start' | 'created' } {
  if (project.startDate) return { day: dueDayKey(project.startDate, timeZone)!, from: 'start' };
  return { day: zonedDayKey(project.createdAt, timeZone), from: 'created' };
}

/** A board that tasks can start on: the given columns, else the default board. */
function usableColumns(columns: TemplateColumn[]): TemplateColumn[] {
  if (columns.some((c) => c.category !== 'DONE')) return columns.slice(0, TEMPLATE_LIMITS.columns);
  return DEFAULT_COLUMNS.map((c) => ({ name: c.name, category: c.category, color: c.color }));
}

export function createTemplateService(deps: TemplateServiceDeps) {
  const { repo, timeZone } = deps;
  const now = deps.now ?? (() => new Date());
  const namesOf = async (ids: (string | null)[]) => {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    return deps.names && wanted.length ? deps.names(wanted) : new Map<string, string>();
  };

  async function projectTemplateOrThrow(id: string): Promise<ProjectTemplateRecord> {
    const t = await repo.findProjectTemplate(id);
    if (!t) throw new NotFoundError('That template no longer exists.');
    return t;
  }
  async function taskTemplateOrThrow(id: string): Promise<TaskTemplateRecord> {
    const t = await repo.findTaskTemplate(id);
    if (!t) throw new NotFoundError('That template no longer exists.');
    return t;
  }

  /** A project the person may save as a template: hidden (404) if they can't see it, refused (403) if they don't run it. */
  async function requireRunner(projectId: string, actor: TemplateActor, refused: string): Promise<void> {
    if (!(await deps.canViewProject(actor.id, actor.roles, projectId))) throw new NotFoundError('Project not found.');
    if (!(await deps.canManageProject(actor.id, actor.roles, projectId))) throw new ForbiddenError(refused);
  }

  const withAccess = async <T extends { createdById: string | null }>(rows: T[], actor: TemplateActor) => {
    const names = await namesOf(rows.map((r) => r.createdById));
    return rows.map((r) => ({ ...r, createdByName: r.createdById ? names.get(r.createdById) ?? null : null, canManage: mayChange(r, actor) }));
  };

  // ── Project templates ──

  /** Every project template (everyone may use them), with who made it and whether you may change it. */
  async function listProjectTemplates(actor: TemplateActor): Promise<(ProjectTemplateSummary & { createdByName: string | null; canManage: boolean })[]> {
    return withAccess(await repo.listProjectTemplates(), actor);
  }

  async function getProjectTemplate(id: string, actor: TemplateActor) {
    const [t] = await withAccess([await projectTemplateOrThrow(id)], actor);
    return t!;
  }

  /** A new template from scratch: an administrator's. */
  async function createProjectTemplate(input: ProjectTemplateInput, actor: TemplateActor): Promise<ProjectTemplateRecord> {
    if (!isAdmin(actor)) throw new ForbiddenError(FROM_SCRATCH_IS_ADMINS);
    checkProjectTemplate(input);
    return repo.createProjectTemplate(input, actor.id);
  }

  /** Replace a template's contents (its maker or an administrator). Returns it before and after. */
  async function updateProjectTemplate(id: string, input: ProjectTemplateInput, actor: TemplateActor): Promise<{ before: ProjectTemplateRecord; after: ProjectTemplateRecord }> {
    const before = await projectTemplateOrThrow(id);
    if (!mayChange(before, actor)) throw new ForbiddenError(NOT_YOURS);
    checkProjectTemplate(input);
    const after = await repo.updateProjectTemplate(id, input, actor.id);
    if (!after) throw new NotFoundError('That template no longer exists.');
    return { before, after };
  }

  /** Delete a template (its maker or an administrator). Projects made from it are not touched. */
  async function deleteProjectTemplate(id: string, actor: TemplateActor): Promise<ProjectTemplateRecord> {
    const before = await projectTemplateOrThrow(id);
    if (!mayChange(before, actor)) throw new ForbiddenError(NOT_YOURS);
    await repo.deleteProjectTemplate(id);
    return before;
  }

  /**
   * What "Save as template" will take from a project, for its dialog: how many tasks and columns,
   * the day the due offsets count from, and the people its tasks are assigned to (each can become a
   * role, or be left out so their tasks are unassigned in the template).
   */
  async function projectDraft(projectId: string, actor: TemplateActor) {
    await requireRunner(projectId, actor, SAVE_REFUSED);
    const snap = await repo.projectSnapshot(projectId);
    if (!snap) throw new NotFoundError('Project not found.');
    const counts = new Map<string, number>();
    for (const t of snap.tasks) for (const id of new Set(t.assigneeIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
    const names = await namesOf([...counts.keys()]);
    return {
      project: { id: snap.id, name: snap.name },
      base: baseDayOf(snap, timeZone),
      taskCount: snap.tasks.length,
      // What is kept of its board (the first 20 of its switched-on columns), out of how many.
      columnCount: usableColumns(snap.columns).length,
      columnsTotal: snap.columns.length,
      maxTasks: TEMPLATE_LIMITS.tasks,
      // Checklist items kept (the first 100 of each task's), and how many tasks have more than that.
      checklistItems: checklistTotal(snap.tasks.map((t) => ({ checklist: t.checklist.slice(0, TEMPLATE_LIMITS.checklistItems) }))),
      maxChecklistItems: TEMPLATE_LIMITS.checklistTotal,
      checklistTrimmed: snap.tasks.filter((t) => t.checklist.length > TEMPLATE_LIMITS.checklistItems).length,
      // Each task's people in the order they were assigned: what each role gets follows from it (see saveProjectAsTemplate).
      assignments: snap.tasks.map((t) => [...new Set(t.assigneeIds)]),
      people: [...counts].map(([id, taskCount]) => ({ id, name: names.get(id) ?? null, taskCount })).sort((a, b) => b.taskCount - a.taskCount || (a.name ?? '').localeCompare(b.name ?? '')),
    };
  }

  /**
   * Save a project as a template (whoever runs it, or an administrator): its board, and its tasks with
   * their checklists and due dates as days from its start (or, without one, the day it was created).
   * `roles` names a role for some of the people its tasks are assigned to: those tasks name that role
   * (two people given the same name share one role); everyone else's tasks are left unassigned.
   */
  async function saveProjectAsTemplate(
    projectId: string,
    input: { name: string; description: string | null; roles: { userId: string; name: string }[]; includeDescriptions?: boolean },
    actor: TemplateActor,
  ): Promise<ProjectTemplateRecord> {
    await requireRunner(projectId, actor, SAVE_REFUSED);
    const snap = await repo.projectSnapshot(projectId);
    if (!snap) throw new NotFoundError('Project not found.');
    if (snap.tasks.length > TEMPLATE_LIMITS.tasks) {
      throw new ValidationError(`This project has ${snap.tasks.length} tasks; a template can hold at most ${TEMPLATE_LIMITS.tasks}.`, { field: 'tasks' });
    }
    const roles: { key: string; name: string }[] = [];
    const keyOfName = new Map<string, string>();
    const roleOfUser = new Map<string, string>();
    for (const r of input.roles) {
      const name = r.name.trim();
      if (!name) continue;
      let key = keyOfName.get(sameName(name));
      if (!key) {
        if (roles.length >= TEMPLATE_LIMITS.roles) throw new ValidationError(`A template can have at most ${TEMPLATE_LIMITS.roles} roles.`, { field: 'roles' });
        key = `role-${roles.length + 1}`;
        keyOfName.set(sameName(name), key);
        roles.push({ key, name: name.slice(0, TEMPLATE_LIMITS.roleName) });
      }
      roleOfUser.set(r.userId, key);
    }
    const base = baseDayOf(snap, timeZone).day;
    const template: ProjectTemplateInput = {
      name: input.name,
      description: input.description,
      columns: usableColumns(snap.columns),
      roles,
      tasks: snap.tasks.map((t) => {
        const offset = offsetBetween(base, dueDayKey(t.dueDate, timeZone));
        return {
          title: t.title,
          // Left out when the saver chose not to publish them (everyone can see a template).
          description: input.includeDescriptions === false ? null : t.description,
          priority: t.priority,
          dueOffsetDays: offset === null ? null : Math.max(TEMPLATE_LIMITS.minOffset, Math.min(TEMPLATE_LIMITS.maxOffset, offset)),
          // The first of its people (in the order they were assigned) who was given a role.
          roleKey: t.assigneeIds.map((id) => roleOfUser.get(id)).find((k): k is string => !!k) ?? null,
          checklist: t.checklist.slice(0, TEMPLATE_LIMITS.checklistItems),
        };
      }),
    };
    // Only roles some task names are kept.
    const used = new Set(template.tasks.map((t) => t.roleKey));
    template.roles = template.roles.filter((r) => used.has(r.key));
    checkProjectTemplate(template);
    return repo.createProjectTemplate(template, actor.id);
  }

  /** A template's tasks for a project starting on `startKey`, as the New project form previews them. */
  async function planProject(id: string, startKey: string) {
    const t = await projectTemplateOrThrow(id);
    const workingDays = await deps.workingDays();
    const tasks = planTemplateTasks(t, { startKey, workingDays, fillers: {} });
    const today = todayKey(timeZone, now());
    return {
      template: { id: t.id, name: t.name, description: t.description, columns: t.columns, roles: t.roles, updatedAt: t.updatedAt },
      startDate: startKey,
      today,
      workingDays,
      startColumn: startColumnIndex(t.columns),
      tasks: tasks.map((p, i) => ({
        position: i,
        title: p.title,
        priority: p.priority,
        dueDate: p.dueDay,
        movedFrom: p.movedFrom,
        offset: p.offset,
        roleId: p.roleId,
        checklistCount: p.checklist.length,
        hasDescription: !!p.description,
      })),
      overdue: tasks.filter((p) => p.dueDay !== null && p.dueDay < today).length,
      moved: tasks.filter((p) => p.movedFrom !== null).length,
    };
  }

  /**
   * Everything creating a project from a template needs, checked: its board and tasks for the start
   * day, and the people filling its roles (each must be a role of this template and an active user;
   * one person may fill several). A role left empty leaves its tasks to the usual default. Due dates
   * follow the template; an undated task follows the project's "New tasks are due today" setting, as
   * any new task does.
   */
  async function prepareProject(
    id: string,
    {
      startKey,
      fillers,
      defaultDueToday,
      expectedUpdatedAt,
    }: {
      startKey: string;
      fillers: Record<string, string | null | undefined>;
      defaultDueToday: boolean;
      /** When the template the preview showed was last changed: a later change is refused (the preview is out of date). */
      expectedUpdatedAt?: string | Date;
    },
  ): Promise<{ template: ProjectTemplateRecord; startWith: StartingContent; fillerIds: string[]; filledRoles: { roleId: string; role: string; userId: string }[] }> {
    const template = await projectTemplateOrThrow(id);
    if (expectedUpdatedAt !== undefined && new Date(expectedUpdatedAt).getTime() !== template.updatedAt.getTime()) {
      throw new ConflictError(TEMPLATE_CHANGED_MESSAGE, 'TEMPLATE_CHANGED');
    }
    const roleById = new Map(template.roles.map((r) => [r.id, r]));
    const filled: { roleId: string; role: string; userId: string }[] = [];
    for (const [roleId, userId] of Object.entries(fillers)) {
      const role = roleById.get(roleId);
      if (!role) throw new ValidationError('This template was changed while you were filling in the form. Pick the people for its roles again.', { field: 'roles', code: 'TEMPLATE_CHANGED' });
      if (userId) filled.push({ roleId, role: role.name, userId });
    }
    const fillerIds = [...new Set(filled.map((f) => f.userId))];
    if (deps.people && fillerIds.length) {
      const active = new Set(await deps.people.activeIds(fillerIds));
      const off = filled.find((f) => !active.has(f.userId));
      if (off) throw new ValidationError(`The person picked for ${off.role} isn’t an active user. Pick someone else.`, { field: 'roles', roleId: off.roleId });
    }
    const at = now();
    const today = todayKey(timeZone, at);
    const boardDate = boardDateFromKey(today);
    const planned = planTemplateTasks(template, { startKey, workingDays: await deps.workingDays(), fillers: Object.fromEntries(filled.map((f) => [f.roleId, f.userId])) });
    const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
    const startWith: StartingContent = {
      columns: template.columns.map((c) => ({ ...c })),
      startColumn: startColumnIndex(template.columns),
      boardDate,
      templateName: template.name,
      tasks: planned.map((p: PlannedTask) => {
        // A task is under way from the project's start (or its due day, when that comes first).
        const startDate = day(p.dueDay && p.dueDay < startKey ? p.dueDay : startKey);
        const dueDate = dueDateOnEntry({ dueDate: p.dueDay ? day(p.dueDay) : null, startDate, boardDate }, { defaultDueToday }, timeZone, at) ?? null;
        return { title: p.title, description: p.description, priority: p.priority, startDate, dueDate, assigneeIds: p.assigneeId ? [p.assigneeId] : null, checklist: p.checklist };
      }),
    };
    return { template, startWith, fillerIds, filledRoles: filled };
  }

  // ── Task templates ──

  async function listTaskTemplates(actor: TemplateActor) {
    return withAccess(await repo.listTaskTemplates(), actor);
  }

  async function getTaskTemplate(id: string, actor: TemplateActor) {
    const [t] = await withAccess([await taskTemplateOrThrow(id)], actor);
    return t!;
  }

  async function createTaskTemplate(input: TaskTemplateInput, actor: TemplateActor): Promise<TaskTemplateRecord> {
    if (!isAdmin(actor)) throw new ForbiddenError(FROM_SCRATCH_IS_ADMINS);
    return repo.createTaskTemplate(input, actor.id);
  }

  async function updateTaskTemplate(id: string, input: TaskTemplateInput, actor: TemplateActor): Promise<{ before: TaskTemplateRecord; after: TaskTemplateRecord }> {
    const before = await taskTemplateOrThrow(id);
    if (!mayChange(before, actor)) throw new ForbiddenError(NOT_YOURS);
    const after = await repo.updateTaskTemplate(id, input, actor.id);
    if (!after) throw new NotFoundError('That template no longer exists.');
    return { before, after };
  }

  async function deleteTaskTemplate(id: string, actor: TemplateActor): Promise<TaskTemplateRecord> {
    const before = await taskTemplateOrThrow(id);
    if (!mayChange(before, actor)) throw new ForbiddenError(NOT_YOURS);
    await repo.deleteTaskTemplate(id);
    return before;
  }

  /** Save a task as a template (whoever runs its project, or an administrator): its title, description, checklist and priority. */
  async function saveTaskAsTemplate(taskId: string, input: { name?: string; includeDescription?: boolean }, actor: TemplateActor): Promise<TaskTemplateRecord> {
    const task = await repo.taskSnapshot(taskId);
    if (!task || !(await deps.canViewProject(actor.id, actor.roles, task.projectId))) throw new NotFoundError('Task not found.');
    if (!(await deps.canManageProject(actor.id, actor.roles, task.projectId))) throw new ForbiddenError(SAVE_TASK_REFUSED);
    return repo.createTaskTemplate(
      {
        name: input.name?.trim() || task.title,
        title: task.title,
        description: input.includeDescription === false ? null : task.description,
        priority: task.priority,
        checklist: task.checklist.slice(0, TEMPLATE_LIMITS.checklistItems),
      },
      actor.id,
    );
  }

  return {
    listProjectTemplates,
    getProjectTemplate,
    createProjectTemplate,
    updateProjectTemplate,
    deleteProjectTemplate,
    projectDraft,
    saveProjectAsTemplate,
    planProject,
    prepareProject,
    listTaskTemplates,
    getTaskTemplate,
    createTaskTemplate,
    updateTaskTemplate,
    deleteTaskTemplate,
    saveTaskAsTemplate,
  };
}

export type TemplateService = ReturnType<typeof createTemplateService>;
