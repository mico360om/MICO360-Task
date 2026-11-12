import type { Prisma, PrismaClient } from '@prisma/client';
import type { TaskAudienceFacts } from './recipient-access';

/**
 * The project-visibility facts of a task, as a Prisma select, for filtering notification recipients
 * (see recipient-access): its assignees, and its project's owner, named manager, team and active companies.
 */
export const taskAudienceSelect = {
  assignees: { select: { userId: true } },
  project: {
    select: {
      deletedAt: true,
      ownerId: true,
      managerId: true,
      members: { select: { userId: true } },
      companies: { where: { company: { status: 'ACTIVE' } }, select: { companyId: true } },
    },
  },
} satisfies Prisma.TaskSelect;

/**
 * The tasks the digest sweep reads: live, dated, in live projects — and never an archived one (task archive:
 * hidden but kept, no reminders until it is unarchived). Release B: the deadline reminders and escalations are the
 * Notification & Scheduling planner's (notify-policy/planner-sweep.ts, the same archive rule); the two constants stay
 * for the task archive's places test.
 */
export const DATED_SWEEP_TASKS = { deletedAt: null, archivedAt: null, dueDate: { not: null }, project: { is: { deletedAt: null } } } satisfies Prisma.TaskWhereInput;

/** The escalation sweep's tasks: live, in live projects, not archived. */
export const ESCALATION_SWEEP_TASKS = { deletedAt: null, archivedAt: null, project: { is: { deletedAt: null } } } satisfies Prisma.TaskWhereInput;

export interface TaskAudienceRow {
  assignees: { userId: string }[];
  project: { deletedAt: Date | null; ownerId: string | null; managerId: string | null; members: { userId: string }[]; companies: { companyId: string }[] } | null;
}

export function toAudienceFacts(t: TaskAudienceRow): TaskAudienceFacts {
  return {
    assigneeIds: t.assignees.map((a) => a.userId),
    project: t.project
      ? {
          deletedAt: t.project.deletedAt,
          ownerId: t.project.ownerId,
          managerId: t.project.managerId,
          memberIds: t.project.members.map((m) => m.userId),
          companyIds: t.project.companies.map((c) => c.companyId),
        }
      : null,
  };
}

/** Each of these people's ACTIVE companies (for AudienceOptions.companiesOf). */
export async function activeCompaniesOf(db: Pick<PrismaClient, 'companyMember'>, userIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  const rows = await db.companyMember.findMany({ where: { userId: { in: [...new Set(userIds)] }, company: { status: 'ACTIVE' } }, select: { userId: true, companyId: true } });
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r.companyId]);
  return out;
}
