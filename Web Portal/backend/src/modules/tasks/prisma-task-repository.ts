import { Prisma, type ColumnCategory, type PrismaClient, type Task } from '@prisma/client';
import {
  TaskKeyConflictError,
  TaskVersionConflictError,
  type CreateTaskData,
  type ProjectLookup,
  type TaskRecord,
  type TaskRepository,
  type UpdateTaskData,
} from './task-repository';
import type { RecurrenceRule } from './recurrence';
import type { MonthWindow } from './month-list';
import type { CarryForwardRepo } from './carry-forward-service';
import type { CarryLogEntry } from './board-date';
import { paletteColorFor } from './tag-repository';
import { highestKeyNumberIn } from './task-keys';
import { summarizeExternalContacts } from './external-contacts';
import { toExternalContactRecord } from './prisma-external-contact-repository';
import { LIVE_PROJECT_WHERE } from '../companies/company-access';
import { currentAcceptance } from '../clients/sign-off';
import { checklistTreeOf, leafCounts } from './checklist-tree';
import { rowsFromTree } from './checklist-service';

type TagRelation = { tag: { id: string; name: string; color: string } };
type AssigneeRelation = { user: { id: string; username: string; firstName: string | null; lastName: string | null } };
// 1.23.1: a merged task's merge columns aren't read here (merged tasks aren't live tasks).
type EnrichedTask = Omit<Task, 'carryForwardLog' | 'mergedIntoId' | 'mergedAt' | 'mergedById' | 'mergeId' | 'reminderScheduleId'> & {
  /** Absent on list rows — the carry-forward history is only returned for a single task. */
  carryForwardLog?: Prisma.JsonValue;
  /** Its old keys (a single task only). */
  keyAliases?: { key: string }[];
  column?: { category: string; enabled?: boolean } | null;
  tags?: TagRelation[];
  assignees?: AssigneeRelation[];
  checklist?: { id: string; parentId: string | null; done: boolean }[];
  _count?: { comments: number; attachments: number };
  /** Its external contacts, in order: names and companies on list rows, every field for a single task. */
  externalContacts?: { name: string; company: string | null }[];
};
const displayName = (u: AssigneeRelation['user']): string => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;

function toRecord(t: EnrichedTask): TaskRecord {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    description: t.description,
    projectId: t.projectId,
    columnId: t.columnId,
    columnCategory: t.column?.category ?? null,
    // Switched off in Manage columns: the task isn't on its project's board (nor the combined one).
    columnHidden: t.column ? t.column.enabled === false : undefined,
    tags: t.tags ? t.tags.map((tt) => ({ id: tt.tag.id, name: tt.tag.name, color: tt.tag.color })) : undefined,
    position: t.position,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    estimatedHours: t.estimatedHours,
    actualHours: t.actualHours,
    progress: t.progress,
    isMilestone: t.isMilestone ?? false,
    weight: t.weight ?? null,
    clientVisible: t.clientVisible ?? false,
    // 1.23: its description shows in the Client portal too; a client's sign-off of this finish.
    clientShowDescription: t.clientShowDescription ?? false,
    clientAcceptedAt: currentAcceptance({ columnCategory: t.column?.category ?? null, completedAt: t.completedAt, approvalRequestedAt: t.approvalRequestedAt ?? null, clientAcceptedAt: t.clientAcceptedAt ?? null }),
    createdById: t.createdById,
    completedAt: t.completedAt,
    boardDate: t.boardDate ?? null,
    ...(t.carryForwardLog !== undefined ? { carryForwardLog: (t.carryForwardLog as unknown as CarryLogEntry[] | null) ?? null } : {}),
    recurrenceRule: (t.recurrenceRule as unknown as RecurrenceRule | null) ?? null,
    recurrenceParentId: t.recurrenceParentId,
    meetingId: t.meetingId ?? null,
    inspectionFormId: t.inspectionFormId ?? null,
    inspectionPlace: t.inspectionPlace ?? null,
    needsApproval: t.needsApproval ?? false,
    approvalRequestedAt: t.approvalRequestedAt ?? null,
    approvalRequestedById: t.approvalRequestedById ?? null,
    approvedAt: t.approvedAt ?? null,
    approvedById: t.approvedById ?? null,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    ...(t.assignees ? { assignees: t.assignees.map((a) => ({ id: a.user.id, name: displayName(a.user) })) } : {}),
    ...(t._count || t.checklist
      ? {
          counts: {
            comments: t._count?.comments ?? 0,
            attachments: t._count?.attachments ?? 0,
            // 1.23.3: the real to-do items only (no sub-items), so a card's 8/12 is never double-counted.
            checklistDone: leafCounts(t.checklist ?? []).done,
            checklistTotal: leafCounts(t.checklist ?? []).total,
          },
        }
      : {}),
    ...(t.externalContacts ? { externalSummary: summarizeExternalContacts(t.externalContacts) } : {}),
  };
}

/** Live tasks only: not deleted, and not in a deleted project. */
export const liveTaskWhere = { deletedAt: null, project: { is: { deletedAt: null } } } satisfies Prisma.TaskWhereInput;

/**
 * Month view (month-list.ts): the tasks that may show in a month's window — completed in it (a Done
 * task with no completion time: changed in it), open and running into it (started before its end, due
 * after its start or not at all), open and due in it, open and overdue before it (the current month
 * only), and open ones with no dates (the "No date" chip). Wider than the rule; never narrower.
 */
export function monthWindowWhere(w: MonthWindow): Prisma.TaskWhereInput {
  const open: Prisma.TaskWhereInput = { completedAt: null, column: { is: { category: { not: 'DONE' } } } };
  return {
    OR: [
      { completedAt: { gte: w.from, lt: w.to } },
      { completedAt: null, column: { is: { category: 'DONE' } }, updatedAt: { gte: w.from, lt: w.to } },
      { ...open, startDate: { lt: w.to }, OR: [{ dueDate: null }, { dueDate: { gte: w.from } }] },
      { ...open, dueDate: { gte: w.from, lt: w.to } },
      ...(w.carry ? [{ ...open, dueDate: { lt: w.to } }] : []),
      { ...open, startDate: null, dueDate: null },
    ],
  };
}

/** True for a unique-constraint violation on the task key (a concurrent create took it). */
export function isTaskKeyConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  // MySQL reports the index name, and every unique index is named …_key — so rule the others out.
  if (/recurrenceSourceId/i.test(text)) return false;
  return /key/i.test(text);
}

/**
 * The highest key number a project has used (0 for none): its tasks' keys — every task ever created
 * in it or moved into it, deleted ones too — and the old keys of tasks that moved out. The next key is
 * this + 1. The highest, not a count: a gap (a number a create or move skipped) never makes the next
 * one collide, and a fresh read after losing a race to another task gives exactly the next number.
 * The keys are compared as numbers here (task-keys), not in SQL, so MySQL and PostgreSQL agree.
 */
export async function highestKeyNumber(db: Pick<PrismaClient, 'task' | 'taskKeyAlias'> | Prisma.TransactionClient, projectId: string): Promise<number> {
  const [tasks, oldKeys] = await Promise.all([
    db.task.findMany({ where: { projectId }, select: { key: true } }),
    db.taskKeyAlias.findMany({ where: { projectId }, select: { key: true } }),
  ]);
  return highestKeyNumberIn([...tasks, ...oldKeys].map((k) => k.key));
}

/** True when `key` was a task's key before it moved project: it is never given to another task. */
export async function isOldKey(db: Pick<PrismaClient, 'taskKeyAlias'> | Prisma.TransactionClient, key: string): Promise<boolean> {
  return (await db.taskKeyAlias.findUnique({ where: { key }, select: { id: true } })) !== null;
}

/** `code-n` for the first n from `from` up that isn't an old key (a guard: old keys are counted already). */
export async function firstFreeKey(db: Pick<PrismaClient, 'taskKeyAlias'> | Prisma.TransactionClient, code: string, from: number): Promise<string> {
  for (let n = from; ; n++) {
    const key = `${code}-${n}`;
    if (!(await isOldKey(db, key))) return key;
  }
}

/** True for a unique-constraint violation on a recurring copy's source: that task already has its next copy. */
export function isRecurrenceCopyConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  return /recurrenceSourceId/i.test(Array.isArray(target) ? target.join(',') : String(target ?? ''));
}

// Every scalar except the carry-forward history, which can grow long and is left out of lists.
const listScalars = {
  id: true, key: true, title: true, description: true, projectId: true, columnId: true, position: true,
  priority: true, startDate: true, dueDate: true, estimatedHours: true, actualHours: true, progress: true, isMilestone: true, weight: true,
  clientVisible: true, createdById: true, completedAt: true, boardDate: true, recurrenceRule: true, recurrenceParentId: true, recurrenceSourceId: true,
  meetingId: true, inspectionFormId: true, inspectionPlace: true, version: true, createdAt: true, updatedAt: true, deletedAt: true,
  needsApproval: true, approvalRequestedAt: true, approvalRequestedById: true, approvedAt: true, approvedById: true,
  clientShowDescription: true, clientAcceptedAt: true, clientAcceptedById: true,
} as const;

export function createPrismaTaskRepository(prisma: PrismaClient): TaskRepository {
  // Always join the column's category (Kanban stage) and the task's tags so every
  // task payload carries them (used for status classification, tag filtering + display).
  const withColumn = {
    column: { select: { category: true, enabled: true } },
    tags: { include: { tag: true } },
    // Its external contacts in short (the card line, search and the company filter).
    externalContacts: { select: { name: true, company: true }, orderBy: { position: 'asc' } },
  } as const;
  const contactsInFull = { orderBy: { position: 'asc' } } as const;
  return {
    async create(data: CreateTaskData) {
      const tagNames = data.tagNames ?? [];
      const assigneeIds = [...new Set(data.assigneeIds ?? [])];
      // 1.23.3: its checklists (the tree the New task form and templates send; an old flat list is one "Checklist").
      const tree = data.checklists ?? checklistTreeOf(data.checklist ?? []);
      const externalContacts = data.externalContacts ?? [];
      // A key a task had before it moved project still finds that task: never give it to another one.
      if (await isOldKey(prisma, data.key)) throw new TaskKeyConflictError(data.key);
      try {
        // Task, tags, assignees and checklist are one nested write — all of it lands or none of it does.
        const write = (db: Pick<PrismaClient, 'task'>) => db.task.create({
          include: withColumn,
          data: {
            key: data.key,
            title: data.title,
            projectId: data.projectId,
            columnId: data.columnId,
            createdById: data.createdById,
            description: data.description ?? undefined,
            priority: data.priority ?? undefined,
            startDate: data.startDate ?? undefined,
            dueDate: data.dueDate ?? undefined,
            estimatedHours: data.estimatedHours ?? undefined,
            progress: data.progress ?? undefined,
            isMilestone: data.isMilestone ?? undefined,
            weight: data.weight ?? undefined,
            completedAt: data.completedAt ?? undefined,
            boardDate: data.boardDate ?? undefined,
            recurrenceRule: (data.recurrenceRule ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
            recurrenceParentId: data.recurrenceParentId ?? undefined,
            meetingId: data.meetingId ?? undefined,
            inspectionFormId: data.inspectionFormId ?? undefined,
            inspectionPlace: data.inspectionPlace ?? undefined,
            needsApproval: data.needsApproval ?? undefined,
            approvalRequestedAt: data.approvalRequestedAt ?? undefined,
            approvalRequestedById: data.approvalRequestedById ?? undefined,
            approvedAt: data.approvedAt ?? undefined,
            approvedById: data.approvedById ?? undefined,
            ...(tagNames.length
              ? {
                  tags: {
                    create: tagNames.map((name) => ({
                      tag: { connectOrCreate: { where: { name }, create: { name, color: paletteColorFor(name) } } },
                    })),
                  },
                }
              : {}),
            ...(assigneeIds.length ? { assignees: { create: assigneeIds.map((userId) => ({ userId })) } } : {}),
            ...(externalContacts.length
              ? { externalContacts: { create: externalContacts.map((c, position) => ({ ...c, position, createdById: data.createdById })) } }
              : {}),
          },
        });
        if (tree.length === 0) return toRecord(await write(prisma));
        // With its checklists, one transaction: all of it lands or none of it does.
        const t = await prisma.$transaction(async (tx) => {
          const made = await write(tx);
          const rows = rowsFromTree(made.id, tree, data.createdById, new Date());
          await tx.checklistList.createMany({ data: rows.lists });
          if (rows.items.length) await tx.checklistItem.createMany({ data: rows.items });
          return made;
        });
        return toRecord(t);
      } catch (err) {
        if (isTaskKeyConflict(err)) throw new TaskKeyConflictError(data.key);
        throw err;
      }
    },
    async findById(id) {
      const t = await prisma.task.findFirst({
        where: { id, ...liveTaskWhere },
        include: { ...withColumn, externalContacts: contactsInFull, keyAliases: { select: { key: true }, orderBy: { createdAt: 'asc' } } },
      });
      if (!t) return null;
      // Only a series member can have a next copy. Deleted copies count: a skipped one still means
      // this task's next copy was made (and the unique source guard would refuse another).
      const next = t.recurrenceParentId
        ? await prisma.task.findFirst({ where: { recurrenceSourceId: id }, select: { id: true } })
        : null;
      return {
        ...toRecord(t),
        recurrenceNextId: next?.id ?? null,
        formerKeys: (t.keyAliases ?? []).map((a) => a.key),
        externalContacts: (t.externalContacts ?? []).map(toExternalContactRecord),
      };
    },
    async list(filter) {
      const and: Prisma.TaskWhereInput[] = [];
      if (filter.projectId) and.push({ projectId: filter.projectId });
      if (filter.projectIds) and.push({ projectId: { in: filter.projectIds } });
      if (filter.columnId) and.push({ columnId: filter.columnId });
      if (filter.assigneeId) and.push({ assignees: { some: { userId: filter.assigneeId } } });
      if (filter.boardDate) and.push({ boardDate: filter.boardDate });
      if (filter.priorities?.length) and.push({ priority: { in: filter.priorities as Task['priority'][] } });
      if (filter.categories?.length) and.push({ column: { category: { in: filter.categories as ColumnCategory[] } } });
      if (filter.tagIds?.length) and.push({ tags: { some: { tagId: { in: filter.tagIds } } } });
      if (filter.dueBefore) and.push({ dueDate: { lte: filter.dueBefore } });
      if (filter.dueAfter) and.push({ dueDate: { gte: filter.dueAfter } });
      if (filter.startBefore) and.push({ startDate: { lte: filter.startBefore } });
      if (filter.startAfter) and.push({ startDate: { gte: filter.startAfter } });
      if (filter.recurring) and.push({ recurrenceRule: { not: Prisma.DbNull } });
      if (filter.awaitingApproval) and.push({ approvalRequestedAt: { not: null } });
      if (filter.month) and.push(monthWindowWhere(filter.month));
      const ts = await prisma.task.findMany({
        where: { ...liveTaskWhere, AND: and },
        // Enrich list rows for card display: assignees + lightweight aggregate counts. `_count`
        // + a `select`-only checklist keep this a single query (no N+1) with minimal payload.
        select: {
          ...listScalars,
          ...withColumn,
          assignees: { select: { user: { select: { id: true, username: true, firstName: true, lastName: true } } } },
          checklist: { where: { deletedAt: null }, select: { id: true, parentId: true, done: true } },
          _count: { select: { comments: true, attachments: true } },
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      return ts.map(toRecord);
    },
    async update(id, patch: UpdateTaskData, opts) {
      const { recurrenceRule, carryForwardLog, ...rest } = patch;
      const data: Prisma.TaskUpdateInput = { ...rest, version: { increment: 1 } };
      if (recurrenceRule !== undefined) {
        // A nullable Json column needs Prisma's DbNull sentinel to store SQL NULL.
        data.recurrenceRule = recurrenceRule === null ? Prisma.DbNull : (recurrenceRule as unknown as Prisma.InputJsonValue);
      }
      if (carryForwardLog !== undefined) {
        data.carryForwardLog = carryForwardLog === null ? Prisma.DbNull : (carryForwardLog as unknown as Prisma.InputJsonValue);
      }
      if (opts?.expectedVersion !== undefined) {
        // One conditional statement: only the edit made from the current version is saved.
        const { count } = await prisma.task.updateMany({ where: { id, version: opts.expectedVersion }, data: data as Prisma.TaskUncheckedUpdateManyInput });
        if (count === 0) throw new TaskVersionConflictError(id);
        return toRecord(await prisma.task.findUniqueOrThrow({ where: { id }, include: withColumn }));
      }
      const t = await prisma.task.update({ where: { id }, data, include: withColumn });
      return toRecord(t);
    },
    async softDelete(id) {
      await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
    },
    async updateSeries(seriesId, patch, opts = {}) {
      // One atomic UPDATE over the series members — no full-table scan, no loop.
      const { recurrenceRule, carryForwardLog, ...rest } = patch;
      const data: Prisma.TaskUpdateManyMutationInput = { ...rest, version: { increment: 1 } };
      if (recurrenceRule !== undefined) {
        data.recurrenceRule = recurrenceRule === null ? Prisma.DbNull : (recurrenceRule as unknown as Prisma.InputJsonValue);
      }
      if (carryForwardLog !== undefined) {
        data.carryForwardLog = carryForwardLog === null ? Prisma.DbNull : (carryForwardLog as unknown as Prisma.InputJsonValue);
      }
      await prisma.task.updateMany({
        where: {
          deletedAt: null,
          OR: [{ id: seriesId }, { recurrenceParentId: seriesId }],
          ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
          ...(opts.openOnly ? { completedAt: null, column: { category: { not: 'DONE' } } } : {}),
        },
        data,
      });
    },
    async softDeleteSeries(seriesId) {
      await prisma.task.updateMany({
        where: { deletedAt: null, OR: [{ id: seriesId }, { recurrenceParentId: seriesId }] },
        data: { deletedAt: new Date() },
      });
    },
    async countByProject(projectId) {
      // The highest number used — deleted tasks and old keys of tasks moved away too — so keys never repeat.
      return highestKeyNumber(prisma, projectId);
    },
    async findColumn(columnId) {
      const c = await prisma.kanbanColumn.findUnique({ where: { id: columnId }, select: { id: true, projectId: true, category: true } });
      return c ?? null;
    },
    async reorderInColumn(columnId, orderedIds) {
      // Scoped to live tasks of this column, so stray ids (other columns/projects, deleted tasks)
      // are ignored. Position isn't content, so the version stays put (no false edit conflicts).
      await prisma.$transaction(
        orderedIds.map((id, index) =>
          prisma.task.updateMany({ where: { id, columnId, deletedAt: null }, data: { position: index } }),
        ),
      );
    },
  };
}

/** Prisma-backed data access for the daily carry-forward sweep (per-date boards). */
export function createPrismaCarryForwardRepo(prisma: PrismaClient): CarryForwardRepo {
  return {
    async listCarryCandidates(beforeAnchor) {
      const ts = await prisma.task.findMany({
        where: {
          deletedAt: null,
          // Live projects that carry forward: one switched off keeps its tasks on their days. The
          // setting is read at each sweep, so a project switched back on carries on the next night.
          // 1.22: an archived project (its own status, or all its companies) is read-only — skipped.
          project: { is: { deletedAt: null, carryForward: true, ...LIVE_PROJECT_WHERE } },
          completedAt: null,
          boardDate: { lt: beforeAnchor },
          column: { category: { not: 'DONE' } },
        },
        select: { id: true, completedAt: true, boardDate: true, column: { select: { category: true } }, project: { select: { carryForward: true } } },
      });
      return ts.map((t) => ({
        id: t.id,
        columnCategory: t.column.category,
        completedAt: t.completedAt,
        boardDate: t.boardDate!,
        projectCarryForward: t.project.carryForward,
      }));
    },
    async applyCarry(id, toAnchor, entry) {
      // Read-modify-write the append-only JSON history, then move the board day. The nightly
      // move is bookkeeping, not an edit, so it keeps the task's updatedAt.
      const cur = await prisma.task.findUnique({ where: { id }, select: { carryForwardLog: true, updatedAt: true } });
      if (!cur) return;
      const log = Array.isArray(cur.carryForwardLog) ? (cur.carryForwardLog as unknown[]) : [];
      await prisma.task.update({
        where: { id },
        data: { boardDate: toAnchor, carryForwardLog: [...log, entry] as unknown as Prisma.InputJsonValue, updatedAt: cur.updatedAt },
      });
    },
  };
}

export function createPrismaProjectLookup(prisma: PrismaClient): ProjectLookup {
  return {
    async getCodeById(id) {
      const p = await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { code: true } });
      return p?.code ?? null;
    },
    async getTaskSettings(id) {
      return prisma.project.findFirst({ where: { id, deletedAt: null }, select: { defaultDueToday: true, newTasksNeedApproval: true } });
    },
  };
}
