import type { PrismaClient } from '@prisma/client';
import { isTaskDone } from '../tasks/task-status';
import { managedProjectsWhere } from '../projects/project-managers';
import { nameVariants, type PersonName } from '../client-view/client-minutes-content';
import type { RecordTaskActivity } from '../activity/task-activity';
import type { CreateAuditData } from '../audit/audit-repository';
import type { TaskRecord } from '../tasks/task-repository';
import type { InspectionPorts } from './inspection-service';

export interface InspectionPortDeps {
  prisma: PrismaClient;
  access: {
    canViewProject(userId: string, roles: string[], projectId: string): Promise<boolean>;
    canViewTask(userId: string, roles: string[], taskId: string): Promise<boolean>;
  };
  authz: { canManageProject(userId: string, roles: string[], projectId: string): Promise<boolean> };
  tasks: { createTask(input: { title: string; description: string; projectId: string; columnId: string; createdById: string; assigneeIds: string[] }): Promise<TaskRecord> };
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
        select: { id: true, key: true, title: true, projectId: true, completedAt: true, column: { select: { category: true } } },
      });
      return t ? { id: t.id, key: t.key, title: t.title, projectId: t.projectId, done: isTaskDone({ completedAt: t.completedAt, columnCategory: t.column?.category ?? null }) } : null;
    },
    async taskSummaries(ids) {
      const rows = await prisma.task.findMany({
        where: { id: { in: ids } },
        select: { id: true, key: true, title: true, projectId: true, deletedAt: true, completedAt: true, column: { select: { category: true } } },
      });
      return new Map(rows.map((t) => [t.id, { key: t.key, title: t.title, projectId: t.projectId, deleted: t.deletedAt !== null, done: isTaskDone({ completedAt: t.completedAt, columnCategory: t.column?.category ?? null }) }]));
    },
    canViewTask: (u, r, t) => d.access.canViewTask(u, r, t),
    async doneColumnOf(projectId) {
      const cols = (await d.columns.listColumns(projectId)).filter((c) => c.category === 'DONE').sort(byPosition);
      return (cols.find((c) => c.enabled) ?? cols[0])?.id ?? null;
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
