import { Prisma, type PrismaClient } from '@prisma/client';
import { isTaskDone } from '../tasks/task-status';
import { managedProjectsWhere } from '../projects/project-managers';
import { nameVariants, type PersonName } from '../client-view/client-minutes-content';
import type { RecordTaskActivity } from '../activity/task-activity';
import type { CreateAuditData } from '../audit/audit-repository';
import type { TaskRecord } from '../tasks/task-repository';
import type { RecurrenceRule } from '../tasks/recurrence';
import type { InspectionPorts } from './inspection-service';

export interface InspectionPortDeps {
  prisma: PrismaClient;
  access: {
    canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
    canViewTask(userId: string, roles: string[], taskId: string): Promise<boolean>;
  };
  authz: { canManageProject(userId: string, roles: string[], projectId: string): Promise<boolean> };
  tasks: {
    createTask(input: { title: string; description: string; projectId: string; columnId: string; createdById: string; assigneeIds: string[] }): Promise<TaskRecord>;
    /** The task service's move (the normal status path: history, notices, watchers, the next repeat copy). */
    moveTask?(id: string, columnId: string, position?: number, actorId?: string): Promise<TaskRecord>;
    getTask?(id: string): Promise<TaskRecord>;
  };
  /**
   * What an edit does after it is saved (the task service's onUpdated: its history line). A schedule
   * stopped by deleting its form gets the same line as one a person stopped.
   */
  onTaskUpdated?: (before: TaskRecord, after: TaskRecord, actorId: string) => Promise<void>;
  columns: { listColumns(projectId: string): Promise<Array<{ id: string; position: number; enabled: boolean; category: string }>> };
  assignees: {
    eligibleAssignees(projectId: string, userIds: string[]): Promise<string[]>;
    assertAssignable(projectId: string, userIds: string[]): Promise<string[]>;
    notifyAssigned(taskId: string, userIds: string[], actorId?: string): Promise<void>;
  };
  /** Tells the project's open boards about a new task. */
  broadcast: (projectId: string, event: string, payload: unknown) => void;
  userNames: (ids: string[]) => Promise<Map<string, string>>;
  recordActivity?: RecordTaskActivity;
  audit?: { record(entry: CreateAuditData): Promise<unknown> };
  cleanSignature?: (png: Buffer) => Promise<Buffer | null>;
  logger?: { warn(msg: string, ctx?: Record<string, unknown>): void };
}

/** The inspection service's view of the rest of the app, in the database and the existing services. */
export function createInspectionPorts(d: InspectionPortDeps): InspectionPorts {
  const { prisma } = d;
  const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;
  async function doneColumnOf(projectId: string): Promise<string | null> {
    const cols = (await d.columns.listColumns(projectId)).filter((c) => c.category === 'DONE').sort(byPosition);
    return (cols.find((c) => c.enabled) ?? cols[0])?.id ?? null;
  }
  return {
    canViewProject: (u, r, p) => d.access.canViewProject(u, r, p),
    canManageProject: (u, r, p) => d.authz.canManageProject(u, r, p),
    async runsAnyProject(userId) {
      return (await prisma.project.count({ where: { deletedAt: null, ...managedProjectsWhere(userId) } })) > 0;
    },
    async project(projectId) {
      return prisma.project.findFirst({
        where: { id: projectId, deletedAt: null },
        select: { name: true, code: true, number: true, clientName: true, color: true, icon: true, imageUrl: true, status: true, ownerId: true },
      });
    },
    async task(taskId) {
      const t = await prisma.task.findFirst({
        where: { id: taskId, deletedAt: null, project: { is: { deletedAt: null } } },
        select: { id: true, key: true, title: true, projectId: true, completedAt: true, inspectionFormId: true, inspectionPlace: true, column: { select: { category: true } } },
      });
      return t
        ? { id: t.id, key: t.key, title: t.title, projectId: t.projectId, done: isTaskDone({ completedAt: t.completedAt, columnCategory: t.column?.category ?? null }), inspectionFormId: t.inspectionFormId, inspectionPlace: t.inspectionPlace }
        : null;
    },
    async taskSummaries(ids) {
      const rows = await prisma.task.findMany({
        where: { id: { in: ids } },
        select: { id: true, key: true, title: true, projectId: true, deletedAt: true, completedAt: true, dueDate: true, inspectionFormId: true, column: { select: { category: true } } },
      });
      return new Map(
        rows.map((t) => [
          t.id,
          {
            key: t.key,
            title: t.title,
            projectId: t.projectId,
            deleted: t.deletedAt !== null,
            done: isTaskDone({ completedAt: t.completedAt, columnCategory: t.column?.category ?? null }),
            dueDate: t.dueDate,
            completedAt: t.completedAt,
            inspectionFormId: t.inspectionFormId,
          },
        ]),
      );
    },
    canViewTask: (u, r, t) => d.access.canViewTask(u, r, t),
    doneColumnOf,
    async completeTask(taskId, actorId) {
      if (!d.tasks.moveTask) return false;
      const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { projectId: true, completedAt: true, column: { select: { category: true } } } });
      if (!t || isTaskDone({ completedAt: t.completedAt, columnCategory: t.column?.category ?? null })) return false;
      const done = await doneColumnOf(t.projectId);
      if (!done) return false;
      // As a card moved to Done on the board: the same service call, and open boards are told.
      const moved = await d.tasks.moveTask(taskId, done, undefined, actorId);
      d.broadcast(moved.projectId, 'task:moved', moved);
      return true;
    },
    async deleteFormStoppingSchedules(formId, actorId) {
      // One transaction: the form is deleted and every schedule using it stops (its repeat cleared, as
      // a person stopping it does) — or neither happens.
      const stopped = await prisma.$transaction(async (tx) => {
        const { count } = await tx.inspectionForm.updateMany({ where: { id: formId, deletedAt: null }, data: { deletedAt: new Date() } });
        if (count === 0) return null;
        const heads = await tx.task.findMany({ where: { inspectionFormId: formId, deletedAt: null, NOT: [{ recurrenceRule: { equals: Prisma.DbNull } }] }, select: { id: true, recurrenceRule: true } });
        if (heads.length) await tx.task.updateMany({ where: { id: { in: heads.map((h) => h.id) } }, data: { recurrenceRule: Prisma.DbNull, version: { increment: 1 } } });
        return heads;
      });
      if (!stopped) return { deleted: false, schedulesStopped: 0 };
      // Then what saving the edit does: the history line ("stopped the repeat"), and open boards.
      for (const h of stopped) {
        try {
          const after = d.tasks.getTask ? await d.tasks.getTask(h.id) : null;
          if (!after) continue;
          const before: TaskRecord = { ...after, recurrenceRule: h.recurrenceRule as unknown as RecurrenceRule, version: after.version - 1 };
          await d.onTaskUpdated?.(before, after, actorId);
          d.broadcast(after.projectId, 'task:updated', after);
        } catch (err) {
          d.logger?.warn('inspections: a stopped schedule could not be announced', { err, taskId: h.id });
        }
      }
      return { deleted: true, schedulesStopped: stopped.length };
    },
    async defaultAssignees(projectId) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true } });
      return p?.ownerId ? d.assignees.eligibleAssignees(projectId, [p.ownerId]) : [];
    },
    assertAssignable: (projectId, ids) => d.assignees.assertAssignable(projectId, ids),
    async createTask(input) {
      // The board's first open stage (not a Done one), as a task added from a meeting note lands.
      const cols = [...(await d.columns.listColumns(input.projectId))].sort(byPosition);
      const column = cols.find((c) => c.enabled && c.category !== 'DONE') ?? cols.find((c) => c.enabled) ?? cols[0];
      if (!column) throw new Error('That project has no columns to place the task in.');
      const task = await d.tasks.createTask({ ...input, columnId: column.id });
      if (input.assigneeIds.length) await d.assignees.notifyAssigned(task.id, input.assigneeIds, input.createdById).catch((err) => d.logger?.warn('inspections: assignees could not be told', { err }));
      d.broadcast(task.projectId, 'task:created', task);
      return { id: task.id, key: task.key, title: task.title, projectId: task.projectId };
    },
    userNames: (ids) => d.userNames(ids),
    async peopleNames(projectId) {
      const person = { select: { firstName: true, lastName: true } } as const;
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { ownerId: true, manager: person, members: { select: { user: person } } } });
      if (!p) return [];
      const owner = p.ownerId ? await prisma.user.findUnique({ where: { id: p.ownerId }, ...person }) : null;
      const people: PersonName[] = [...(p.manager ? [p.manager] : []), ...(owner ? [owner] : []), ...p.members.map((m) => m.user)];
      return nameVariants(people);
    },
    recordActivity: d.recordActivity,
    audit: d.audit,
    cleanSignature: d.cleanSignature,
    logger: d.logger,
  };
}
