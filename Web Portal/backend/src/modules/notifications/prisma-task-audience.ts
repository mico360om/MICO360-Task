import type { Prisma } from '@prisma/client';
import type { TaskAudienceFacts } from './recipient-access';

/**
 * The project-visibility facts of a task, as a Prisma select, for filtering notification recipients
 * (see recipient-access): its assignees, and its project's owner, named manager and team.
 */
export const taskAudienceSelect = {
  assignees: { select: { userId: true } },
  project: { select: { deletedAt: true, ownerId: true, managerId: true, members: { select: { userId: true } } } },
} satisfies Prisma.TaskSelect;

export interface TaskAudienceRow {
  assignees: { userId: string }[];
  project: { deletedAt: Date | null; ownerId: string | null; managerId: string | null; members: { userId: string }[] } | null;
}

export function toAudienceFacts(t: TaskAudienceRow): TaskAudienceFacts {
  return {
    assigneeIds: t.assignees.map((a) => a.userId),
    project: t.project
      ? { deletedAt: t.project.deletedAt, ownerId: t.project.ownerId, managerId: t.project.managerId, memberIds: t.project.members.map((m) => m.userId) }
      : null,
  };
}
