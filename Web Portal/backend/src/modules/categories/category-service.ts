import type { Prisma, PrismaClient, ProjectCategory } from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/http-errors';
import { noteActivity, type RecordTaskActivity } from '../activity/task-activity';
import { storedCategoryKey } from './category-store';
import {
  checkCategoryName,
  isCategoryColor,
  nextCategoryColor,
  CATEGORY_WORDS,
  MAX_PROJECT_CATEGORIES,
  MAX_TASK_CATEGORIES,
} from '../tasks/task-categories';

/**
 * 1.24 Task categories: each project's own list (name + one of 12 colours, in order) and a task's categories.
 * Admins and the project's managers look after the list (the routes check who); a task's categories are
 * set by whoever may edit the task. A category used by a task — a Recycle Bin task too (not a merged one) —
 * can only be retired, never deleted, so a restore brings its categories back.
 */
export const CATEGORY_CODES = {
  duplicate: 'CATEGORY_DUPLICATE',
  inUse: 'CATEGORY_IN_USE',
  required: 'CATEGORY_REQUIRED',
  /** "Every task needs a category" with no category in use: nobody could add a task. */
  noneActive: 'CATEGORY_NONE_ACTIVE',
} as const;

/** The project needs a category on every task, so it must keep one in use. */
const NONE_ACTIVE = 'This project needs a category on every task, so it must keep at least one category in use. Add another first, or turn off “Every task needs a category”.';

export interface CategoryRecord {
  id: string;
  projectId: string;
  name: string;
  color: string;
  position: number;
  retired: boolean;
  retiredAt: Date | null;
  /** Tasks that have it: live ones and the Recycle Bin's (the settings list, for "can't delete"). */
  taskCount?: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

const toRecord = (c: ProjectCategory, taskCount?: number): CategoryRecord => ({
  id: c.id,
  projectId: c.projectId,
  name: c.name,
  color: c.color,
  position: c.position,
  retired: c.retiredAt !== null,
  retiredAt: c.retiredAt,
  ...(taskCount !== undefined ? { taskCount } : {}),
});

/** Tasks that count as using a category: live ones and the Recycle Bin's — not ones merged into another. */
const usingTaskWhere = { mergedIntoId: null } satisfies Prisma.TaskWhereInput;

export class CategoryRequiredError extends ValidationError {
  constructor() {
    super(CATEGORY_WORDS.pickOne, { code: CATEGORY_CODES.required });
  }
}

export interface CategoryServiceDeps {
  prisma: PrismaClient;
  recordActivity?: RecordTaskActivity;
  /** After a task's categories changed (search index, open boards). */
  onTaskChanged?: (taskId: string) => void | Promise<void>;
}

function nameOrRefuse(name: string | null | undefined): string {
  const check = checkCategoryName(name);
  if (!check.ok) throw new ValidationError(check.problem, { fields: { name: check.problem } });
  return check.name;
}

export function createCategoryService(deps: CategoryServiceDeps) {
  const { prisma } = deps;

  async function liveProject(projectId: string) {
    const p = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, requireCategory: true } });
    if (!p) throw new NotFoundError('Project not found.');
    return p;
  }

  async function categoryOrThrow(categoryId: string) {
    const c = await prisma.projectCategory.findUnique({ where: { id: categoryId } });
    if (!c) throw new NotFoundError('That category isn’t there any more.');
    return c;
  }

  /** A project's list in order (retired ones too, marked); with `usage`, how many tasks use each. */
  async function list(projectId: string, opts: { usage?: boolean } = {}): Promise<{ requireCategory: boolean; categories: CategoryRecord[] }> {
    const project = await liveProject(projectId);
    const rows = await prisma.projectCategory.findMany({
      where: { projectId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      ...(opts.usage ? { include: { _count: { select: { tasks: { where: { task: usingTaskWhere } } } } } } : {}),
    });
    return {
      requireCategory: project.requireCategory,
      categories: rows.map((r) => toRecord(r, opts.usage ? (r as ProjectCategory & { _count: { tasks: number } })._count.tasks : undefined)),
    };
  }

  /** The project id of a category (the routes check who may change it). */
  async function projectOf(categoryId: string): Promise<string> {
    return (await categoryOrThrow(categoryId)).projectId;
  }

  async function assertUniqueName(db: Db, projectId: string, name: string, exceptId?: string): Promise<void> {
    const clash = await db.projectCategory.findFirst({ where: { projectId, nameKey: storedCategoryKey(name), ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (clash) throw new ConflictError(CATEGORY_WORDS.duplicate, CATEGORY_CODES.duplicate);
  }

  /** A new category at the end of the list (a colour the project hasn't used yet when none is picked). */
  async function create(projectId: string, input: { name?: string | null; color?: string | null }, actorId: string): Promise<CategoryRecord> {
    await liveProject(projectId);
    const name = nameOrRefuse(input.name);
    if (input.color != null && !isCategoryColor(input.color)) throw new ValidationError('Pick one of the colours.');
    try {
      const made = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
        const existing = await tx.projectCategory.findMany({ where: { projectId }, select: { position: true, color: true } });
        if (existing.length >= MAX_PROJECT_CATEGORIES) throw new ConflictError(CATEGORY_WORDS.projectFull, 'TOO_MANY_CATEGORIES');
        await assertUniqueName(tx, projectId, name);
        const color = input.color ?? nextCategoryColor(existing.map((e) => e.color));
        const position = existing.reduce((top, e) => Math.max(top, e.position + 1), 0);
        return tx.projectCategory.create({ data: { projectId, name, nameKey: storedCategoryKey(name), color, position, createdById: actorId } });
      });
      return toRecord(made, 0);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictError(CATEGORY_WORDS.duplicate, CATEGORY_CODES.duplicate);
      throw err;
    }
  }

  /** Rename, recolour, retire or use again. */
  async function update(categoryId: string, input: { name?: string | null; color?: string | null; retired?: boolean }): Promise<CategoryRecord> {
    const before = await categoryOrThrow(categoryId);
    const data: Prisma.ProjectCategoryUpdateInput = {};
    if (input.name !== undefined) {
      const name = nameOrRefuse(input.name);
      await assertUniqueName(prisma, before.projectId, name, categoryId);
      data.name = name;
      data.nameKey = storedCategoryKey(name);
    }
    if (input.color !== undefined) {
      if (!isCategoryColor(input.color)) throw new ValidationError('Pick one of the colours.');
      data.color = input.color;
    }
    if (input.retired !== undefined) data.retiredAt = input.retired ? (before.retiredAt ?? new Date()) : null;
    if (input.retired === true && !before.retiredAt) await assertKeepsOneActive(before.projectId, categoryId);
    try {
      const after = await prisma.projectCategory.update({ where: { id: categoryId }, data });
      if (input.name !== undefined || input.color !== undefined) await touchTasksOf(categoryId);
      return toRecord(after);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictError(CATEGORY_WORDS.duplicate, CATEGORY_CODES.duplicate);
      throw err;
    }
  }

  /** The tasks that show a category re-read it (search index). */
  async function touchTasksOf(categoryId: string): Promise<void> {
    if (!deps.onTaskChanged) return;
    const rows = await prisma.taskCategory.findMany({ where: { categoryId, task: { deletedAt: null } }, select: { taskId: true }, take: 5000 });
    for (const r of rows) {
      try {
        await deps.onTaskChanged(r.taskId);
      } catch {
        /* the change itself is saved */
      }
    }
  }

  /** Put the list in this order (ids of other projects are ignored; ones left out keep their place after). */
  async function reorder(projectId: string, orderedIds: string[]): Promise<CategoryRecord[]> {
    await liveProject(projectId);
    const rows = await prisma.projectCategory.findMany({ where: { projectId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
    const known = new Set(rows.map((r) => r.id));
    const order = [...new Set(orderedIds.filter((id) => known.has(id))), ...rows.map((r) => r.id).filter((id) => !orderedIds.includes(id))];
    await prisma.$transaction(order.map((id, position) => prisma.projectCategory.update({ where: { id }, data: { position } })));
    return (await list(projectId)).categories;
  }

  /** Delete a category nobody uses (Recycle Bin tasks count): 409 CATEGORY_IN_USE otherwise — retire it instead. */
  async function remove(categoryId: string): Promise<void> {
    const c = await categoryOrThrow(categoryId);
    if (!c.retiredAt) await assertKeepsOneActive(c.projectId, categoryId);
    await prisma.$transaction(async (tx) => {
      const used = await tx.taskCategory.count({ where: { categoryId, task: usingTaskWhere } });
      if (used > 0) throw new ConflictError(CATEGORY_WORDS.inUse, CATEGORY_CODES.inUse);
      await tx.projectCategory.delete({ where: { id: categoryId } });
    });
  }

  /** "Every task needs a category" on or off. */
  /** A project that needs a category keeps one in use (retiring or deleting the last one is refused). */
  async function assertKeepsOneActive(projectId: string, leavingId: string): Promise<void> {
    const project = await liveProject(projectId);
    if (!project.requireCategory) return;
    const others = await prisma.projectCategory.count({ where: { projectId, retiredAt: null, id: { not: leavingId } } });
    if (others === 0) throw new ConflictError(NONE_ACTIVE, CATEGORY_CODES.noneActive);
  }

  async function setRequired(projectId: string, required: boolean): Promise<{ requireCategory: boolean }> {
    await liveProject(projectId);
    if (required && (await prisma.projectCategory.count({ where: { projectId, retiredAt: null } })) === 0) {
      throw new ConflictError('Add a category first: with none in use, nobody could add a task to this project.', CATEGORY_CODES.noneActive);
    }
    await prisma.project.update({ where: { id: projectId }, data: { requireCategory: required } });
    return { requireCategory: required };
  }

  /**
   * The categories a task may be given in this project: the project's own, not retired — except ones the task
   * has already (`keep`). Refuses an unknown or retired id, too many, and — when the project asks for one —
   * none at all (400 CATEGORY_REQUIRED).
   */
  async function checkForTask(projectId: string, ids: string[], keep: string[] = []): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_TASK_CATEGORIES) throw new ValidationError(CATEGORY_WORDS.full);
    const project = await liveProject(projectId);
    if (unique.length === 0) {
      if (project.requireCategory) throw new CategoryRequiredError();
      return [];
    }
    const rows = await prisma.projectCategory.findMany({ where: { id: { in: unique } } });
    if (rows.length !== unique.length || rows.some((r) => r.projectId !== projectId)) throw new ValidationError(CATEGORY_WORDS.wrongProject);
    if (rows.some((r) => r.retiredAt && !keep.includes(r.id))) throw new ValidationError(CATEGORY_WORDS.retiredPick);
    return unique;
  }

  /** A task's categories (its project's order). */
  async function ofTask(taskId: string): Promise<CategoryRecord[]> {
    const rows = await prisma.taskCategory.findMany({ where: { taskId }, include: { category: true } });
    return rows.map((r) => toRecord(r.category)).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }

  /** Give a task exactly these categories (history lines for each added and removed). */
  async function setForTask(taskId: string, ids: string[], actorId: string): Promise<CategoryRecord[]> {
    const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } }, select: { id: true, projectId: true } });
    if (!task) throw new NotFoundError('Task not found.');
    const before = await ofTask(taskId);
    const wanted = await checkForTask(task.projectId, ids, before.map((c) => c.id));
    const added = wanted.filter((id) => !before.some((c) => c.id === id));
    const removed = before.filter((c) => !wanted.includes(c.id));
    if (added.length === 0 && removed.length === 0) return before;
    await prisma.$transaction([
      prisma.taskCategory.deleteMany({ where: { taskId, categoryId: { in: removed.map((c) => c.id) } } }),
      prisma.taskCategory.createMany({ data: added.map((categoryId) => ({ taskId, categoryId, addedById: actorId })), skipDuplicates: true }),
    ]);
    const after = await ofTask(taskId);
    for (const c of after.filter((x) => added.includes(x.id))) await noteActivity(deps.recordActivity, { taskId, userId: actorId, action: 'CATEGORY_ADDED', meta: { name: c.name, categoryId: c.id } });
    for (const c of removed) await noteActivity(deps.recordActivity, { taskId, userId: actorId, action: 'CATEGORY_REMOVED', meta: { name: c.name, categoryId: c.id } });
    try {
      await deps.onTaskChanged?.(taskId);
    } catch {
      /* saved */
    }
    return after;
  }

  return { list, projectOf, create, update, reorder, remove, setRequired, checkForTask, ofTask, setForTask };
}

export type CategoryService = ReturnType<typeof createCategoryService>;

/** Refused: only admins and the project's managers change its categories. */
export const notManager = () => new ForbiddenError(CATEGORY_WORDS.notManager);
