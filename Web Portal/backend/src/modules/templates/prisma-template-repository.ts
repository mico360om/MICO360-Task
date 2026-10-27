import { Prisma, type PrismaClient } from '@prisma/client';
import { newRowId } from '../../lib/row-id';
import { inChunks } from '../../lib/chunks';
import { liveTaskWhere } from '../tasks/prisma-task-repository';
import type { Priority } from '../tasks/task-repository';
import type {
  ColumnCategory,
  ProjectSnapshot,
  ProjectTemplateInput,
  ProjectTemplateRecord,
  TaskTemplateRecord,
  TemplateColumn,
  TemplateRepository,
} from './template-repository';

type Tx = Prisma.TransactionClient;

const CATEGORIES = new Set<ColumnCategory>(['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE']);
/** Writing a 500-task template is a few statements; this leaves room on a slow database. */
const TX = { timeout: 60_000, maxWait: 10_000 };

/** A stored board, read defensively (it is JSON). */
function columnsOf(value: Prisma.JsonValue): TemplateColumn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((c) => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return [];
    const { name, category, color } = c as Record<string, unknown>;
    if (typeof name !== 'string' || !CATEGORIES.has(category as ColumnCategory)) return [];
    return [{ name, category: category as ColumnCategory, color: typeof color === 'string' ? color : '#948985' }];
  });
}

function checklistOf(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const withContents = {
  roles: { orderBy: { position: 'asc' as const }, select: { id: true, name: true } },
  tasks: { orderBy: { position: 'asc' as const } },
};

type StoredTemplate = Prisma.ProjectTemplateGetPayload<{ include: typeof withContents }>;

function toProjectTemplate(t: StoredTemplate): ProjectTemplateRecord {
  const columns = columnsOf(t.columns);
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    columns,
    roles: t.roles.map((r) => ({ id: r.id, name: r.name })),
    tasks: t.tasks.map((x) => ({
      id: x.id,
      title: x.title,
      description: x.description,
      priority: x.priority as Priority,
      dueOffsetDays: x.dueOffsetDays,
      roleId: x.roleId,
      checklist: checklistOf(x.checklist),
    })),
    columnCount: columns.length,
    roleCount: t.roles.length,
    taskCount: t.tasks.length,
    createdById: t.createdById,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function toTaskTemplate(t: { id: string; name: string; title: string; description: string | null; priority: string; checklist: Prisma.JsonValue; createdById: string | null; createdAt: Date; updatedAt: Date }): TaskTemplateRecord {
  return { id: t.id, name: t.name, title: t.title, description: t.description, priority: t.priority as Priority, checklist: checklistOf(t.checklist), createdById: t.createdById, createdAt: t.createdAt, updatedAt: t.updatedAt };
}

/**
 * A template's roles and tasks, written whole: a role whose key is one of `keep` (this template's own
 * role ids) keeps its id and is renamed or moved; other roles are new; roles left out go. The tasks
 * are replaced. Called inside the transaction that also writes the template itself.
 */
async function writeContents(tx: Tx, templateId: string, input: ProjectTemplateInput, keep: Set<string>): Promise<void> {
  await tx.projectTemplateTask.deleteMany({ where: { templateId } });
  const roleIds = new Map<string, string>();
  const fresh: { id: string; templateId: string; name: string; position: number }[] = [];
  for (const [position, r] of input.roles.entries()) {
    if (keep.has(r.key)) {
      roleIds.set(r.key, r.key);
      await tx.projectTemplateRole.update({ where: { id: r.key }, data: { name: r.name, position } });
    } else {
      const id = newRowId();
      roleIds.set(r.key, id);
      fresh.push({ id, templateId, name: r.name, position });
    }
  }
  await tx.projectTemplateRole.deleteMany({ where: { templateId, id: { notIn: [...roleIds.values()] } } });
  if (fresh.length) await tx.projectTemplateRole.createMany({ data: fresh });
  await inChunks(
    input.tasks.map((t, position) => ({
      id: newRowId(),
      templateId,
      position,
      title: t.title,
      description: t.description,
      priority: t.priority,
      dueOffsetDays: t.dueOffsetDays,
      roleId: t.roleKey ? roleIds.get(t.roleKey) ?? null : null,
      checklist: t.checklist as Prisma.InputJsonValue,
    })),
    (data) => tx.projectTemplateTask.createMany({ data }),
  );
}

/** The number at the end of a task key (RIG-12 → 12), for putting a project's tasks in the order they were added. */
const keyNumber = (key: string) => Number(/-(\d+)$/.exec(key)?.[1] ?? Number.MAX_SAFE_INTEGER);

export function createPrismaTemplateRepository(prisma: PrismaClient): TemplateRepository {
  const read = async (db: Tx | PrismaClient, id: string) => {
    const t = await db.projectTemplate.findUnique({ where: { id }, include: withContents });
    return t ? toProjectTemplate(t) : null;
  };

  return {
    async listProjectTemplates() {
      const rows = await prisma.projectTemplate.findMany({
        orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, description: true, columns: true, createdById: true, createdAt: true, updatedAt: true, _count: { select: { roles: true, tasks: true } } },
      });
      return rows.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        columnCount: columnsOf(t.columns).length,
        roleCount: t._count.roles,
        taskCount: t._count.tasks,
        createdById: t.createdById,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
    },
    async findProjectTemplate(id) {
      return read(prisma, id);
    },
    async createProjectTemplate(input, actorId) {
      return prisma.$transaction(async (tx) => {
        const t = await tx.projectTemplate.create({
          data: { name: input.name, description: input.description, columns: input.columns as unknown as Prisma.InputJsonValue, createdById: actorId, updatedById: actorId },
        });
        await writeContents(tx, t.id, input, new Set());
        return (await read(tx, t.id))!;
      }, TX);
    },
    async updateProjectTemplate(id, input, actorId) {
      return prisma.$transaction(async (tx) => {
        const before = await tx.projectTemplate.findUnique({ where: { id }, select: { roles: { select: { id: true } } } });
        if (!before) return null;
        await tx.projectTemplate.update({
          where: { id },
          data: { name: input.name, description: input.description, columns: input.columns as unknown as Prisma.InputJsonValue, updatedById: actorId },
        });
        await writeContents(tx, id, input, new Set(before.roles.map((r) => r.id)));
        return read(tx, id);
      }, TX);
    },
    async deleteProjectTemplate(id) {
      // Its roles and tasks go with it (cascade); projects made from it keep no link to it.
      const { count } = await prisma.projectTemplate.deleteMany({ where: { id } });
      return count > 0;
    },
    async listTaskTemplates() {
      return (await prisma.taskTemplate.findMany({ orderBy: [{ name: 'asc' }, { createdAt: 'asc' }] })).map(toTaskTemplate);
    },
    async findTaskTemplate(id) {
      const t = await prisma.taskTemplate.findUnique({ where: { id } });
      return t ? toTaskTemplate(t) : null;
    },
    async createTaskTemplate(input, actorId) {
      return toTaskTemplate(
        await prisma.taskTemplate.create({
          data: { name: input.name, title: input.title, description: input.description, priority: input.priority, checklist: input.checklist, createdById: actorId, updatedById: actorId },
        }),
      );
    },
    async updateTaskTemplate(id, input, actorId) {
      const { count } = await prisma.taskTemplate.updateMany({
        where: { id },
        data: { name: input.name, title: input.title, description: input.description, priority: input.priority, checklist: input.checklist, updatedById: actorId },
      });
      if (count === 0) return null;
      return toTaskTemplate(await prisma.taskTemplate.findUniqueOrThrow({ where: { id } }));
    },
    async deleteTaskTemplate(id) {
      const { count } = await prisma.taskTemplate.deleteMany({ where: { id } });
      return count > 0;
    },
    async projectSnapshot(projectId): Promise<ProjectSnapshot | null> {
      const p = await prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: {
          id: true,
          name: true,
          startDate: true,
          createdAt: true,
          columns: { where: { enabled: true }, orderBy: { position: 'asc' }, select: { name: true, category: true, color: true } },
        },
      });
      if (!p) return null;
      const rows = await prisma.task.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true,
          key: true,
          title: true,
          description: true,
          priority: true,
          dueDate: true,
          createdAt: true,
          recurrenceParentId: true,
          assignees: { orderBy: { assignedAt: 'asc' }, select: { userId: true } },
          checklist: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { text: true } },
        },
      });
      // In the order they were added (their key numbers); a repeating series once, as its first live copy.
      rows.sort((a, b) => keyNumber(a.key) - keyNumber(b.key) || a.createdAt.getTime() - b.createdAt.getTime());
      const series = new Set<string>();
      const tasks: ProjectSnapshot['tasks'] = [];
      for (const t of rows) {
        const seriesId = t.recurrenceParentId ?? t.id;
        if (series.has(seriesId)) continue;
        series.add(seriesId);
        tasks.push({
          id: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority as Priority,
          dueDate: t.dueDate,
          assigneeIds: t.assignees.map((a) => a.userId),
          checklist: t.checklist.map((c) => c.text),
        });
      }
      return {
        id: p.id,
        name: p.name,
        startDate: p.startDate,
        createdAt: p.createdAt,
        columns: p.columns.map((c) => ({ name: c.name, category: c.category as ColumnCategory, color: c.color })),
        tasks,
      };
    },
    async taskSnapshot(taskId) {
      const t = await prisma.task.findFirst({
        where: { id: taskId, ...liveTaskWhere },
        select: { id: true, projectId: true, title: true, description: true, priority: true, checklist: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { text: true } } },
      });
      return t ? { id: t.id, projectId: t.projectId, title: t.title, description: t.description, priority: t.priority as Priority, checklist: t.checklist.map((c) => c.text) } : null;
    },
  };
}
