import type { PrismaClient } from '@prisma/client';
import { buildApp, type AppDeps } from '../../src/app';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthService } from '../../src/modules/auth/auth-service';
import { createCompanyAccess, readMyProjectsOnly } from '../../src/modules/companies/company-access';
import { createPrismaPeopleLookup, createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createProjectService } from '../../src/modules/projects/project-service';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createProjectAuthz } from '../../src/modules/projects/project-authz';
import { createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createPrismaProjectOverviewSource } from '../../src/modules/projects/prisma-project-overview-source';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaProjectLookup, createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createPrismaApprovalSource } from '../../src/modules/tasks/prisma-approval-source';
import { createActivityService } from '../../src/modules/activity/activity-service';
import { createPrismaActivityRepository } from '../../src/modules/activity/prisma-activity-repository';
import { createNotificationService } from '../../src/modules/notifications/notification-service';
import { createPrismaNotificationRepository } from '../../src/modules/notifications/prisma-notification-repository';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createMeetingAccess } from '../../src/modules/meetings/meeting-access';
import { createMeetingService } from '../../src/modules/meetings/meeting-service';
import { createPrismaMeetingListCounts } from '../../src/modules/meetings/prisma-project-meetings';
import { createActionItemService } from '../../src/modules/meetings/action-item-service';
import { createPrismaActionItemRepository } from '../../src/modules/meetings/prisma-action-item-repository';
import { createMessageService } from '../../src/modules/chat/message-service';
import {
  createPrismaChatAttachmentRepository,
  createPrismaChatMemberLookup,
  createPrismaConversationRepository,
  createPrismaMessageRepository,
  createPrismaParticipantRepository,
  createPrismaReactionRepository,
} from '../../src/modules/chat/prisma-chat-repository';
import { createPrismaTimelineSource } from '../../src/modules/planning/prisma-timeline-source';
import { createPrismaWorkloadStore } from '../../src/modules/planning/prisma-workload-store';
import { createReportService } from '../../src/modules/reports/report-service';
import { createPrismaReportDataSource } from '../../src/modules/reports/prisma-report-data-source';
import { createSettingsService } from '../../src/modules/settings/settings-service';
import { createPrismaSettingsRepository } from '../../src/modules/settings/prisma-settings-repository';
import { createManagementFromPrisma } from '../../src/modules/management/management-wiring';
import type { Viewer } from '../../src/modules/companies/company-access';

/**
 * The companies DB tests' app (MC1 Lane L): the real route handlers (buildApp) over the real Prisma
 * sources, wired as server.ts wires them — project access, the companies module and the picked
 * company included — for the list families. Signed-in calls go through `get(viewer, path, headers)`.
 */
const TZ = 'Asia/Muscat';

export interface CompanyApp {
  app: Awaited<ReturnType<typeof buildApp>>;
  deps: Partial<AppDeps>;
  /** GET as this person; returns the `data` of a 200 answer (anything else throws, with the body). */
  get(viewer: Viewer, path: string, headers?: Record<string, string>): Promise<unknown>;
  /** GET as this person; the whole answer (status, body, headers). */
  getRaw(viewer: Viewer, path: string, headers?: Record<string, string>): Promise<{ statusCode: number; body: string; rawPayload: Buffer; headers: Record<string, unknown>; json(): unknown }>;
  /** POST as this person; the whole answer. */
  post(viewer: Viewer, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ statusCode: number; body: string; json(): unknown }>;
  /** PUT as this person; the whole answer. */
  put(viewer: Viewer, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ statusCode: number; body: string; json(): unknown }>;
  close(): Promise<void>;
}

export async function buildCompanyApp(prisma: PrismaClient, extra: (base: Partial<AppDeps>) => Partial<AppDeps> = () => ({})): Promise<CompanyApp> {
  const tokenService = createTokenService({
    accessSecret: 'company-app-access',
    refreshSecret: 'company-app-refresh',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const projectRepository = createPrismaProjectRepository(prisma);
  // 1.22 "Show my projects only", as server.ts wires it.
  const myProjectsOnly = (userId: string) => readMyProjectsOnly(prisma, userId);
  const projectService = createProjectService({ projects: projectRepository, people: createPrismaPeopleLookup(prisma), myProjectsOnly });
  const projectAuthz = createProjectAuthz({ managers: createPrismaProjectManagerLookup(prisma) });
  const projectAccess = createProjectAccess({ projects: projectRepository, managers: createPrismaProjectManagerLookup(prisma), myProjectsOnly });
  const companyAccess = createCompanyAccess(prisma);
  const taskService = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma), timeZone: TZ });
  const approvalSource = createPrismaApprovalSource(prisma, { canManageProject: (u, r, p) => projectAuthz.canManageProject(u, r, p) });
  const meetingRepository = createPrismaMeetingRepository(prisma);
  const meetingAccess = createMeetingAccess({
    meetings: meetingRepository,
    projectAccess: {
      canViewProject: (u, r, p) => projectAccess.canViewProject(u, r, p),
      accessibleProjectIds: (u, r, pick?: string | null) => projectAccess.accessibleProjectIds(u, r, pick),
      canManageProject: (u, r, p) => projectAuthz.canManageProject(u, r, p),
    },
  });
  const meetingService = createMeetingService({ meetings: meetingRepository, access: meetingAccess, defaultTimeZone: TZ });
  const chatService = createMessageService({
    conversations: createPrismaConversationRepository(prisma),
    participants: createPrismaParticipantRepository(prisma),
    messages: createPrismaMessageRepository(prisma),
    reactions: createPrismaReactionRepository(prisma),
    attachments: createPrismaChatAttachmentRepository(prisma),
    members: createPrismaChatMemberLookup(prisma),
  });
  const settingsService = createSettingsService({ settings: createPrismaSettingsRepository(prisma) });
  const base: Partial<AppDeps> = {
    authService,
    tokenService,
    appConfig: { timeZone: TZ, productName: 'MICO360 Tasks', companyName: 'MICO360' },
    projectService,
    projectOverview: createPrismaProjectOverviewSource(prisma),
    projectAccess,
    projectAuthz,
    companyAccess,
    taskService,
    approvalSource,
    taskApprovalDetails: (viewer, task) => approvalSource.details(viewer, task),
    activityService: createActivityService({ activities: createPrismaActivityRepository(prisma) }),
    notificationService: createNotificationService({ notifications: createPrismaNotificationRepository(prisma) }),
    meetingService,
    meetingAccess,
    meetingListCounts: createPrismaMeetingListCounts(prisma),
    actionItemService: createActionItemService({ actionItems: createPrismaActionItemRepository(prisma), timeZone: TZ, canEditMeeting: (u, r, m) => meetingAccess.canEditMeeting(u, r, m) }),
    chatService,
    // Timeline, Workload, Reports and Management (MC1 Task 11).
    timelineSource: createPrismaTimelineSource(prisma),
    workloadStore: createPrismaWorkloadStore(prisma),
    settingsService,
    reportService: createReportService({ data: createPrismaReportDataSource(prisma), timeZone: TZ, weekStart: () => settingsService.companyWeekStart() }),
    reportNames: {
      async project(id) {
        return (await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { name: true } }))?.name ?? null;
      },
      async user(id) {
        const u = await prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true, username: true } });
        return u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username : null;
      },
    },
    management: { service: createManagementFromPrisma(prisma, { settings: settingsService, timeZone: TZ }), timeZone: TZ, userName: async () => 'Admin World' },
  };
  const deps = { ...base, ...extra(base) };
  const app = await buildApp(deps as AppDeps);
  const auth = async (viewer: Viewer) => `Bearer ${(await tokenService.issueTokens({ id: viewer.id, roles: viewer.roles })).accessToken}`;
  async function getRaw(viewer: Viewer, path: string, headers: Record<string, string> = {}) {
    const res = await app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { authorization: await auth(viewer), ...headers } });
    return res as unknown as { statusCode: number; body: string; rawPayload: Buffer; headers: Record<string, unknown>; json(): unknown };
  }
  async function get(viewer: Viewer, path: string, headers: Record<string, string> = {}) {
    const res = await getRaw(viewer, path, headers);
    if (res.statusCode !== 200) throw new Error(`GET ${path} → ${res.statusCode}: ${res.body}`);
    return (res.json() as { data: unknown }).data;
  }
  async function send(method: 'POST' | 'PUT', viewer: Viewer, path: string, body: unknown, headers: Record<string, string>) {
    const res = await app.inject({ method, url: `/api/v1${path}`, payload: body as object, headers: { authorization: await auth(viewer), ...headers } });
    return res as unknown as { statusCode: number; body: string; json(): unknown };
  }
  const post = (viewer: Viewer, path: string, body: unknown = {}, headers: Record<string, string> = {}) => send('POST', viewer, path, body, headers);
  const put = (viewer: Viewer, path: string, body: unknown = {}, headers: Record<string, string> = {}) => send('PUT', viewer, path, body, headers);
  return { app, deps, get, getRaw, post, put, close: () => app.close() };
}
