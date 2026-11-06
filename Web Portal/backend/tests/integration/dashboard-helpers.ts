import type { PrismaClient } from '@prisma/client';
import { createPrioritiesService } from '../../src/modules/dashboard/priorities-service';
import { createActionItemPrioritySource, createApprovalPrioritySource, createPrismaTaskPrioritySource } from '../../src/modules/dashboard/prisma-priority-sources';
import { CHECKLIST_ITEMS_STUB } from '../../src/modules/dashboard/priority-sources';
import type { ProjectAccess } from '../../src/modules/projects/project-access';
import type { ApprovalSource } from '../../src/modules/tasks/task-approval-routes';
import type { ActionItemService } from '../../src/modules/meetings/action-item-service';
import type { AppDeps } from '../../src/app';

/** 1.23.4: "My Priorities Today" over the database, its sources wired as server.ts wires them. */
export function prioritiesFor(
  client: PrismaClient,
  deps: { projectAccess: ProjectAccess; approvalSource: ApprovalSource; actionItemService: ActionItemService; meetingView: (v: { id: string; roles: string[] }, meetingId: string) => Promise<boolean> },
  timeZone = 'Asia/Muscat',
) {
  const access = deps.projectAccess;
  return createPrioritiesService({
    sources: [
      createPrismaTaskPrioritySource(client, {
        ownProjectIds: (v, pick) => access.ownProjectIds!(v.id, v.roles, pick),
        listProjectIds: (v, pick) => access.accessibleProjectIds(v.id, v.roles, pick),
        openableProjectIds: (v) => access.accessibleProjectIds(v.id, v.roles),
      }),
      createApprovalPrioritySource({ prisma: client, approvals: deps.approvalSource, listProjectIds: (v, pick) => access.accessibleProjectIds(v.id, v.roles, pick) }),
      createActionItemPrioritySource({ prisma: client, actionItems: deps.actionItemService, canOpenMeeting: (v, m) => deps.meetingView(v, m) }),
      CHECKLIST_ITEMS_STUB,
    ],
    timeZone,
    isManager: (v) => deps.approvalSource.canApproveAny(v),
  });
}

/** The same, from the company app's base deps. */
export const prioritiesFromBase = (client: PrismaClient, base: Partial<AppDeps>) =>
  prioritiesFor(client, {
    projectAccess: base.projectAccess!,
    approvalSource: base.approvalSource!,
    actionItemService: base.actionItemService!,
    meetingView: async (v, m) => (await base.meetingAccess!.viewOf(v.id, v.roles, m)) !== null,
  });
