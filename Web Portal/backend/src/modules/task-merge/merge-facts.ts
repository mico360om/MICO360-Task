import type { Prisma, PrismaClient } from '@prisma/client';
import { ARCHIVE_SELECT, archivedOf } from '../companies/project-archive';
import { sharesProjectCompanyWhere } from '../companies/company-access';
import type { RecurrenceRule } from '../tasks/recurrence';
import type { MergeTaskFacts } from './merge-rules';

/** The database, or one transaction of it. */
export type Db = PrismaClient | Prisma.TransactionClient;

export const displayName = (u: { username: string; firstName: string | null; lastName: string | null }) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
const personSelect = { id: true, username: true, firstName: true, lastName: true } as const;

/** A task as a merge reads it: its fields (the rules' facts), its state and its project. */
export interface MergeTask extends MergeTaskFacts {
  projectCode: string;
  projectStatus: string;
  projectArchived: boolean;
  projectDeleted: boolean;
  inspectionPlace: string | null;
  recurrenceParentId: string | null;
  approvalRequestedAt: Date | null;
  approvalRequestedById: string | null;
  approvedAt: Date | null;
  approvedById: string | null;
  clientAcceptedAt: Date | null;
  clientAcceptedById: string | null;
  completedAt: Date | null;
  progress: number;
  boardDate: Date | null;
  createdById: string;
  createdByName: string;
  version: number;
  deletedAt: Date | null;
  mergedIntoId: string | null;
  assignees: { id: string; name: string }[];
}

const taskSelect = {
  id: true, key: true, title: true, description: true, projectId: true, columnId: true, priority: true, startDate: true, dueDate: true,
  isMilestone: true, clientVisible: true, clientShowDescription: true, recurrenceRule: true, recurrenceParentId: true,
  inspectionFormId: true, inspectionPlace: true, meetingId: true, needsApproval: true, approvalRequestedAt: true, approvalRequestedById: true,
  approvedAt: true, approvedById: true, clientAcceptedAt: true, clientAcceptedById: true, completedAt: true, progress: true, boardDate: true,
  createdAt: true, createdById: true, version: true, deletedAt: true, mergedIntoId: true,
  column: { select: { name: true, category: true } },
  project: { select: { code: true, name: true, status: true, deletedAt: true, companies: ARCHIVE_SELECT.companies } },
  inspectionForm: { select: { title: true } },
  meeting: { select: { title: true } },
  createdBy: { select: personSelect },
  assignees: { select: { user: { select: personSelect } }, orderBy: { assignedAt: 'asc' } },
} as const satisfies Prisma.TaskSelect;
type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

function toMergeTask(t: TaskRow): MergeTask {
  return {
    id: t.id,
    key: t.key,
    title: t.title,
    description: t.description,
    projectId: t.projectId,
    projectName: t.project.name,
    projectCode: t.project.code,
    projectStatus: t.project.status,
    projectArchived: archivedOf({ status: t.project.status, companies: t.project.companies }),
    projectDeleted: t.project.deletedAt !== null,
    columnId: t.columnId,
    columnName: t.column.name,
    columnCategory: t.column.category,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    isMilestone: t.isMilestone,
    clientVisible: t.clientVisible,
    clientShowDescription: t.clientShowDescription,
    recurrenceRule: (t.recurrenceRule as unknown as RecurrenceRule | null) ?? null,
    recurrenceParentId: t.recurrenceParentId,
    inspectionFormId: t.inspectionFormId,
    inspectionFormTitle: t.inspectionForm?.title ?? null,
    inspectionPlace: t.inspectionPlace,
    meetingId: t.meetingId,
    meetingTitle: t.meeting?.title ?? null,
    needsApproval: t.needsApproval,
    approvalRequestedAt: t.approvalRequestedAt,
    approvalRequestedById: t.approvalRequestedById,
    approvedAt: t.approvedAt,
    approvedById: t.approvedById,
    clientAcceptedAt: t.clientAcceptedAt,
    clientAcceptedById: t.clientAcceptedById,
    completedAt: t.completedAt,
    progress: t.progress,
    boardDate: t.boardDate,
    createdAt: t.createdAt,
    createdById: t.createdById,
    createdByName: displayName(t.createdBy),
    version: t.version,
    deletedAt: t.deletedAt,
    mergedIntoId: t.mergedIntoId,
    assignees: t.assignees.map((a) => ({ id: a.user.id, name: displayName(a.user) })),
  };
}

/** The tasks among `ids` that exist (live or not: a refusal says why), in the order asked. */
export async function loadMergeTasks(db: Db, ids: string[]): Promise<MergeTask[]> {
  if (ids.length === 0) return [];
  const rows = await db.task.findMany({ where: { id: { in: ids } }, select: taskSelect });
  const byId = new Map(rows.map((r) => [r.id, toMergeTask(r)]));
  return ids.map((id) => byId.get(id)).filter((t): t is MergeTask => t !== undefined);
}

/** How much of each kind a task has (the preview's "what will be combined"). */
export interface MergeCounts {
  comments: number;
  checklist: number;
  files: number;
  assignees: number;
  watchers: number;
  contacts: number;
  tags: number;
  blockers: number;
  actionItems: number;
  inspections: number;
  activity: number;
}

export async function loadCounts(db: Db, ids: string[]): Promise<Map<string, MergeCounts>> {
  const out = new Map<string, MergeCounts>();
  if (ids.length === 0) return out;
  const rows = await db.task.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      _count: {
        select: {
          comments: { where: { deletedAt: null } },
          checklist: { where: { deletedAt: null } },
          attachments: true,
          assignees: true,
          watchers: true,
          externalContacts: true,
          tags: true,
          dependencies: { where: { dependsOn: { deletedAt: null } } },
          dependedOnBy: { where: { task: { deletedAt: null } } },
          inspections: { where: { deletedAt: null } },
          activities: true,
        },
      },
    },
  });
  const actions = await db.actionItem.groupBy({ by: ['taskId'], where: { taskId: { in: ids } }, _count: { _all: true } });
  const actionCount = new Map(actions.map((a) => [a.taskId, a._count._all]));
  for (const r of rows) {
    const c = r._count;
    out.set(r.id, {
      comments: c.comments,
      checklist: c.checklist,
      files: c.attachments,
      assignees: c.assignees,
      watchers: c.watchers,
      contacts: c.externalContacts,
      tags: c.tags,
      blockers: c.dependencies + c.dependedOnBy,
      actionItems: actionCount.get(r.id) ?? 0,
      inspections: c.inspections,
      activity: c.activities,
    });
  }
  return out;
}

/** Of `userIds`, those on the project's team: its owner, manager, members — and administrators. */
export async function teamOf(db: Db, projectId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const [project, admins] = await Promise.all([
    db.project.findFirst({ where: { id: projectId }, select: { ownerId: true, managerId: true, members: { where: { userId: { in: userIds } }, select: { userId: true } } } }),
    db.userRole.findMany({ where: { userId: { in: userIds }, role: { name: 'ADMIN' } }, select: { userId: true } }),
  ]);
  if (!project) return new Set();
  const team = new Set([project.ownerId, project.managerId, ...project.members.map((m) => m.userId), ...admins.map((a) => a.userId)].filter((x): x is string => !!x));
  return new Set(userIds.filter((id) => team.has(id)));
}

/** Of `userIds`, those who may join the project's team: administrators, and people in one of its active companies (as for Move). */
export async function joinableOf(db: Db, projectId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db.user.findMany({
    where: { id: { in: userIds }, OR: [{ roles: { some: { role: { name: 'ADMIN' } } } }, sharesProjectCompanyWhere(projectId)] },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
