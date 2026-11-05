import type { PrismaClient } from '@prisma/client';
import { buildPeopleApp } from './company-people-app';
import { createPrismaUserStateLookup } from '../../src/modules/auth/prisma-user-state-lookup';
import { createClientAccounts } from '../../src/modules/clients/client-accounts';
import { createPortalService, type PortalNotice } from '../../src/modules/clients/portal-service';
import { createUserService } from '../../src/modules/users/user-service';
import { createPrismaUserRepository as createPrismaUserMgmtRepository } from '../../src/modules/users/prisma-user-repository';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaProjectLookup, createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createAttendeeService } from '../../src/modules/meetings/attendee-service';
import { createPrismaAttendeeRepository } from '../../src/modules/meetings/prisma-attendee-repository';
import { createActionItemService } from '../../src/modules/meetings/action-item-service';
import { createPrismaActionItemRepository } from '../../src/modules/meetings/prisma-action-item-repository';
import { createClientAccessService } from '../../src/modules/client-view/client-access-service';
import { createPrismaClientShareStore } from '../../src/modules/client-view/prisma-client-share-store';
import { createPrismaClientViewSource } from '../../src/modules/client-view/client-view-source';
import { createPrismaClientFlags } from '../../src/modules/client-view/prisma-client-flags';
import { createActivityService } from '../../src/modules/activity/activity-service';
import { createPrismaActivityRepository } from '../../src/modules/activity/prisma-activity-repository';
import type { CreateAuditData } from '../../src/modules/audit/audit-repository';

const TZ = 'Asia/Muscat';

/**
 * The Client portal's DB test app: the people and meetings app (company-people-app.ts) with the live
 * account check (the guard reads each person's CURRENT roles and status), client accounts, the portal
 * and the staff's "Show to client" routes, all on the real Prisma sources.
 */
export async function buildClientPortalApp(prisma: PrismaClient) {
  const notices: PortalNotice[] = [];
  const audited: CreateAuditData[] = [];
  const broadcasts: { projectId: string; event: string }[] = [];
  const audit = { async record(e: CreateAuditData) { audited.push(e); return {}; } };
  const userService = createUserService({ users: createPrismaUserMgmtRepository(prisma) });
  const taskService = createTaskService({
    tasks: createPrismaTaskRepository(prisma),
    projects: createPrismaProjectLookup(prisma),
    timeZone: TZ,
    columns: { async categoryOf(id) { return (await prisma.kanbanColumn.findUnique({ where: { id }, select: { category: true } }))?.category ?? null; } },
  });
  const activityService = createActivityService({ activities: createPrismaActivityRepository(prisma) });
  const attendeeService = createAttendeeService({ attendees: createPrismaAttendeeRepository(prisma), canEditMeeting: async () => true });
  const actionItemService = createActionItemService({ actionItems: createPrismaActionItemRepository(prisma), timeZone: TZ, canEditMeeting: async () => true });
  const clientAccess = createClientAccessService({
    store: createPrismaClientShareStore(prisma),
    source: createPrismaClientViewSource(prisma),
    mailer: { isConfigured: () => false, async sendClientInvitation() { return 'sent'; }, async sendClientCode() {} },
    userName: async () => 'Staff',
    appUrl: 'https://task.mico360.test',
    assetUrl: 'https://task.mico360.test',
    timeZone: TZ,
  });
  const recordTaskActivity = async (e: { taskId: string; userId: string; action: string; meta?: Record<string, unknown> }) => {
    const t = await prisma.task.findUnique({ where: { id: e.taskId }, select: { projectId: true } });
    await activityService.record({ ...e, projectId: t?.projectId ?? null });
  };
  const portal = createPortalService({
    prisma,
    timeZone: TZ,
    moveTask: (taskId, columnId, actorId) => taskService.moveTask(taskId, columnId, undefined, actorId),
    getTask: (taskId) => taskService.getTask(taskId),
    teamOf: async (taskId, actorId) => {
      const t = await prisma.task.findUnique({ where: { id: taskId }, select: { assignees: { select: { userId: true } }, project: { select: { ownerId: true } } } });
      return [...new Set([...(t?.assignees.map((a) => a.userId) ?? []), ...(t?.project.ownerId ? [t.project.ownerId] : [])])].filter((id) => id !== actorId);
    },
    notify: async (n) => void notices.push(n),
    recordActivity: recordTaskActivity,
    broadcast: (projectId, event) => void broadcasts.push({ projectId, event }),
    audit,
    setResponse: (meetingId, attendeeId, response) => attendeeService.setResponse(meetingId, attendeeId, response),
    completeActionItem: (itemId) => actionItemService.setStatus(itemId, 'COMPLETED'),
    minutesPdf: (projectId, meetingId) => clientAccess.projectMinutesPdf(projectId, meetingId),
    taskListPdf: (input) => clientAccess.projectTaskListPdf(input.projectId, input),
  });
  const clientAccounts = createClientAccounts({ prisma, userService, audit });
  const flags = createPrismaClientFlags(prisma, (taskId) => taskService.getTask(taskId));
  const app = await buildPeopleApp(prisma, {
    userState: createPrismaUserStateLookup(prisma),
    userService,
    clientAccounts,
    portal,
    activityService,
    recordTaskActivity,
    auditService: audit as never,
    clientView: { service: clientAccess, secureCookies: false, tasks: flags.tasks, minutes: flags.minutes },
  });
  return { ...app, notices, audited, broadcasts, taskService };
}
