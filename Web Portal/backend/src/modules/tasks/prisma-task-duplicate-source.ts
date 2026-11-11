import type { PrismaClient } from '@prisma/client';
import { liveTaskWhere } from './prisma-task-repository';
import { projectAudienceIds } from './prisma-assignee-repository';
import { treeFromRows, type ItemRow, type ListRow } from './checklist-tree';
import type { OriginalTask, TaskDuplicatePorts } from './task-duplicate';
import type { DuplicateLinks } from './task-routes';

/** At most this many copies are listed on an original ("Copies: …"), oldest first. */
export const MAX_COPIES_LISTED = 50;

/** Duplicate Task's reads and writes over the database (the rest of its ports are other services'). */
export type TaskDuplicateSource = Pick<TaskDuplicatePorts, 'original' | 'peopleWhoSee' | 'namesOf' | 'columnsOf' | 'addWatchers'> & {
  /** A task's details: the task it was copied from, and its copies (live tasks only; visibility is the route's). */
  links(taskId: string): Promise<DuplicateLinks>;
};

export function createPrismaTaskDuplicateSource(prisma: PrismaClient): TaskDuplicateSource {
  return {
    async original(taskId): Promise<OriginalTask | null> {
      const t = await prisma.task.findFirst({
        where: { id: taskId, ...liveTaskWhere },
        select: {
          id: true,
          key: true,
          title: true,
          description: true,
          projectId: true,
          priority: true,
          startDate: true,
          dueDate: true,
          estimatedHours: true,
          isMilestone: true,
          weight: true,
          inspectionFormId: true,
          inspectionPlace: true,
          inspectionForm: { select: { deletedAt: true } },
          tags: { select: { tag: { select: { name: true } } } },
          assignees: { select: { userId: true } },
          watchers: { select: { userId: true } },
          checklistLists: { where: { deletedAt: null } },
          checklist: { where: { deletedAt: null } },
          externalContacts: { orderBy: { position: 'asc' }, select: { name: true, company: true, designation: true, email: true, phone: true, remarks: true } },
          attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, filename: true, mimeType: true, sizeBytes: true, storageKey: true } },
        },
      });
      if (!t) return null;
      return {
        id: t.id,
        key: t.key,
        title: t.title,
        description: t.description,
        projectId: t.projectId,
        priority: t.priority,
        startDate: t.startDate,
        dueDate: t.dueDate,
        estimatedHours: t.estimatedHours,
        isMilestone: t.isMilestone,
        weight: t.weight,
        inspectionFormId: t.inspectionFormId,
        inspectionFormLive: Boolean(t.inspectionForm && !t.inspectionForm.deletedAt),
        inspectionPlace: t.inspectionPlace,
        tagNames: t.tags.map((x) => x.tag.name).sort((a, b) => a.localeCompare(b)),
        assigneeIds: t.assignees.map((a) => a.userId),
        watcherIds: t.watchers.map((w) => w.userId),
        // Titles, items and nesting only: nothing ticked, no people or dates (checklist-tree.ts).
        checklists: treeFromRows(t.checklistLists as ListRow[], t.checklist as ItemRow[]),
        externalContacts: t.externalContacts,
        files: t.attachments,
      };
    },
    async peopleWhoSee(projectId, userIds) {
      return userIds.length ? projectAudienceIds(prisma, projectId, [...new Set(userIds)]) : [];
    },
    async namesOf(userIds) {
      const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, firstName: true, lastName: true } }) : [];
      return new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username]));
    },
    async columnsOf(projectId) {
      return prisma.kanbanColumn.findMany({ where: { projectId }, select: { id: true, category: true, position: true, enabled: true } });
    },
    async addWatchers(taskId, userIds) {
      if (userIds.length) await prisma.taskWatcher.createMany({ data: userIds.map((userId) => ({ taskId, userId })), skipDuplicates: true });
    },
    async links(taskId) {
      const t = await prisma.task.findFirst({ where: { id: taskId }, select: { duplicatedFromId: true } });
      const from = t?.duplicatedFromId ? await prisma.task.findFirst({ where: { id: t.duplicatedFromId, ...liveTaskWhere }, select: { id: true, key: true } }) : null;
      const copies = await prisma.task.findMany({ where: { duplicatedFromId: taskId, ...liveTaskWhere }, select: { id: true, key: true }, orderBy: { createdAt: 'asc' }, take: MAX_COPIES_LISTED });
      return { from, copies };
    },
  };
}
