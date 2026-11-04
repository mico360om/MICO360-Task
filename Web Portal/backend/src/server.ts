import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { aiJobRetryDelays, getEnv, parseTrustProxy } from './config/env';
import { prisma } from './lib/prisma';
import { buildApp } from './app';
import { createPrismaIdempotencyStore } from './lib/idempotency';
import { uploadResponseHeaders } from './lib/upload-safety';
import { corsOrigin, parseCorsOrigins } from './lib/cors-origins';
import { registerWebApp, androidAppLink, downloadsDirFor, emailDownloadLinks } from './lib/web-app';
import { createWelcomeService } from './modules/users/welcome-service';
import { createPrismaWelcomeTokenStore } from './modules/users/prisma-welcome-store';
import { createHostedApkVersion } from './lib/apk-version';
import { loadReleaseFile } from './modules/about/build-info';
import { resolve as resolvePath } from 'node:path';
import { createPrismaDataExporter } from './modules/users/data-export';
import { createAuthService } from './modules/auth/auth-service';
import { createTokenService } from './modules/auth/token-service';
import { secretBoxFromEnv } from './modules/settings/secret-box';
import { createPrismaUserRepository } from './modules/auth/prisma-user-repository';
import { createPrismaRefreshTokenStore } from './modules/auth/prisma-refresh-token-store';
import { createProjectService } from './modules/projects/project-service';
import { createPrismaPeopleLookup, createPrismaProjectRepository } from './modules/projects/prisma-project-repository';
import { createPrismaProjectOverviewSource } from './modules/projects/prisma-project-overview-source';
import { createPrismaTimelineSource } from './modules/planning/prisma-timeline-source';
import { createPrismaWorkloadStore } from './modules/planning/prisma-workload-store';
import { createColumnService } from './modules/projects/column-service';
import { createPrismaColumnRepository } from './modules/projects/prisma-column-repository';
import { createMemberService } from './modules/projects/member-service';
import { createPrismaMemberRepository, createPrismaProjectExistsLookup, createPrismaProjectManagerLookup, projectRunnerIds } from './modules/projects/prisma-member-repository';
import { createProjectAuthz } from './modules/projects/project-authz';
import { createTemplateService } from './modules/templates/template-service';
import { createPrismaTemplateRepository } from './modules/templates/prisma-template-repository';
import { createProjectNotices } from './modules/projects/project-notices';
import { createProjectAccess } from './modules/projects/project-access';
import { createCompanyAccess, fallbackProjectCompanyId, isAdminRoles, readMyProjectsOnly } from './modules/companies/company-access';
import { createPrismaArchiveLookup } from './modules/companies/archive-guard';
import { createCompanyService, mailFromName, type OnCompanyAccessChanged } from './modules/companies/company-service';
import { createPrismaCompanyRepository } from './modules/companies/prisma-company-repository';
import { createCompanyMembership, createPrismaMembershipStore } from './modules/companies/company-membership';
import { createProjectCompanies, type OnProjectAudienceChanged } from './modules/companies/project-companies';
import { createPrismaMeetingInvitees } from './modules/meetings/meeting-invitees';
import { createMeetingCompanyRule } from './modules/meetings/meeting-company';
import { createPrismaPersonOptions, keepKnownPeople } from './modules/companies/person-options';
import { createCompanyBranding, createDocumentBrands } from './modules/companies/company-branding';
import { createCompanyTime, usableHoursTarget } from './modules/companies/company-time';
import { createTaskService } from './modules/tasks/task-service';
import { createPrismaTaskRepository, createPrismaProjectLookup, createPrismaCarryForwardRepo } from './modules/tasks/prisma-task-repository';
import { createCarryForwardService } from './modules/tasks/carry-forward-service';
import { createTaskMoveService, type MoveResult } from './modules/tasks/task-move-service';
import { createPrismaTaskMoveRepository } from './modules/tasks/prisma-task-move-repository';
import { createMoveNotifier } from './modules/tasks/task-move-notices';
import { createStatusChangeEffects, type StatusChangeEffects } from './modules/tasks/task-status-effects';
import { createPrismaApprovalSource } from './modules/tasks/prisma-approval-source';
import type { MoveExtra } from './modules/tasks/task-service';
import { directMessageTitle } from './modules/chat/chat-notices';
import { taskNoticeBody } from './modules/notifications/task-notice';
import { DEFAULT_CARRY_STATUSES } from './modules/tasks/board-date';
import { createAssigneeService } from './modules/tasks/assignee-service';
import { updateActivity } from './modules/tasks/task-changes';
import type { RecordTaskActivity } from './modules/activity/task-activity';
import { createWatcherService } from './modules/tasks/watcher-service';
import { createPrismaWatcherRepository } from './modules/tasks/prisma-watcher-repository';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from './modules/tasks/prisma-assignee-repository';
import { createTagService } from './modules/tasks/tag-service';
import { createPrismaTagRepository } from './modules/tasks/prisma-tag-repository';
import { createChecklistService, progressFromItems } from './modules/tasks/checklist-service';
import { createPrismaChecklistRepository } from './modules/tasks/prisma-checklist-repository';
import { createExternalContactService } from './modules/tasks/external-contact-service';
import { createPrismaExternalContactRepository } from './modules/tasks/prisma-external-contact-repository';
import { createCommentService } from './modules/tasks/comment-service';
import { createPrismaCommentRepository } from './modules/tasks/prisma-comment-repository';
import { createMessageService } from './modules/chat/message-service';
import {
  createPrismaConversationRepository,
  createPrismaParticipantRepository,
  createPrismaMessageRepository,
  createPrismaReactionRepository,
  createPrismaChatAttachmentRepository,
  createPrismaChatMemberLookup,
} from './modules/chat/prisma-chat-repository';
import { createAttachmentService } from './modules/tasks/attachment-service';
import { createImageShrinker } from './lib/image-shrink';
import { createPrismaAttachmentRepository } from './modules/tasks/prisma-attachment-repository';
import { createLocalDiskStorage } from './modules/tasks/local-disk-storage';
import { createDependencyService } from './modules/tasks/dependency-service';
import { createPrismaDependencyRepository } from './modules/tasks/prisma-dependency-repository';
import { createRecurrenceService } from './modules/tasks/recurrence-service';
import { createPrismaRecurrencePort } from './modules/tasks/prisma-recurrence-port';
import { createPrismaPreferences } from './modules/users/user-preferences';
import { createUserService } from './modules/users/user-service';
import { createPrismaUserRepository as createPrismaUserMgmtRepository } from './modules/users/prisma-user-repository';
import { createNotificationService } from './modules/notifications/notification-service';
import { createPrismaNotificationRepository, createPrismaPreferenceStore, createPrismaReminderLogStore, pruneReminderLog } from './modules/notifications/prisma-notification-repository';
import type { NotificationRecord } from './modules/notifications/notification-repository';
import { planReminders } from './modules/notifications/reminder';
import { dispatchReminders } from './modules/notifications/reminder-dispatch';
import { buildDigests } from './modules/notifications/notification-digest';
import { createDailyEmailService } from './modules/daily-emails/daily-email-service';
import { createPrismaDailyEmailCheckStore, createPrismaDailyEmailRepository } from './modules/daily-emails/prisma-daily-email-repository';
import { createPrismaDailyEmailSources } from './modules/daily-emails/prisma-daily-email-sources';
import { createManagementFromPrisma, createWeeklySummaryFromPrisma } from './modules/management/management-wiring';
import { createMentionNotifier } from './modules/tasks/mention-notifier';
import { planEscalations } from './modules/notifications/escalation';
import { runExclusive, createPrismaJobLockStore } from './lib/job-lock';
import { isMuted, normalizePreferences } from './modules/notifications/notification-preferences';
import { filterTaskRecipients } from './modules/notifications/recipient-access';
import { activeCompaniesOf, taskAudienceSelect, toAudienceFacts } from './modules/notifications/prisma-task-audience';
import { createDeviceTokenService } from './modules/device-tokens/device-token-service';
import { createPrismaDeviceTokenRepository } from './modules/device-tokens/prisma-device-token-repository';
import { createPushSender, type PushSender } from './modules/device-tokens/push-sender';
import { createFcmTransport, parseServiceAccount } from './modules/device-tokens/fcm-transport';
import { createPrismaUserStateLookup } from './modules/auth/prisma-user-state-lookup';
import { todayKey } from './lib/due-date';
import { createClientAccessService } from './modules/client-view/client-access-service';
import { createPrismaClientShareStore } from './modules/client-view/prisma-client-share-store';
import { createPrismaClientViewSource } from './modules/client-view/client-view-source';
import { createPrismaClientFlags } from './modules/client-view/prisma-client-flags';
import { createInspectionService } from './modules/inspections/inspection-service';
import { createPrismaInspectionStore } from './modules/inspections/prisma-inspection-store';
import { createInspectionPorts } from './modules/inspections/prisma-inspection-ports';
import { createInspectionScheduleService } from './modules/inspections/inspection-schedules';
import { createPrismaInspectionScheduleSource } from './modules/inspections/prisma-inspection-schedule-source';
import { readProjectPicture } from './lib/pdf-image';
import { auditMinutesMovedAway } from './modules/client-view/client-view-events';
import { createBackupsFromPrisma } from './modules/backups/backup-wiring';

/** Validate an IANA time zone; fall back to Asia/Muscat (Oman) if misconfigured. */
function resolveTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Asia/Muscat';
  }
}

/**
 * Firebase service-account credentials for phone push (FCM HTTP v1), from
 * FCM_SERVICE_ACCOUNT_JSON (the key file's JSON) or FCM_SERVICE_ACCOUNT_FILE (a path to it).
 * Returns null — push disabled — when neither is set or the key is unusable.
 */
function loadFcmServiceAccount(source: { json: string; file: string }, onProblem: (msg: string) => void) {
  const inline = source.json.trim();
  const file = source.file.trim();
  if (!inline && !file) return null;
  let json = inline ?? '';
  if (!inline && file) {
    try {
      json = readFileSync(file, 'utf8');
    } catch {
      onProblem('FCM_SERVICE_ACCOUNT_FILE could not be read; push notifications are disabled.');
      return null;
    }
  }
  const account = parseServiceAccount(json);
  if (!account) onProblem('FCM service account is missing project_id / client_email / private_key; push notifications are disabled.');
  return account;
}

import { createReportService } from './modules/reports/report-service';
import { createPrismaTaskExportSource } from './modules/tasks/task-export';
import { createPrismaReportDataSource } from './modules/reports/prisma-report-data-source';
import { createSearchService, createCachedSearchDataSource } from './modules/search/search-service';
import { createPrismaSearchDataSource } from './modules/search/prisma-search-data-source';
import { createTaskSearchIndex } from './modules/search/task-search-index';
import { createTaskSearchEngine } from './modules/search/task-search-engine';
import { startTaskSearchSweeps } from './modules/search/task-search-sweeps';
import { createPrismaMeetingRepository } from './modules/meetings/prisma-meeting-repository';
import { createMeetingService } from './modules/meetings/meeting-service';
import { createMeetingSeriesService } from './modules/meetings/meeting-series-service';
import { createPrismaMeetingListCounts, createPrismaProjectMeetingsSource } from './modules/meetings/prisma-project-meetings';
import { createMeetingAccess } from './modules/meetings/meeting-access';
import { gatherAgendaSources } from './modules/meetings/agenda-sources';
import { createPrismaAgendaSources } from './modules/meetings/prisma-agenda-sources';
import { createPrismaAttendeeRepository } from './modules/meetings/prisma-attendee-repository';
import { createAttendeeService } from './modules/meetings/attendee-service';
import type { AttendeeRecord } from './modules/meetings/attendee-repository';
import { createMeetingEvents } from './modules/meetings/meeting-events';
import { createPrismaAgendaRepository } from './modules/meetings/prisma-agenda-repository';
import { createAgendaService } from './modules/meetings/agenda-service';
import { createPrismaNoteRepository } from './modules/meetings/prisma-note-repository';
import { createNoteService } from './modules/meetings/note-service';
import { createNoteTaskService } from './modules/meetings/note-task-service';
import { createActionItemService } from './modules/meetings/action-item-service';
import { createPrismaActionItemRepository } from './modules/meetings/prisma-action-item-repository';
import { createActivityService } from './modules/activity/activity-service';
import { createPrismaActivityRepository } from './modules/activity/prisma-activity-repository';
import { createAuditService } from './modules/audit/audit-service';
import { createPrismaAuditRepository, createPrismaAuditTaskRefs } from './modules/audit/prisma-audit-repository';
import { createSettingsService } from './modules/settings/settings-service';
import { createAiConfigService } from './modules/ai/ai-config-service';
import { createAiFeatureService } from './modules/ai/ai-feature-service';
import { createPrismaFinalMinutesRepository } from './modules/meetings/final-minutes-repository';
import { createPrismaMinutesSendRepository } from './modules/meetings/minutes-send-repository';
import { createMicoAiService } from './modules/mico-ai/mico-ai-service';
import { createMicoAiTools } from './modules/mico-ai/mico-ai-tools';
import { createPrismaMicoAiData } from './modules/mico-ai/prisma-mico-ai-data';
import { createPrismaMicoAiRepository } from './modules/mico-ai/prisma-mico-ai-repository';
import { createMicoAiActions } from './modules/mico-ai/mico-ai-actions';
import { createMicoAiActionsPort } from './modules/mico-ai/mico-ai-actions-port';
import { createMinutesData } from './modules/meetings/minutes-routes';
import { minutesFacts } from './modules/meetings/final-minutes';
import { createPrismaAiConfigRepository } from './modules/ai/prisma-ai-config-repository';
import { createPrismaSettingsRepository } from './modules/settings/prisma-settings-repository';
import { createOtpService } from './modules/auth/otp-service';
import { createPrismaOtpStore } from './modules/auth/prisma-otp-store';
import { createPrismaOtpUserLookup } from './modules/auth/prisma-otp-user-lookup';
import { createPasswordResetService } from './modules/auth/password-reset-service';
import { createPrismaPasswordResetStore } from './modules/auth/prisma-password-reset-store';
import { createPrismaResetUserRepo } from './modules/auth/prisma-reset-user-repo';
import { hashPassword } from './lib/password';
import { createEmailService } from './modules/email/email-service';
import { createMeetingNotifyService } from './modules/meetings/meeting-notify-service';
import { createMeetingReminderService } from './modules/meetings/meeting-reminder-service';
import { createPrismaAiJobStore } from './modules/ai-jobs/prisma-ai-job-store';
import { createAiJobRunner } from './modules/ai-jobs/ai-job-runner';
import { createFinalMinutesAi } from './modules/meetings/final-minutes-ai';
import { createPrismaMeetingReminderSource, createPrismaMeetingReminderStore } from './modules/meetings/prisma-meeting-reminders';
import { configureBrand } from './modules/email/brand';
import { chooseTransport } from './modules/email/outbox-transport';
import { createEmailWebhookService } from './modules/email/email-webhook-service';
import { createPrismaEmailEventStore, createPrismaEmailLogStore, createPrismaSuppressionChecker } from './modules/email/prisma-email-event-store';
import { createRealtime } from './realtime/realtime';
import { createLogger } from './lib/logger';
import { createErrorReporter } from './lib/error-reporter';

async function main(): Promise<void> {
  const env = getEnv();
  const logger = createLogger({ service: 'mico360-api', level: env.NODE_ENV === 'production' ? 'info' : 'debug' });
  const errorReporter = createErrorReporter({
    dsn: env.SENTRY_DSN || undefined,
    onReport: (err, ctx) => logger.error('reported to error tracker', { err, ...ctx }),
  });

  const authService = createAuthService({
    users: createPrismaUserRepository(prisma),
    maxAttempts: env.ACCOUNT_LOCK_MAX_ATTEMPTS,
    lockMinutes: env.ACCOUNT_LOCK_MINUTES,
    logger,
  });

  const projectRepository = createPrismaProjectRepository(prisma);
  // Who may be picked as a project's owner, manager or team: active people only.
  const peopleLookup = createPrismaPeopleLookup(prisma);
  // companies: which companies a project goes into and who may change them, and the payload's
  // companies (a company's week start, else the site's; read at most every 30 s; the site's zone).
  let siteWeek: { at: number; value: Promise<0 | 1 | 6> } | null = null;
  const siteWeekStart = () => {
    if (!siteWeek || Date.now() - siteWeek.at > 30_000) siteWeek = { at: Date.now(), value: settingsService.companyWeekStart().catch(() => 0 as const) };
    return siteWeek.value;
  };
  const projectCompanies = createProjectCompanies(prisma, { site: async () => ({ timeZone: companyTz, weekStart: await siteWeekStart() }) });
  // Late-bound: the realtime server re-checks who may see a project whose companies changed (MC1 Task 12 binds it).
  // companies: bound to the realtime server's re-check below (refreshCompanyAccess), once it exists.
  let onProjectAudienceChanged: OnProjectAudienceChanged = () => {};
  // 1.22 "Show my projects only": an administrator's own setting, read on every list (never cached).
  const myProjectsOnly = (userId: string) => readMyProjectsOnly(prisma, userId);
  const projectService = createProjectService({ projects: projectRepository, people: peopleLookup, companies: projectCompanies, myProjectsOnly });

  const columnService = createColumnService({
    columns: createPrismaColumnRepository(prisma),
    // A column with tasks waiting for approval can't become a Done column (they would count as done).
    waitingTasksIn: (columnId) => prisma.task.count({ where: { columnId, deletedAt: null, approvalRequestedAt: { not: null } } }),
  });

  // Late-bound (chat + realtime are created further down): a removed member leaves the project's
  // chat channel and live room at once instead of when their tab closes.
  let onMemberRemoved: (projectId: string, userId: string) => Promise<void> = async () => {};
  const memberService = createMemberService({
    repo: createPrismaMemberRepository(prisma),
    projects: createPrismaProjectExistsLookup(prisma),
    people: peopleLookup,
    onMemberRemoved: (projectId, userId) => onMemberRemoved(projectId, userId),
    // companies: the Team tab marks who can no longer see the project (hasAccess: false).
    whoCanSee: (projectId, userIds) => companyAccess.whoCanSeeProject(projectId, userIds),
  });

  const projectAuthz = createProjectAuthz({ managers: createPrismaProjectManagerLookup(prisma) });
  // Object-level view authorization: gate task/column/member/comment reads to accessible projects.
  // Access follows project visibility only — being assigned to a task no longer grants access.
  const projectAccess = createProjectAccess({
    projects: projectRepository,
    managers: createPrismaProjectManagerLookup(prisma),
    myProjectsOnly, // 1.22: a list (the pick named) follows an administrator's "Show my projects only"
  });
  // companies: the access rule module (memberships and project companies, read fresh on every request).
  const companyAccess = createCompanyAccess(prisma);
  const personOptions = createPrismaPersonOptions(prisma);
  // companies (MC1 Task 10): who may be invited to a meeting, and a standalone meeting's company — one
  // pair of rules for the meeting routes and MICO AI's "schedule a meeting".
  const meetingInvitees = createPrismaMeetingInvitees(prisma, { companyAccess, personOptions });
  const meetingCompany = createMeetingCompanyRule({ checkPick: (viewer, id) => companyAccess.checkPick(viewer, id), fallbackCompanyId: (organizerId) => fallbackProjectCompanyId(prisma, organizerId) });

  // Late-bound so moving a task to a DONE column can spawn the next recurring instance (below).
  type TaskRec = import('./modules/tasks/task-repository').TaskRecord;
  let onTaskMoved: (task: TaskRec, prevColumnId: string, actorId?: string, extra?: MoveExtra) => Promise<void> = async () => {};
  let onTaskCreated: (task: TaskRec) => Promise<void> = async () => {};
  let onTaskDeleting: (task: TaskRec) => Promise<void> = async () => {};
  let onTaskUpdated: (before: TaskRec, after: TaskRec, actorId?: string) => Promise<void> = async () => {};

  const companyTz = resolveTimeZone(env.COMPANY_TIMEZONE);
  // Task search: one normalised text per task (task_search_index), refreshed after every change the
  // services make (the hooks below call taskChanged), healed by the sweeps further down, and searched
  // by the top-bar search and the Search results page (GET /search/tasks).
  const taskSearchIndex = createTaskSearchIndex({ prisma, logger });
  const taskSearchEngine = createTaskSearchEngine({ prisma, index: taskSearchIndex, timeZone: companyTz });
  // Task approvals: who may approve a project's tasks is who may manage it (admins, owner, named
  // manager, MANAGER members) — the person's current roles, read at the moment they act.
  const roleNamesOf = async (userId: string): Promise<string[]> => {
    const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null, status: 'ACTIVE' }, select: { roles: { select: { role: { select: { name: true } } } } } });
    return u ? u.roles.map((r) => r.role.name) : [];
  };
  const approvalSource = createPrismaApprovalSource(prisma, { canManageProject: (u, r, p) => projectAuthz.canManageProject(u, r, p) });
  const taskService = createTaskService({
    tasks: createPrismaTaskRepository(prisma),
    projects: createPrismaProjectLookup(prisma),
    timeZone: companyTz, // anchors each task's board day (per-date boards)
    // Look up a target column's category so moving a card into a DONE stage completes the task.
    columns: {
      async categoryOf(columnId) {
        const col = await prisma.kanbanColumn.findUnique({ where: { id: columnId }, select: { category: true } });
        return col?.category ?? null;
      },
    },
    onMoved: (task, prevColumnId, actorId, extra) => onTaskMoved(task, prevColumnId, actorId, extra),
    // A task that needs approval, finished by someone who can't approve, waits (task-approval).
    approvals: {
      canApprove: async (userId, projectId) => projectAuthz.canManageProject(userId, await roleNamesOf(userId), projectId),
      columnsOf: (projectId) => prisma.kanbanColumn.findMany({ where: { projectId }, select: { id: true, category: true, position: true, enabled: true } }),
    },
    // An approval or send-back is saved: a step after it that fails (a notice, the comment) is logged.
    onError: (err, taskId) => logger.error('task approvals: a step after the decision failed', { err, taskId }),
    // A re-opened task goes back to what its checklist says (it was forced to 100% when completed).
    checklistPercent: async (taskId) => progressFromItems(await prisma.checklistItem.findMany({ where: { taskId }, select: { done: true } })),
    onCreated: (task) => onTaskCreated(task),
    onUpdated: (before, after, actorId) => onTaskUpdated(before, after, actorId),
    onDeleting: (task) => onTaskDeleting(task),
    // A task can carry an inspection form (a scheduled check): only a form that is there.
    inspectionForms: { isLive: async (id) => (await prisma.inspectionForm.count({ where: { id, deletedAt: null } })) > 0 },
  });

  // The next occurrence lands on today's board in the company time zone.
  const recurrencePort = createPrismaRecurrencePort(prisma, { timeZone: companyTz });
  const recurrenceService = createRecurrenceService({
    tasks: recurrencePort,
    timeZone: companyTz,
    onError: (err, taskId) => logger.error('recurring task: next copy failed', { err, taskId }),
  });
  // onTaskMoved is wired below, once the notification + activity services exist.

  // Moving tasks to another project. Late-bound: the notifications are wired below.
  let onTaskProjectMoved: (move: MoveResult & { actorId: string }) => Promise<void> = async () => {};
  // What a column change does (late-bound: wired once notifications and activity exist, below).
  let statusChanged: StatusChangeEffects = async () => {};
  const taskMoveService = createTaskMoveService({
    repo: createPrismaTaskMoveRepository(prisma),
    timeZone: companyTz,
    // 1.22: the move dialog lists an administrator's own projects with "Show my projects only" (a list call).
    pickerProjectIds: (actor) => projectAccess.accessibleProjectIds(actor.id, actor.roles ?? [], null),
    checklistPercent: async (taskId) => progressFromItems(await prisma.checklistItem.findMany({ where: { taskId }, select: { done: true } })),
    // A move into or out of a Done column is a status change too: the next repeat copy, meeting
    // action items and the timeline line, as for a card moved on the board. Quietly: the move's own
    // notice says it was completed or re-opened (one notice, not a second "moved to Done").
    onStatusChanged: (task, prevColumnId, actorId, extra) => statusChanged(task, prevColumnId, actorId, { notify: false, ...(extra ?? {}) }),
    onMoved: (move) => onTaskProjectMoved(move),
    onError: (err, taskId) => logger.error('moving a task to another project: a follow-up step failed', { err, taskId }),
  });

  // Late-bound so assignment can create notifications + activity once those services exist (below).
  let onTaskAssigned: (taskId: string, userIds: string[], actorId?: string) => Promise<void> = async () => {};
  let onTaskUnassigned: (taskId: string, userId: string, actorId?: string) => Promise<void> = async () => {};

  const assigneeService = createAssigneeService({
    repo: createPrismaAssigneeRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    onAssigned: (taskId, userIds, actorId) => onTaskAssigned(taskId, userIds, actorId),
    onUnassigned: (taskId, userId, actorId) => onTaskUnassigned(taskId, userId, actorId),
  });

  const watcherRepo = createPrismaWatcherRepository(prisma);
  const watcherService = createWatcherService({ repo: watcherRepo, taskLookup: createPrismaTaskLookup(prisma) });

  // Which of these users are active, which of them are admins (admins can see every task), and
  // their active companies (companies: the team sees a project only inside one of its companies).
  const activeUserFacts = async (userIds: string[]): Promise<{ activeIds: string[]; adminIds: string[]; companiesOf: Map<string, string[]> }> => {
    if (userIds.length === 0) return { activeIds: [], adminIds: [], companiesOf: new Map() };
    const [users, companiesOf] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, roles: { select: { role: { select: { name: true } } } } },
      }),
      activeCompaniesOf(prisma, userIds),
    ]);
    return { activeIds: users.map((u) => u.id), adminIds: users.filter((u) => u.roles.some((r) => r.role.name === 'ADMIN')).map((u) => u.id), companiesOf };
  };
  // Of these users, those who can still open the task (never the actor): a watcher or @mention
  // outside the project — or anyone, once the project is deleted — hears nothing about it.
  const visibleTaskRecipients = async (taskId: string, userIds: string[], actorId?: string | null): Promise<string[]> => {
    const ids = [...new Set(userIds)].filter((id) => id !== actorId);
    if (ids.length === 0) return [];
    const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: taskAudienceSelect });
    if (!task) return [];
    return filterTaskRecipients(ids, toAudienceFacts(task), { ...(await activeUserFacts(ids)), excludeUserId: actorId });
  };
  // Everyone who should hear about a task: its assignees plus anyone watching (following) it.
  const taskRecipientIds = async (taskId: string, actorId?: string | null): Promise<string[]> => {
    const [assignees, watcherIds] = await Promise.all([
      prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } }),
      watcherRepo.listWatcherIds(taskId),
    ]);
    return visibleTaskRecipients(taskId, [...assignees.map((a) => a.userId), ...watcherIds], actorId);
  };

  const tagService = createTagService({
    repo: createPrismaTagRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    onChanged: (taskId) => taskSearchIndex.taskChanged(taskId),
  });

  const checklistService = createChecklistService({
    repo: createPrismaChecklistRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    // The task's own progress (what the board card shows) follows its checklist while it is open;
    // a completed task stays at 100%.
    onProgress: async (taskId, percent) => {
      await prisma.task.updateMany({ where: { id: taskId, completedAt: null }, data: { progress: percent } });
    },
    onChanged: (taskId) => taskSearchIndex.taskChanged(taskId),
  });

  // External contacts on tasks: the people outside the company responsible for a task. Never
  // emailed or notified — the task's history notes each change.
  const externalContactService = createExternalContactService({
    repo: createPrismaExternalContactRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    onChanged: (taskId) => taskSearchIndex.taskChanged(taskId),
  });

  // Late-bound so a comment @mention can notify the mentioned users once notifications exist (below).
  let onCommentMention: (taskId: string, authorId: string, usernames: string[], body?: string) => Promise<void> = async () => {};
  // Late-bound so any comment notifies the task's assignees once notifications exist (below).
  let onComment: (taskId: string, authorId: string, commentId: string) => Promise<void> = async () => {};

  const commentService = createCommentService({
    repo: createPrismaCommentRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    onMention: (taskId, authorId, usernames, body) => onCommentMention(taskId, authorId, usernames, body),
    onComment: (taskId, authorId, commentId) => onComment(taskId, authorId, commentId),
    onChanged: (taskId) => taskSearchIndex.taskChanged(taskId),
  });

  // Late-bound chat notification hooks (wired once notifications exist, below).
  let onChatMention: (usernames: string[], authorId: string, conversationId: string) => Promise<void> = async () => {};
  let onChatDirect: (recipientId: string, authorId: string, conversationId: string) => Promise<void> = async () => {};
  let onChatRead: (conversationId: string, userId: string) => Promise<void> = async () => {};

  // Shared file storage + allow-list for task AND chat attachments.
  const attachmentStorage = createLocalDiskStorage({ baseDir: env.UPLOAD_DIR, publicPrefix: '/uploads' });

  const chatService = createMessageService({
    conversations: createPrismaConversationRepository(prisma),
    participants: createPrismaParticipantRepository(prisma),
    messages: createPrismaMessageRepository(prisma),
    reactions: createPrismaReactionRepository(prisma),
    attachments: createPrismaChatAttachmentRepository(prisma),
    storage: attachmentStorage, // so deleting a message also deletes its attachment files
    members: createPrismaChatMemberLookup(prisma),
    onMention: (e) => onChatMention(e.usernames, e.authorId, e.conversationId),
    onDirectMessage: (e) => onChatDirect(e.recipientId, e.authorId, e.conversationId),
    onRead: (e) => onChatRead(e.conversationId, e.userId),
    logger,
  });

  const attachmentAllowedMime = env.UPLOAD_ALLOWED_MIME.split(',').map((s) => s.trim()).filter(Boolean);

  // Attached pictures (tasks and chat) are stored smaller; if the picture library won't load on
  // this server they are kept at full size, which the log and /health say.
  const imageShrinker = createImageShrinker({ warn: (msg, meta) => logger.warn(msg, meta) });
  void imageShrinker.check().then((on) => {
    if (on) logger.info('Attached pictures are made smaller to save space');
  });

  const attachmentService = createAttachmentService({
    repo: createPrismaAttachmentRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    storage: attachmentStorage,
    maxSizeBytes: env.UPLOAD_MAX_BYTES,
    allowedMimeTypes: attachmentAllowedMime,
    maxTotalBytesPerTask: env.UPLOAD_MAX_TOTAL_BYTES_PER_TASK,
    shrinkImage: imageShrinker.shrink,
    onChanged: (taskId) => taskSearchIndex.taskChanged(taskId),
  });

  const dependencyService = createDependencyService({
    repo: createPrismaDependencyRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
  });

  // Late-bound: the token service is created further down, but a password change must revoke
  // the user's other sessions, so the user service takes a closure resolved once it exists.
  let revokeSessions: (userId: string) => Promise<void> = async () => {};
  // Late-bound to the realtime server (below): a suspended / deleted / demoted user's open sockets
  // are closed, not left streaming until the tab is closed.
  let onSessionsRevoked: (userId: string) => void = () => {};
  // Late-bound to the token service (below): a self password change hands the caller a fresh session.
  let issueSession: (u: { id: string; roles: string[]; tokenVersion: number }) => Promise<{ accessToken: string; refreshToken: string }> = async () => {
    throw new Error('token service not ready');
  };
  const userMgmtRepository = createPrismaUserMgmtRepository(prisma);
  // MICO AI's chats (their service is built further down): a deleted person's chats go with them.
  const micoAiRepository = createPrismaMicoAiRepository(prisma);
  const userService = createUserService({
    users: userMgmtRepository,
    revokeSessions: (userId) => revokeSessions(userId),
    onSessionsRevoked: (userId) => onSessionsRevoked(userId),
    issueSession: (u) => issueSession(u),
    // The device-token repository is created below; this runs only when access is revoked.
    forgetDevices: (userId) => deviceTokenRepository.deleteForUser(userId).then(() => undefined),
    onDeleted: (userId) => micoAiRepository.deleteAllForUser(userId).then(() => undefined),
    // Their tasks are found by their name: re-read those tasks with the new one.
    onRenamed: (userId) => taskSearchIndex.refreshForUser(userId).then(() => undefined, (err) => logger.error('task search: indexing a renamed person’s tasks failed', { err, userId })),
  });
  // Resolve user/project ids → display names for server-rendered documents (meeting minutes).
  const resolveUserNames = async (ids: string[]): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    await Promise.all(
      [...new Set(ids)].map(async (uid) => {
        const u = await userMgmtRepository.findById(uid).catch(() => null);
        if (u) map.set(uid, `${u.firstName} ${u.lastName}`.trim() || u.username);
      }),
    );
    return map;
  };
  const resolveProject = async (projectId: string) => {
    const p = await projectRepository.findById(projectId).catch(() => null);
    if (!p) return null;
    return {
      name: p.name,
      code: p.code,
      number: p.number,
      color: p.color,
      icon: p.icon,
      imageUrl: p.imageUrl,
      clientName: p.clientName,
      status: p.status,
      ownerId: p.ownerId,
      startDate: p.startDate ? p.startDate.toISOString() : null,
      targetDate: p.targetDate ? p.targetDate.toISOString() : null,
    };
  };

  // Phone push (FCM HTTP v1) — only when Firebase credentials are configured; otherwise
  // notifications stay in-app (and in the app's own polling) exactly as before.
  const deviceTokenRepository = createPrismaDeviceTokenRepository(prisma);
  const fcmAccount = loadFcmServiceAccount({ json: env.FCM_SERVICE_ACCOUNT_JSON, file: env.FCM_SERVICE_ACCOUNT_FILE }, (msg) => logger.warn(msg));
  const pushSender: PushSender | undefined = fcmAccount
    ? createPushSender({ deviceTokens: deviceTokenRepository, transport: createFcmTransport({ serviceAccount: fcmAccount }) })
    : undefined;
  if (!pushSender) logger.info('push notifications disabled (no FCM service account configured)');

  // Each stored notification also reaches the person's open pages at once (the website's live
  // pop-up for meeting reminders); late-bound to the realtime server, created further down.
  let onNotificationDelivered: (record: NotificationRecord) => void = () => {};
  const notificationService = createNotificationService({
    notifications: createPrismaNotificationRepository(prisma),
    preferences: createPrismaPreferenceStore(prisma),
    push: pushSender,
    logger,
    onDelivered: (record) => onNotificationDelivered(record),
  });
  const deviceTokenService = createDeviceTokenService({ deviceTokens: deviceTokenRepository });

  const reportService = createReportService({ data: createPrismaReportDataSource(prisma), timeZone: companyTz, weekStart: () => settingsService.companyWeekStart() });

  // Cache the (broad) search snapshot for a few seconds so bursty, debounced searches don't
  // reload every meeting/note/task per keystroke — important on low-memory hosts.
  const searchService = createSearchService({
    data: createCachedSearchDataSource(createPrismaSearchDataSource(prisma), { ttlMs: 15_000 }),
    // Its tasks: the best few of the full task search, per request.
    tasks: taskSearchEngine,
  });

  // Meetings & Meeting Notes module (project-linked and standalone).
  // A meeting re-filed under another project takes its shown minutes off the old client page (in the
  // same write); the audit line is late-bound to the audit service, created further down.
  let onClientMinutesHidden: (hidden: import('./modules/meetings/prisma-meeting-repository').ClientMinutesHidden) => void = () => {};
  const meetingRepository = createPrismaMeetingRepository(prisma, { onClientMinutesHidden: (h) => onClientMinutesHidden(h) });
  const agendaSourceStore = createPrismaAgendaSources(prisma);
  const isActiveUser = async (userId: string): Promise<boolean> =>
    (await prisma.user.count({ where: { id: userId, deletedAt: null, status: 'ACTIVE' } })) > 0;
  // Who may change a meeting: organizer, creator, admin — or whoever manages its project
  // (the project's manager or owner, or a MANAGER member: project-managers, as for moving tasks).
  const meetingAccess = createMeetingAccess({
    meetings: meetingRepository,
    projectAccess: {
      canViewProject: (userId, roles, projectId) => projectAccess.canViewProject(userId, roles, projectId),
      // companies: a picked company narrows the meetings list's projects (MC1 Task 8 passes it).
      accessibleProjectIds: (userId, roles, pick?: string | null) => projectAccess.accessibleProjectIds(userId, roles, pick),
      canManageProject: (userId, roles, projectId) => projectAuthz.canManageProject(userId, roles, projectId),
    },
    // companies (MC1 Task 10): someone invited from outside the project's companies gets the invitee view.
    meetingView: (viewer, m) => companyAccess.meetingView(viewer, m),
  });
  const canEditMeeting = (userId: string, roles: string[], meetingId: string) => meetingAccess.canEditMeeting(userId, roles, meetingId);
  // Live meeting events reach the project's room AND the organizer, creator and internal attendees
  // (standalone meetings have no room), once per socket. The audience is read without the
  // deleted filter so a deletion is announced too.
  const meetingEvents = createMeetingEvents({
    loadAudience: async (meetingId) => {
      const m = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { projectId: true, organizerId: true, createdById: true, attendees: { select: { userId: true } } },
      });
      if (!m) return null;
      return { projectId: m.projectId, organizerId: m.organizerId, createdById: m.createdById, attendeeUserIds: m.attendees.map((a) => a.userId).filter((u): u is string => !!u) };
    },
    emit: (audience, event, payload) => broadcastToAudience(audience, event, payload),
    onError: (err) => logger.error('meeting realtime event failed', { err }),
  });
  const broadcastMeetingChange = (meetingId: string, event: string) => void meetingEvents.publish(meetingId, event);
  // One broadcast per change (the routes no longer broadcast on their own).
  const meetingService = createMeetingService({
    meetings: meetingRepository,
    access: meetingAccess,
    defaultTimeZone: companyTz,
    isActiveUser,
    onChanged: (meeting, kind) => broadcastMeetingChange(meeting.id, `meeting:${kind}`),
  });
  // Late-bound: the notify service (email) is created further down.
  let onAttendeeRemoved: (meetingId: string, attendee: AttendeeRecord, alsoFrom: string[]) => void = () => {};
  const attendeeRepository = createPrismaAttendeeRepository(prisma);
  // Repeating meetings: each meeting of a series is a real meeting, created ~3 months ahead.
  const meetingSeriesService = createMeetingSeriesService({
    meetings: meetingRepository,
    attendees: attendeeRepository,
    defaultTimeZone: companyTz,
    onChanged: (meeting, kind) => broadcastMeetingChange(meeting.id, `meeting:${kind}`),
  });
  const attendeeService = createAttendeeService({
    attendees: attendeeRepository,
    canEditMeeting,
    onChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:attendees'),
    onRemoved: (meetingId, attendee, alsoFrom) => onAttendeeRemoved(meetingId, attendee, alsoFrom),
    // People added to or taken off a series meeting are on (or off) its later meetings too.
    laterMeetings: async (meetingId) => (await meetingSeriesService.laterMeetings(meetingId)).map((m) => m.id),
  });
  const agendaService = createAgendaService({
    agenda: createPrismaAgendaRepository(prisma),
    canEditMeeting,
    onChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:agenda'),
  });
  const noteService = createNoteService({
    notes: createPrismaNoteRepository(prisma),
    canEditMeeting,
    onChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:notes'),
  });
  // ⭐ Create Task from Note — promotes a meeting note into a board task.
  const actionItemService = createActionItemService({
    actionItems: createPrismaActionItemRepository(prisma),
    timeZone: companyTz,
    canEditMeeting,
    onChanged: (meetingId) => { if (meetingId) broadcastMeetingChange(meetingId, 'meeting:action-items'); },
  });
  const resolveMeetingProjectId = async (meetingId: string) => (await meetingRepository.accessCore(meetingId))?.projectId ?? null;

  const noteTaskService = createNoteTaskService({
    noteService,
    meetingService,
    taskService,
    columnService,
    assignees: assigneeService,
    actionItems: actionItemService,
  });
  const meetingListCounts = createPrismaMeetingListCounts(prisma);
  const resolveTaskKeys = async (ids: string[]) =>
    Object.fromEntries((await prisma.task.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, key: true } })).map((t) => [t.id, t.key]));

  const activityService = createActivityService({ activities: createPrismaActivityRepository(prisma) });
  // Timeline lines from the task's checklist, comment, file and blocker routes: filed under the
  // task's project (so project feeds see them), a blocker named by its key and title.
  const recordTaskActivity: RecordTaskActivity = async ({ taskId, userId, action, meta }) => {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
    let details = meta ?? {};
    if (typeof details.dependsOnTaskId === 'string') {
      const blocker = await prisma.task.findUnique({ where: { id: details.dependsOnTaskId }, select: { key: true, title: true } });
      details = { ...details, key: blocker?.key ?? null, title: blocker?.title ?? null };
    }
    await activityService.record({ taskId, projectId: task?.projectId ?? null, userId, action, meta: details });
  };

  /** Which task a notification is about ("MICO-12 · Title"), so the rows in the bell can be told apart. */
  const taskNotice = async (taskId: string): Promise<string | null> =>
    taskNoticeBody(await prisma.task.findUnique({ where: { id: taskId }, select: { key: true, title: true } }));

  // Now that notifications + activity exist, make task assignment actually fire them.
  onTaskAssigned = async (taskId, userIds, actorId) => {
    await taskSearchIndex.taskChanged(taskId);
    const about = await taskNotice(taskId);
    // Self-assignment isn't news to the person who did it.
    for (const userId of await visibleTaskRecipients(taskId, userIds, actorId)) {
      await notificationService.notify({
        userId,
        type: 'TASK_ASSIGNED',
        title: 'You were assigned a task',
        body: about,
        entityType: 'task',
        entityId: taskId,
      });
    }
    // One activity per assignment, attributed to the actor, with the assignee's name in meta.
    if (actorId) {
      const t = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
      const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, firstName: true, lastName: true } });
      const nameOf = (id: string) => {
        const u = users.find((x) => x.id === id);
        return u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username : id;
      };
      for (const userId of userIds) {
        await activityService.record({ taskId, projectId: t?.projectId ?? null, userId: actorId, action: 'ASSIGNED', meta: { assigneeId: userId, assignee: nameOf(userId) } });
      }
    }
  };

  // Taking someone off a task: one activity row naming them, attributed to whoever did it.
  onTaskUnassigned = async (taskId, userId, actorId) => {
    await taskSearchIndex.taskChanged(taskId);
    if (!actorId) return;
    const [t, u] = await Promise.all([
      prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { username: true, firstName: true, lastName: true } }),
    ]);
    const assignee = u ? [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username : userId;
    await activityService.record({ taskId, projectId: t?.projectId ?? null, userId: actorId, action: 'UNASSIGNED', meta: { assigneeId: userId, assignee } });
  };

  // An edit: one activity row listing what changed (old → new), so the timeline can say it.
  onTaskUpdated = async (before, after, actorId) => {
    await taskSearchIndex.taskChanged(after.id);
    // An edit to the whole repeating series changes the words of its other copies too.
    const series = after.recurrenceParentId ?? (after.recurrenceRule ? after.id : null);
    if (series && (before.title !== after.title || before.description !== after.description)) await taskSearchIndex.refreshSeries(series).catch((err) => logger.error('task search: indexing a series failed', { err, taskId: after.id }));
    if (!actorId) return;
    const meta = updateActivity(before, after, companyTz);
    if (!meta) return;
    await activityService.record({ taskId: after.id, projectId: after.projectId, userId: actorId, action: 'UPDATED', meta: { ...meta } });
  };

  onTaskCreated = async (task) => {
    await taskSearchIndex.taskChanged(task.id);
    await activityService.record({ taskId: task.id, projectId: task.projectId, userId: task.createdById, action: 'CREATED', meta: { title: task.title } });
  };

  // On a real stage change: the next copy of a repeating task when it is completed, meeting action
  // items following it, a notice to the people following it and the timeline line (task-status-effects).
  statusChanged = createStatusChangeEffects({
    column: (id) => prisma.kanbanColumn.findUnique({ where: { id }, select: { name: true, category: true } }),
    nextCopy: (task) =>
      recurrenceService.onTaskCompleted({ id: task.id, dueDate: task.dueDate, recurrenceRule: task.recurrenceRule, recurrenceParentId: task.recurrenceParentId }),
    // Open boards show the new occurrence at once (its CREATED activity is written by the port).
    announceCopy: async (copyId, projectId) => {
      await taskSearchIndex.taskChanged(copyId);
      broadcast(projectId, 'task:created', await taskService.getTask(copyId));
    },
    followActionItems: (taskId, done) => actionItemService.followTask(taskId, done).then(() => undefined),
    recipients: (taskId, actorId) => taskRecipientIds(taskId, actorId),
    // Approvals: a task starting to wait tells whoever runs its project (else the admins); approved and
    // sent back tell its assignees and whoever finished it — each only while they can open the task.
    approvers: async (task, actorId) => visibleTaskRecipients(task.id, await approvalSource.approvers(task.projectId, actorId), actorId),
    approvalAudience: async (task, actorId, requestedById) => {
      const assignees = await prisma.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } });
      return visibleTaskRecipients(task.id, [...assignees.map((a) => a.userId), ...(requestedById ? [requestedById] : [])], actorId);
    },
    // The reason a task was sent back is the approver's comment on it (its notice is the sent-back one).
    sentBackComment: async (task, actorId, reason) => {
      const comment = await prisma.comment.create({ data: { taskId: task.id, userId: actorId, body: reason } });
      await taskSearchIndex.taskChanged(task.id);
      return comment;
    },
    // Approval turned off on one waiting copy: the series' next copy still needs approval.
    keepApprovalOnCopy: (copyId) => prisma.task.update({ where: { id: copyId }, data: { needsApproval: true } }),
    notify: (n) => notificationService.notify(n),
    record: (entry) => activityService.record(entry),
    onError: (err, taskId) => logger.error('action items could not follow their task', { err, taskId }),
  });
  onTaskMoved = (task, prevColumnId, actorId, extra) => statusChanged(task, prevColumnId, actorId, extra ?? {});

  // Deleting just the newest copy of a recurring series skips it: the next copy is made first, so
  // the series carries on instead of ending with it.
  onTaskDeleting = async (task) => {
    if (!task.recurrenceRule) return;
    const next = await recurrenceService.onTaskSkipped({
      id: task.id,
      dueDate: task.dueDate,
      startDate: task.startDate,
      recurrenceRule: task.recurrenceRule,
      recurrenceParentId: task.recurrenceParentId,
    });
    if (next) {
      await taskSearchIndex.taskChanged(next.id);
      broadcast(task.projectId, 'task:created', await taskService.getTask(next.id));
    }
  };

  // Deadline reminders: notify assignees of overdue + soon-due tasks. Runs at startup
  // and periodically; a PERSISTED per-day marker (reminder_logs) avoids re-notifying the same
  // task — unlike an in-memory guard, it survives restarts and is shared across instances.
  const reminderLogStore = createPrismaReminderLogStore(prisma);
  // Client view housekeeping, run with the sweep below (late-bound: its service is built further down).
  let pruneClientAccess: () => Promise<void> = async () => {};
  // Active users and admins, for the sweeps' recipient filtering (one query per sweep).
  const sweepAudience = async () => {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        status: true,
        notificationPrefs: true,
        roles: { select: { role: { select: { name: true } } } },
        // companies: each person's active companies (a task's team hears about it only inside them).
        companies: { where: { company: { status: 'ACTIVE' } }, select: { companyId: true } },
      },
    });
    const active = users.filter((u) => u.status === 'ACTIVE');
    return {
      users: active,
      activeIds: active.map((u) => u.id),
      adminIds: active.filter((u) => u.roles.some((r) => r.role.name === 'ADMIN')).map((u) => u.id),
      companiesOf: new Map(active.map((u) => [u.id, u.companies.map((c) => c.companyId)])),
    };
  };

  async function runReminderSweep(): Promise<void> {
    const period = todayKey(companyTz); // company-local yyyy-mm-dd
    await pruneReminderLog(prisma).catch(() => {}); // keep the marker table bounded
    await pruneClientAccess().catch(() => {}); // client view: old codes and expired sessions
    // Tasks of deleted projects are gone for everyone — no more reminders for them.
    const tasks = await prisma.task.findMany({
      where: { deletedAt: null, dueDate: { not: null }, project: { is: { deletedAt: null } } },
      select: { id: true, key: true, title: true, dueDate: true, completedAt: true, approvalRequestedAt: true, column: { select: { category: true } }, watchers: { select: { userId: true } }, ...taskAudienceSelect },
    });
    // Each user's reminder lead time comes from their notification preferences (default window otherwise).
    const { users, activeIds, adminIds, companiesOf } = await sweepAudience();
    const leadByUser = new Map<string, number>();
    for (const u of users) {
      const lead = normalizePreferences(u.notificationPrefs).reminderLeadMinutes;
      if (lead != null) leadByUser.set(u.id, lead);
    }
    const planned = planReminders(
      tasks.map((t) => ({
        id: t.id,
        key: t.key, // 1.22.3: "MICO-142 · Title"
        title: t.title,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        // Waiting for approval: no reminders until it is sent back (owner, 30 Oct).
        approvalRequestedAt: t.approvalRequestedAt,
        columnCategory: t.column?.category ?? null,
        // Watchers get due/overdue reminders too (deduped with assignees) — while they can still see the task.
        assigneeIds: filterTaskRecipients([...t.assignees.map((a) => a.userId), ...t.watchers.map((w) => w.userId)], toAudienceFacts(t), { activeIds, adminIds, companiesOf }),
      })),
      { leadMinutesFor: (id) => leadByUser.get(id), timeZone: companyTz },
    );
    await dispatchReminders(planned, {
      period,
      store: reminderLogStore,
      notify: (n) => notificationService.notify(n),
    });
  }
  // One instance at a time runs each sweep (lease lock) — no duplicate notifications / double
  // carry-forward across a multi-instance deployment. The lease expires so a crash never deadlocks it.
  const jobLock = createPrismaJobLockStore(prisma);
  const SWEEP_LEASE_MS = 10 * 60 * 1000;
  const runReminders = () =>
    runExclusive(jobLock, 'reminder-sweep', SWEEP_LEASE_MS, () => new Date(), runReminderSweep).catch(() => false);
  void runReminders();
  const reminderTimer = setInterval(() => void runReminders(), 6 * 60 * 60 * 1000);
  reminderTimer.unref?.();

  // A comment @mention notifies each mentioned user who can open the task (never the author): in
  // the app and, unless they muted mentions, by email quoting the comment (best-effort).
  onCommentMention = createMentionNotifier({
    usersByUsername: (usernames) => prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true, email: true } }),
    visibleRecipients: visibleTaskRecipients,
    notify: (input) => notificationService.notify(input),
    task: (taskId) => prisma.task.findUnique({ where: { id: taskId }, select: { key: true, title: true } }),
    authorName: async (authorId) => {
      const u = await prisma.user.findUnique({ where: { id: authorId }, select: { firstName: true, lastName: true, username: true } });
      return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.username : 'A teammate';
    },
    // companies: the task's project's company brand on the email.
    sendMentionEmail: async (email, params, taskId) => emailService.sendMention(email, params, await documentBrands.email.task(taskId).catch(() => undefined)),
    appUrl: env.APP_URL,
    logger,
  });

  // Any comment notifies the task's assignees + watchers (except the comment's author).
  onComment = async (taskId, authorId) => {
    const about = await taskNotice(taskId);
    for (const userId of await taskRecipientIds(taskId, authorId)) {
      await notificationService.notify({
        userId,
        type: 'TASK_COMMENT',
        title: 'New comment on your task',
        body: about,
        entityType: 'task',
        entityId: taskId,
      });
    }
  };

  // A task moved to another project: the people following it (assignees and watchers who can still
  // open it) hear where it went — never the person who moved it.
  const notifyProjectMove = createMoveNotifier({ recipients: (taskId, actorId) => taskRecipientIds(taskId, actorId), notify: (n) => notificationService.notify(n) });
  // Its new key (the old one stays findable) and the people taken off it change its words.
  onTaskProjectMoved = async (move) => {
    await taskSearchIndex.taskChanged(move.task.id);
    await notifyProjectMove(move);
  };

  // A chat @mention notifies each mentioned (real, active) user who can read the conversation —
  // never someone outside the DM or project, and never the author.
  onChatMention = async (usernames, authorId, conversationId) => {
    const mentioned = await prisma.user.findMany({ where: { username: { in: usernames }, deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
    for (const { id: userId } of mentioned) {
      if (userId === authorId) continue;
      if (!(await chatService.canUserAccessConversation(conversationId, userId))) continue;
      await notificationService.notify({
        userId,
        type: 'CHAT_MENTION',
        title: 'You were mentioned in chat',
        entityType: 'conversation',
        entityId: conversationId,
      });
    }
  };
  // A direct message notifies its recipient: one waiting notification per conversation, saying who
  // it is from and how many messages are waiting (not one anonymous notification per message).
  onChatDirect = async (recipientId, authorId, conversationId) => {
    if (recipientId === authorId) return;
    const [author, waiting] = await Promise.all([
      prisma.user.findUnique({ where: { id: authorId }, select: { firstName: true, lastName: true, username: true } }),
      chatService.unreadCount(conversationId, recipientId).catch(() => 1),
    ]);
    const senderName = author ? `${author.firstName ?? ''} ${author.lastName ?? ''}`.trim() || author.username : null;
    await notificationService.notifyOnce({
      userId: recipientId,
      type: 'CHAT_MESSAGE',
      title: directMessageTitle(senderName, waiting),
      entityType: 'conversation',
      entityId: conversationId,
    });
  };
  // Opening a conversation is reading what its notifications were about: clear them.
  onChatRead = async (conversationId, userId) => {
    await notificationService.markEntityRead(userId, 'conversation', conversationId);
  };

  const auditService = createAuditService({ audit: createPrismaAuditRepository(prisma), tasks: createPrismaAuditTaskRefs(prisma) });
  onClientMinutesHidden = auditMinutesMovedAway(auditService);

  const settingsService = createSettingsService({ settings: createPrismaSettingsRepository(prisma) });
  // companies: System → Companies and each person's companies (GET /me/companies). A company inherits
  // the site's week start, working hours and sender name until it has its own; the site's time zone
  // always. Logos go where uploads go, made at most 512 pixels on their long side.
  // companies: bound to the realtime server's re-sync below (refreshCompanyAccess), once it exists.
  let onCompanyAccessChanged: OnCompanyAccessChanged = () => {};
  // companies: people's companies and primary company, with their rules (User Management and the
  // Companies page's people both go through it).
  const companyMembership = createCompanyMembership({
    store: createPrismaMembershipStore(prisma),
    audit: auditService,
    onAccessChanged: (userIds) => onCompanyAccessChanged(userIds),
  });
  const companyService = createCompanyService({
    companies: createPrismaCompanyRepository(prisma),
    site: async () => {
      const [weekStart, workingHours] = await Promise.all([settingsService.companyWeekStart(), settingsService.workingHours()]);
      return { timeZone: companyTz, weekStart, workingHours, senderName: mailFromName(env.MAIL_FROM) };
    },
    audit: auditService,
    storage: attachmentStorage,
    shrink: (content, mimeType) => imageShrinker.shrink(content, mimeType, 512),
    onAccessChanged: (userIds, projectIds) => onCompanyAccessChanged(userIds, projectIds),
    people: companyMembership,
  });
  // companies: each company's name (with 2+ companies), logo and sender name on its PDFs, emails and
  // client page; week start and working hours inherit System Settings until a company sets its own (MC1 Task 14).
  const companyBranding = createCompanyBranding({
    prisma,
    site: { companyName: env.COMPANY_NAME, timeZone: companyTz, senderName: /^\s*(.*?)\s*<[^>]+>\s*$/.exec(env.MAIL_FROM)?.[1]?.trim() || null },
    settings: settingsService,
    readImage: async (url) => (url.startsWith('/uploads/') && attachmentStorage.read ? attachmentStorage.read(url.slice('/uploads/'.length)) : null),
    printable: (raw) => imageShrinker.toPrintable(raw),
    apiBaseUrl: env.API_BASE_URL,
  });
  const documentBrands = createDocumentBrands(companyBranding, prisma);
  // companies: each company's week start and working days and hours (MC1 Task 15); System Settings' until set.
  const companyTime = createCompanyTime(companyBranding, prisma);
  // The Management page (and its weekly summary) runs on the scope's week and working days: the picked
  // company's, else the reader's primary company's (Ruling 15).
  const managementSettings = {
    companyWeekStart: (v?: { id: string; roles: string[] }, pick: string | null = null) => (v ? companyTime.weekStartOfScope(v, pick) : settingsService.companyWeekStart()),
    workingHours: (v?: { id: string; roles: string[] }, pick: string | null = null) => (v ? companyTime.hoursFor({ viewer: v, pick }) : settingsService.workingHours()),
    dailyLimit: () => settingsService.dailyLimit(),
    weeklySummaryEnabled: () => settingsService.weeklySummaryEnabled(),
  };
  // Provider API keys are encrypted at rest (SECRETS_ENCRYPTION_KEY, else derived from the JWT secret).
  const aiConfigRepository = createPrismaAiConfigRepository(prisma, { logger });
  const aiConfigService = createAiConfigService({ repo: aiConfigRepository, audit: auditService, allowPrivateHosts: env.AI_ALLOW_PRIVATE_HOSTS });
  // Reload each switched-on AI provider's model list once a day (checked hourly, and at start-up),
  // so new models appear and retired ones are marked unavailable without anyone pressing Refresh.
  const runAiModelRefresh = () =>
    runExclusive(jobLock, 'ai-model-refresh', SWEEP_LEASE_MS, () => new Date(), async () => {
      const { refreshed, failed } = await aiConfigService.refreshDueProviders();
      if (refreshed || failed) logger.info('AI model lists refreshed', { refreshed, failed });
    }).catch((err) => {
      logger.error('AI model refresh failed', { err });
      return false;
    });
  void runAiModelRefresh();
  const aiModelTimer = setInterval(() => void runAiModelRefresh(), 60 * 60 * 1000);
  aiModelTimer.unref?.();
  // Product-facing AI features read the same config (default chat model) and call the provider,
  // within per-user limits and each model's concurrency limit.
  const aiFeatureService = createAiFeatureService({
    repo: aiConfigRepository,
    // "Describe it in plain English" may suggest one of the projects the person can see.
    // companies: …in the picked company, when the request has one.
    listProjectsFor: (user, pick) => projectService.listVisibleProjects(user, pick),
    // Describing a meeting may invite active users (only their names and usernames reach the AI) —
    // companies: only the people the requester knows (MC1 Task 9).
    listPeople: async (requester) => {
      const people = await prisma.user.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, username: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 1000,
      });
      return requester ? keepKnownPeople(companyAccess, { id: requester.userId, roles: requester.roles ?? [] }, people) : people;
    },
    timeZone: companyTz,
    allowPrivateHosts: env.AI_ALLOW_PRIVATE_HOSTS,
    limits: { perMinute: env.AI_USER_REQUESTS_PER_MINUTE, perDay: env.AI_USER_REQUESTS_PER_DAY },
  });

  // MICO AI: each person's private chats with the assistant. Its tools read with the app's own rules
  // (project access, the meeting rule, the chat module's conversations); it asks the same default chat
  // model as the other AI features, and every call counts against the person's AI limit.
  const micoAiData = createPrismaMicoAiData({
    prisma,
    projectAccess,
    meetingAccess,
    conversationIdsFor: (userId) => chatService.accessibleConversationIds(userId),
    finalMinutes: createPrismaFinalMinutesRepository(prisma),
  });
  // The changes it proposes are made only once the person confirms them, through the app's own
  // services as that person (with the usual checks, notifications and live updates). The meeting
  // emails and live updates are set up further down, so they are reached through these arrows.
  const gatherMinutes = createMinutesData({ meetingService, attendeeService, agendaService, noteService, actionItemService, resolveUserNames, resolveProject, resolveTaskKeys });
  const micoAiActions = createMicoAiActions({
    data: micoAiData,
    timeZone: companyTz,
    port: createMicoAiActionsPort({
      prisma,
      timeZone: companyTz,
      taskService,
      assigneeService,
      projectAccess,
      meetingService,
      attendeeService,
      agendaService,
      meetingNotify: {
        sendInvites: (meetingId, opts) => meetingNotifyService.sendInvites(meetingId, opts),
        sendCancellation: (meetingId, opts) => meetingNotifyService.sendCancellation(meetingId, opts),
      },
      finalMinutes: createPrismaFinalMinutesRepository(prisma),
      minutesFacts: async (viewer, meetingId) => minutesFacts((await gatherMinutes(viewer.userId, meetingId)).data),
      draftMinutesWithAi: (facts, requester, opts) => aiFeatureService.draftMinutes(facts, requester, opts),
      onFinalMinutesChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:updated'),
      workingDays: async () => (await settingsService.workingHours()).days,
      isActiveUser,
      broadcast: (projectId, event, payload) => broadcast(projectId, event, payload),
      audit: auditService,
      logger,
      // companies: "schedule a meeting" follows the meeting form's company and invite rules.
      meetingCompany,
      meetingInvitees,
    }),
  });
  // 1.22 (§10): AI work that keeps running in the background after the page is closed — MICO AI's
  // answers and the Final MOM's "Draft with AI". Jobs in ai_jobs: this server starts the ones it is
  // asked for at once, and every server sweeps every 15 s for due ones (a retry's wait over, or a
  // stopped server's job), each taken under a renewed lease so several servers never run one twice
  // and a restart resumes it.
  const aiJobStore = createPrismaAiJobStore(prisma);
  const aiJobs = createAiJobRunner({ store: aiJobStore, logger, retryDelaysMs: aiJobRetryDelays(env) });
  const micoAiService = createMicoAiService({
    repo: micoAiRepository,
    tools: createMicoAiTools({ data: micoAiData, timeZone: companyTz }),
    actions: micoAiActions,
    model: {
      ready: () => aiFeatureService.chatReady(),
      chat: (req, userId) => aiFeatureService.chat(req, { userId }),
      startQuestion: (userId) => aiFeatureService.startMicoAiQuestion(userId),
    },
    // 1.22: each answer is a background job; the person who asked is told by the bell and a push.
    jobs: {
      enqueue: (job) => aiJobs.enqueue(job),
      cancel: (kind, subjectId) => aiJobs.cancel(kind, subjectId),
      watch: (kind, subjectId) => aiJobs.watch(kind, subjectId),
      activeSubjects: (answerIds) => aiJobStore.activeSubjects('mico-ai', answerIds),
    },
    notify: (n) => notificationService.notify(n),
    audit: auditService,
    timeZone: companyTz,
    userName: async (id) => {
      const u = await prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true, username: true } });
      return u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username : '';
    },
    logger,
  });
  // Answers a restart cut off (pending past the time limit) are marked interrupted, so no chat stays blocked.
  void micoAiService.interruptStale().catch((err) => logger.error('MICO AI: marking interrupted answers failed', { err }));

  // 1.22 (§10): the Final MOM's "Draft with AI" as a background job too (the runner is above).
  const aiJobArchive = createPrismaArchiveLookup(prisma);
  const finalMinutesAi = createFinalMinutesAi({
    jobs: aiJobs,
    store: aiJobStore,
    finalMinutes: createPrismaFinalMinutesRepository(prisma),
    draftMinutesWithAi: (facts, requester, opts) => aiFeatureService.draftMinutes(facts, requester, opts),
    ready: () => aiFeatureService.chatReady(),
    checkLimits: (userId) => aiFeatureService.checkLimits(userId),
    // The bell, the phone push and the live pop-up for the person who asked.
    notify: (n) => notificationService.notify(n),
    // An archived project's minutes are not changed in the background: the draft is offered instead.
    isArchived: async (meetingId) => {
      const subject = await aiJobArchive.subjectOf('meeting', meetingId);
      return !!subject?.projectId && (await aiJobArchive.isArchived(subject.projectId));
    },
    onChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:updated'),
    userNames: resolveUserNames,
  });
  aiJobs.register('final-minutes', finalMinutesAi.handler);
  aiJobs.register('mico-ai', micoAiService.jobHandler);
  aiJobs.startSweeps();

  // Per-date boards: each night carry still-open tasks onto today's board. Config lives in
  // system settings (admin-editable) — carryForward.enabled + carryForward.statuses — with defaults.
  const carryForwardService = createCarryForwardService({
    repo: createPrismaCarryForwardRepo(prisma),
    timeZone: companyTz,
    // Read through the setting's schema, so a stored "false" really means off.
    config: () => settingsService.getCarryForward(DEFAULT_CARRY_STATUSES),
  });
  const runCarryForward = () =>
    runExclusive(jobLock, 'carry-forward-sweep', SWEEP_LEASE_MS, () => new Date(), async () => {
      await carryForwardService.run();
    }).catch(() => false);
  void runCarryForward();
  // Re-check hourly so the sweep fires soon after local midnight without a precise scheduler.
  const carryTimer = setInterval(() => void runCarryForward(), 60 * 60 * 1000);
  carryTimer.unref?.();

  const tokenService = createTokenService({
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL_SECONDS,
    refreshTtl: env.JWT_REFRESH_TTL_SECONDS,
    refreshStore: createPrismaRefreshTokenStore(prisma),
    // Seals each rotation's successor so a phone whose refresh reply was lost can retry for 2 minutes.
    box: secretBoxFromEnv(env),
  });
  // Now that the token service exists, a password change revokes every other session for that user.
  revokeSessions = (userId) => tokenService.revokeAllForUser(userId);
  issueSession = (u) => tokenService.issueTokens(u);

  // Brand every outgoing email from env (contact/legal details, logo, app URL).
  configureBrand({
    companyName: env.COMPANY_NAME,
    productName: env.PRODUCT_NAME,
    supportEmail: env.SUPPORT_EMAIL,
    websiteUrl: env.COMPANY_WEBSITE_URL,
    companyAddress: env.COMPANY_ADDRESS,
    appUrl: env.APP_URL,
    // The white MICO360 wordmark for the brand-red header, hosted by this server, unless overridden.
    logoUrl: env.EMAIL_LOGO_URL || `${env.API_BASE_URL}/email-assets/email-logo.png`,
  });

  // Mailjet when its keys are set; on a development machine, optionally a local test mailbox.
  const mail = chooseTransport({
    nodeEnv: env.NODE_ENV,
    mailjet: { apiKey: env.MAILJET_API_KEY, secretKey: env.MAILJET_SECRET_KEY, from: env.MAIL_FROM },
    outboxDir: env.EMAIL_OUTBOX_DIR,
  });
  const emailService = createEmailService({
    transport: mail.transport,
    isSuppressed: createPrismaSuppressionChecker(prisma),
    log: createPrismaEmailLogStore(prisma),
    logger,
  });
  if (mail.kind === 'outbox') {
    logger.warn('Email is saved to a local test mailbox, not sent (EMAIL_OUTBOX_DIR)', { dir: env.EMAIL_OUTBOX_DIR });
  }
  if (mail.outboxIgnored) {
    logger.warn('EMAIL_OUTBOX_DIR is ignored in production: set the Mailjet keys to send email');
  }
  if (!emailService.isConfigured()) {
    logger.warn('Mailjet keys are not set: sign-in codes, password-reset links and meeting invitations are disabled');
  }

  const emailWebhookService = createEmailWebhookService({ store: createPrismaEmailEventStore(prisma) });

  // Meeting calendar invitations, reminders, cancellations + minutes distribution.
  const resolveMeetingUser = async (userId: string) => {
    const u = await userMgmtRepository.findById(userId).catch(() => null);
    if (!u || !u.email) return null;
    return { name: `${u.firstName} ${u.lastName}`.trim() || u.username, email: u.email };
  };
  const meetingNotifyService = createMeetingNotifyService({
    meetings: meetingRepository,
    attendees: {
      listByMeeting: (id) => attendeeService.listAttendees(id),
      markInvited: (ids, at) => attendeeRepository.markInvited!(ids, at),
    },
    email: emailService,
    resolveUser: resolveMeetingUser,
    // A typed minutes address that is someone's account (case aside: the column's collation).
    findUserByEmail: async (email) => {
      const u = await prisma.user.findFirst({ where: { email, deletedAt: null, status: 'ACTIVE' }, select: { id: true, email: true, firstName: true, lastName: true, username: true } });
      return u ? { id: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim() || u.username } : null;
    },
    resolveProjectName: async (projectId) => (await resolveProject(projectId))?.name ?? null,
    resolveProjectLook: async (projectId) => {
      const p = await resolveProject(projectId);
      return p ? { name: p.name, imageUrl: p.imageUrl ?? null, color: p.color ?? null } : null;
    },
    assetBaseUrl: env.API_BASE_URL,
    appUrl: env.APP_URL,
    defaultTimeZone: companyTz, // times in emails are shown in the company zone, not UTC
    logger,
    emailOptions: (m) => documentBrands.email.meeting(m.id), // companies: the meeting's company
  });
  // Taking someone off an invited meeting removes it from their calendar (best-effort).
  onAttendeeRemoved = (meetingId, attendee, alsoFrom) => {
    Promise.all(alsoFrom.map((id) => meetingRepository.findById(id)))
      .then((later) => meetingNotifyService.sendAttendeeRemoved(meetingId, attendee, { alsoFrom: later.filter((m): m is NonNullable<typeof m> => !!m) }))
      .catch((err) => logger.error('meeting attendee removal notice failed', { err, meetingId }));
  };
  // Keep repeating meetings created ~3 months ahead (one lease-locked instance, every 6 hours).
  const runMeetingSeriesTopUp = () =>
    runExclusive(jobLock, 'meeting-series-top-up', SWEEP_LEASE_MS, () => new Date(), async () => {
      await meetingSeriesService.extendAll((err, rootId) => logger.error('meeting series top-up failed', { err, meetingId: rootId }));
    }).catch((err) => {
      logger.error('meeting series top-up failed', { err });
      return false;
    });
  void runMeetingSeriesTopUp();
  const meetingSeriesTimer = setInterval(() => void runMeetingSeriesTopUp(), 6 * 60 * 60 * 1000);
  meetingSeriesTimer.unref?.();
  // Automatic meeting reminders (System Settings → Meeting reminders: by default 24 hours, 12 hours
  // and 15 minutes before): every minute, one lease-locked instance sends the ones due — the bell,
  // the phone push on its own channel, and the email for times ticked "also by email". Each send is
  // a unique row, so overlapping runs and several servers never send one twice. The lease is under a
  // minute (leases are held for their whole length) so the sweep really runs every minute.
  const meetingReminderService = createMeetingReminderService({
    settings: () => settingsService.meetingReminders(),
    source: createPrismaMeetingReminderSource(prisma),
    store: createPrismaMeetingReminderStore(prisma),
    notify: (input, opts) => notificationService.notify(input, opts),
    email: emailService,
    appUrl: env.APP_URL,
    defaultTimeZone: companyTz,
    logger,
    emailOptions: documentBrands.email.meeting, // companies: the meeting's company
  });
  const MEETING_REMINDER_LEASE_MS = 55 * 1000;
  const runMeetingReminders = () =>
    runExclusive(jobLock, 'meeting-reminders', MEETING_REMINDER_LEASE_MS, () => new Date(), async () => {
      await meetingReminderService.runSweep();
    }).catch((err) => {
      logger.error('meeting reminder sweep failed', { err });
      return false;
    });
  void runMeetingReminders();
  const meetingReminderTimer = setInterval(() => void runMeetingReminders(), 60 * 1000);
  meetingReminderTimer.unref?.();
  // A meeting that is over is Completed (unless cancelled): every 5 minutes, one lease-locked
  // instance closes the ones whose end has passed. No emails; open pages refresh.
  const runMeetingCompletion = () =>
    runExclusive(jobLock, 'meeting-completion-sweep', SWEEP_LEASE_MS, () => new Date(), async () => {
      for (const id of await meetingRepository.completeEnded(new Date())) broadcastMeetingChange(id, 'meeting:updated');
    }).catch((err) => {
      logger.error('meeting completion sweep failed', { err });
      return false;
    });
  void runMeetingCompletion();
  const meetingCompletionTimer = setInterval(() => void runMeetingCompletion(), 5 * 60 * 1000);
  meetingCompletionTimer.unref?.();

  // ── Engagement: daily digest + escalation sweeps ──────────────────────────
  // Company-local calendar day + hour, used to gate the once-a-day digest to the morning.
  const companyDayHour = (): { day: string; hour: number } => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: companyTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
  };
  const DIGEST_HOUR = 7; // send the morning digest from 07:00 company-local

  async function runDigestSweep(): Promise<void> {
    const { day, hour } = companyDayHour();
    if (hour < DIGEST_HOUR) return; // wait until the morning; a later sweep sends it
    const tasks = await prisma.task.findMany({
      where: { deletedAt: null, dueDate: { not: null }, project: { is: { deletedAt: null } } },
      select: { id: true, key: true, title: true, dueDate: true, completedAt: true, approvalRequestedAt: true, column: { select: { category: true } }, watchers: { select: { userId: true } }, ...taskAudienceSelect },
    });
    const { users, activeIds, adminIds, companiesOf } = await sweepAudience();
    const digests = buildDigests(
      tasks.map((t) => ({
        id: t.id, key: t.key, title: t.title, dueDate: t.dueDate, completedAt: t.completedAt, approvalRequestedAt: t.approvalRequestedAt,
        columnCategory: t.column?.category ?? null,
        // Someone who has left the project no longer gets its tasks in their digest.
        recipientIds: filterTaskRecipients([...t.assignees.map((a) => a.userId), ...t.watchers.map((w) => w.userId)], toAudienceFacts(t), { activeIds, adminIds, companiesOf }),
      })),
      { timeZone: companyTz },
    );
    const userById = new Map(users.map((u) => [u.id, u]));
    for (const digest of digests) {
      const user = userById.get(digest.userId);
      if (!user) continue;
      // A muted digest isn’t written.
      if (isMuted(normalizePreferences(user.notificationPrefs), 'TASK_DIGEST')) continue;
      // A per-day marker keeps the digest to once daily even as the sweep re-runs hourly.
      const dedupe = `digest:${digest.userId}:${day}`;
      if (await reminderLogStore.has(dedupe)) continue;
      await reminderLogStore.add(dedupe);
      const summary = `${digest.overdue.length} overdue · ${digest.dueToday.length} due today`;
      const items = [...digest.overdue.map((i) => `${i.key} ${i.title} (overdue, due ${i.dueDate})`), ...digest.dueToday.map((i) => `${i.key} ${i.title} (due today)`)];
      const lines = items.map((i) => `• ${i}`).join('\n');
      // In-app notification — reliable regardless of email deliverability. Nothing stored means
      // the type is suppressed for this user, so no email either.
      // The morning emails (pending tasks, completed yesterday) are the daily task emails below.
      await notificationService.notify({ userId: digest.userId, type: 'TASK_DIGEST', title: `Your daily digest — ${summary}`, body: lines, entityType: 'digest', entityId: day });
    }
  }

  async function runEscalationSweep(): Promise<void> {
    const { day } = companyDayHour();
    const tasks = await prisma.task.findMany({
      where: { deletedAt: null, project: { is: { deletedAt: null } } },
      select: { id: true, key: true, title: true, dueDate: true, completedAt: true, approvalRequestedAt: true, projectId: true, column: { select: { category: true } } },
    });
    const plans = planEscalations(
      tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, dueDate: t.dueDate, completedAt: t.completedAt, approvalRequestedAt: t.approvalRequestedAt, projectId: t.projectId, columnCategory: t.column?.category ?? null })),
      { timeZone: companyTz },
    );
    if (plans.length === 0) return;
    // Recipients = whoever runs each project: its owner, its named manager and its MANAGER members.
    const recipientsByProject = await projectRunnerIds(prisma, Array.from(new Set(plans.map((p) => p.projectId))));
    const planned = plans.flatMap((plan) =>
      (recipientsByProject.get(plan.projectId) ?? []).map((userId) => ({
        userId,
        type: 'TASK_ESCALATION',
        title: plan.reason === 'blocked' ? `Escalation: ${plan.key} is Blocked` : `Escalation: ${plan.key} is ${plan.overdueDays} day${plan.overdueDays === 1 ? '' : 's'} overdue`,
        body: plan.title,
        entityType: 'task',
        entityId: plan.taskId,
      })),
    );
    await dispatchReminders(planned, { period: day, store: reminderLogStore, notify: (n) => notificationService.notify(n) });
  }

  const runDigest = () => runExclusive(jobLock, 'daily-digest', SWEEP_LEASE_MS, () => new Date(), runDigestSweep).catch(() => false);
  const runEscalation = () => runExclusive(jobLock, 'escalation-sweep', SWEEP_LEASE_MS, () => new Date(), runEscalationSweep).catch(() => false);
  void runDigest();
  void runEscalation();
  const digestTimer = setInterval(() => { void runDigest(); void runEscalation(); }, 60 * 60 * 1000);
  digestTimer.unref?.();

  // ── The daily email (1.22: one email, in parts), every morning ──
  // Each person's email goes at their time (06:00 unless they chose another, in their own time zone).
  // The sweep runs every minute on one lease-locked instance; one record per person, day and email
  // keeps each to a single send and is the delivery log. Nothing is attempted while email isn't set up.
  const dailyEmailRepository = createPrismaDailyEmailRepository(prisma);
  const dailyEmailSources = createPrismaDailyEmailSources(prisma);
  const dailyEmailService = createDailyEmailService({
    repo: dailyEmailRepository,
    people: dailyEmailSources.people,
    // Their tasks, their day's meetings and the projects they run; also how many tasks wait for their approval.
    tasks: { ...dailyEmailSources.tasks, awaitingApproval: (userId) => approvalSource.countFor(userId) },
    // companies: one email per person, under their primary company's brand and sender name (MC1 Task 16).
    send: (to, content, template, opts) => emailService.sendPrepared(template, to, content, opts),
    emailOptions: documentBrands.email.person,
    isConfigured: () => emailService.isConfigured(),
    companyTimeZone: companyTz,
    appUrl: env.APP_URL,
    // Project pictures are served by this server (/uploads/…), as in the minutes email.
    assetUrl: env.API_BASE_URL,
    logger,
    // When the sweep last checked: in the database, so a restart or another server still knows it.
    checks: createPrismaDailyEmailCheckStore(prisma),
  });
  // Job leases are held for their whole length (never released), so this one is under a minute or
  // the sweep would only run every 10 minutes. Overlapping runs are harmless: each email is claimed
  // once (a unique row) and each retry is retaken by one run only.
  const DAILY_EMAIL_LEASE_MS = 55 * 1000;
  const runDailyEmails = () =>
    runExclusive(jobLock, 'daily-task-emails', DAILY_EMAIL_LEASE_MS, () => new Date(), async () => {
      await dailyEmailService.runSweep();
    }).catch((err) => {
      logger.error('daily task email sweep failed', { err });
      return false;
    });
  void runDailyEmails();
  const dailyEmailTimer = setInterval(() => void runDailyEmails(), 60 * 1000);
  dailyEmailTimer.unref?.();

  // ── The Management page, and its weekly summary email ──────────────────────
  // Admins see every project; the people who run a project see the projects they run. The summary
  // goes on the first working morning of the company week, at each person's daily-email time, to
  // everyone who can see the page (their own projects only), once a week — the same lease-locked,
  // every-minute sweep and retries as the daily task emails, with a company-wide switch.
  const managementService = createManagementFromPrisma(prisma, { settings: managementSettings, timeZone: companyTz }); // companies: the reader's week
  const weeklySummaryService = createWeeklySummaryFromPrisma(prisma, {
    management: managementService,
    settings: managementSettings,
    // companies: one summary per person, a section per company, under their primary company's brand (MC1 Task 16).
    send: (to, content, template, opts) => emailService.sendPrepared(template, to, content, opts),
    emailOptions: documentBrands.email.person,
    isConfigured: () => emailService.isConfigured(),
    companyTimeZone: companyTz,
    appUrl: env.APP_URL,
    logger,
    // companies: each person's summary goes on their primary company's first working day.
    calendarOf: (userId) => companyTime.calendarOf(userId),
    calendars: () => companyTime.calendars(),
  });
  const runWeeklySummary = () =>
    runExclusive(jobLock, 'weekly-management-summary', DAILY_EMAIL_LEASE_MS, () => new Date(), async () => {
      await weeklySummaryService.runSweep();
    }).catch((err) => {
      logger.error('weekly management summary sweep failed', { err });
      return false;
    });
  void runWeeklySummary();
  const weeklySummaryTimer = setInterval(() => void runWeeklySummary(), 60 * 1000);
  weeklySummaryTimer.unref?.();

  const otpService = createOtpService({
    users: createPrismaOtpUserLookup(prisma),
    otps: createPrismaOtpStore(prisma),
    mailer: emailService,
    ttlSeconds: env.OTP_TTL_SECONDS,
    otpLength: env.OTP_LENGTH,
    maxAttempts: 3,
    logger,
    emailOptions: documentBrands.email.person, // companies: the person's primary company
  });

  const passwordResetService = createPasswordResetService({
    store: createPrismaPasswordResetStore(prisma),
    users: createPrismaResetUserRepo(prisma),
    mailer: emailService,
    ttlSeconds: env.PASSWORD_RESET_TTL_SECONDS,
    appUrl: env.APP_URL,
    hashPassword,
    revokeSessions: (userId) => tokenService.revokeAllForUser(userId),
    onSessionsRevoked: (userId) => onSessionsRevoked(userId),
    forgetDevices: (userId) => deviceTokenRepository.deleteForUser(userId).then(() => undefined),
    logger,
    emailOptions: documentBrands.email.person, // companies: the person's primary company
  });

  // Realtime broadcasters are wired after the HTTP server exists (below).
  let broadcast: (projectId: string, event: string, payload: unknown) => void = () => {};
  let broadcastToUser: (userId: string, event: string, payload: unknown) => void = () => {};
  let broadcastToAudience: (audience: { projectId?: string | null; userIds?: string[] }, event: string, payload: unknown) => void = () => {};

  // Live account state (token version, status, current roles) for the HTTP guard and sockets:
  // a suspended, deleted or demoted user loses access at once, not when their token expires.
  const userStateLookup = createPrismaUserStateLookup(prisma);

  // The running build's version, build time and changelog (written by the build: dist/src/release.json).
  // package.json sits beside src/ when running from source, and two levels up from dist/src/.
  const packageFile = [resolvePath(__dirname, '..', 'package.json'), resolvePath(__dirname, '..', '..', 'package.json')].find((f) => existsSync(f))!;
  const packageVersion = (JSON.parse(readFileSync(packageFile, 'utf8')) as { version: string }).version;
  const release = loadReleaseFile(resolvePath(__dirname, 'release.json'), { version: packageVersion, startedAt: new Date() });
  logger.info('Release', { version: release.build.version, builtAt: release.build.builtAt, commit: release.build.commit, source: release.source });

  // The hosted Android app lives in a folder deploys keep (made here, so it is there to upload into).
  const downloadsDir = downloadsDirFor(env, process.cwd());
  try {
    mkdirSync(downloadsDir, { recursive: true });
  } catch (err) {
    logger.warn('Could not create the downloads folder', { downloadsDir, error: err instanceof Error ? err.message : String(err) });
  }

  // Welcome emails from User Management: a "Set your password" link (single use, 7 days) with the
  // username, the site and the apps it offers. Sent only when an administrator asks, never by itself.
  const webRootDir = env.WEB_ROOT ? resolvePath(process.cwd(), env.WEB_ROOT) : null;
  const welcomeService = createWelcomeService({
    users: userMgmtRepository,
    tokens: createPrismaWelcomeTokenStore(prisma),
    mailer: emailService,
    appUrl: env.APP_URL,
    downloads: () => emailDownloadLinks({ appUrl: env.APP_URL, androidAppUrl: env.ANDROID_APP_URL, webRoot: webRootDir, downloadsDir }),
    logger,
    emailOptions: documentBrands.email.person, // companies: the person's primary company
  });

  // ── Nightly backups (docs/BACKUPS.md) ──────────────────────────────────────
  // The whole database and the uploaded files, every night from 02:00 company time, into BACKUP_DIR
  // (and the owner's Google Drive when connected); 7 nightly + 4 weekly copies are kept. Checked every
  // 10 minutes on one lease-locked instance; a server that was off at 02:00 catches up the same day.
  // The first check waits two minutes, so a backup never competes with the server starting up.
  const backups = createBackupsFromPrisma(prisma, {
    env,
    cwd: process.cwd(),
    appVersion: release.build.version,
    timeZone: companyTz,
    weekStart: () => settingsService.companyWeekStart(),
    isActiveAdmin: async (userId) => {
      const state = await userStateLookup(userId);
      return Boolean(state?.active && state.roles.includes('ADMIN'));
    },
    // Failures go to every active administrator by email (when email is set up); success is quiet.
    alertAdmins: async ({ title, message }) => {
      if (!emailService.isConfigured()) return;
      const { users, adminIds } = await sweepAudience();
      for (const u of users) {
        if (!adminIds.includes(u.id) || !u.email) continue;
        await emailService
          .sendAlert(u.email, { title, message, tone: 'danger', actionLabel: 'Open System Settings', actionLink: `${env.APP_URL.replace(/\/+$/, '')}/admin/settings#backups` })
          .catch((err) => logger.warn('backup alert email failed', { err, to: u.email }));
      }
    },
    logger,
  });
  logger.info('Backups', { folder: backups.backupDir, nightly: env.BACKUP_NIGHTLY, encrypted: Boolean(env.BACKUP_ENCRYPTION_KEY), googleDrive: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
  const runNightlyBackup = () =>
    runExclusive(jobLock, 'nightly-backup', 9 * 60 * 1000, () => new Date(), async () => {
      await backups.service.runNightlyIfDue();
    }).catch((err) => {
      logger.error('nightly backup sweep failed', { err });
      return false;
    });
  const firstBackupCheck = setTimeout(() => void runNightlyBackup(), 2 * 60 * 1000);
  firstBackupCheck.unref?.();
  const backupTimer = setInterval(() => void runNightlyBackup(), 10 * 60 * 1000);
  backupTimer.unref?.();

  // Client view: a client follows one project on a read-only page — a private link that opens only
  // with a code emailed to them; nothing in it is a staff account or session.
  const readStoredProjectImage = async (url: string) =>
    url.startsWith('/uploads/') && attachmentStorage.read ? attachmentStorage.read(url.slice('/uploads/'.length)) : null;

  // Inspection checklists: forms, inspections on a project's team, follow-up tasks, reports.
  const inspectionService = createInspectionService({
    store: createPrismaInspectionStore(prisma),
    // "Done late" is finished after the end of the check's due day in the company time zone.
    timeZone: companyTz,
    ports: createInspectionPorts({
      prisma,
      access: projectAccess,
      authz: projectAuthz,
      // Finishing a check's inspection completes it through the task service's move (the normal status path).
      tasks: taskService,
      // A schedule stopped by deleting its form gets the history line a person stopping it would.
      onTaskUpdated: (before, after, actorId) => onTaskUpdated(before, after, actorId),
      columns: columnService,
      assignees: assigneeService,
      broadcast: (projectId, event, payload) => broadcast(projectId, event, payload),
      userNames: resolveUserNames,
      recordActivity: recordTaskActivity,
      audit: auditService,
      // A signature the picture library can't read is refused; without the library it is kept as checked.
      cleanSignature: async (png) => {
        const out = await imageShrinker.toPrintable(png);
        if (out) return out;
        if (imageShrinker.status() === true) throw new Error('The signature picture could not be read.');
        return null;
      },
      logger,
    }),
  });
  const clientAccessService = createClientAccessService({
    store: createPrismaClientShareStore(prisma),
    source: createPrismaClientViewSource(prisma),
    mailer: {
      isConfigured: () => emailService.isConfigured(),
      sendClientInvitation: (email, params, opts) => emailService.sendClientInvitation(email, params, opts),
      sendClientCode: (email, params, opts) => emailService.sendClientCode(email, params, opts),
    },
    // companies: the project's main company on the client's emails, PDFs and page.
    branding: {
      email: documentBrands.email.project,
      pdf: documentBrands.pdf.project,
      page: async (projectId) => companyBranding.clientPage(await companyBranding.forProject(projectId)),
    },
    userName: async (id) => {
      const u = await prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true, username: true } });
      return u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username : null;
    },
    appUrl: env.APP_URL,
    assetUrl: env.API_BASE_URL,
    timeZone: companyTz,
    audit: auditService,
    projectImage: (url) => readProjectPicture(url, readStoredProjectImage, imageShrinker.toPrintable),
    logger,
    // Finished inspection reports marked "Show to client".
    inspections: {
      list: (projectId) => inspectionService.clientInspectionSummaries(projectId, companyTz),
      one: (projectId, id) => inspectionService.clientInspectionOf(projectId, id, companyTz),
    },
  });
  const clientFlags = createPrismaClientFlags(prisma, (taskId) => taskService.getTask(taskId));
  pruneClientAccess = () => clientAccessService.prune();

  const app = await buildApp({
    about: { release },
    seriesInstanceCount: (seriesId) => recurrencePort.countInstances(seriesId),
    // Task approvals: the To approve list, and who may approve a task (its details).
    approvalSource,
    taskApprovalDetails: (viewer, task) => approvalSource.details(viewer, task),
    // A task's details name the form it carries (a form deleted since still names itself, marked).
    taskInspectionForm: async (id) => {
      const f = await prisma.inspectionForm.findUnique({ where: { id }, select: { id: true, title: true, deletedAt: true } });
      return f ? { id: f.id, title: f.title, deleted: f.deletedAt !== null } : null;
    },
    userPreferences: createPrismaPreferences(prisma),
    recordTaskActivity,
    userState: userStateLookup,
    onTaskEvent: (projectId, event, payload) => broadcast(projectId, event, payload),
    onChatUserEvent: (userId, event, payload) => broadcastToUser(userId, event, payload),
    chatService,
    logger,
    errorReporter,
    authService,
    tokenService,
    otpService,
    passwordResetService,
    projectService,
    projectOverview: createPrismaProjectOverviewSource(prisma),
    timelineSource: createPrismaTimelineSource(prisma),
    workloadStore: createPrismaWorkloadStore(prisma),
    projectAccess,
    companyAccess,
    // 1.22: an archived project is read-only on the server too (companies/archive-guard.ts).
    archiveLookup: createPrismaArchiveLookup(prisma),
    companyService,
    companyMembership,
    projectCompanies,
    onProjectAudienceChanged: (projectId) => onProjectAudienceChanged(projectId),
    // companies: people for pickers inside projects (team candidates, meeting invitations).
    personOptions,
    // companies: a project's active companies — its Team tab offers their people (any of them).
    projectCompanyIds: async (projectId: string) => (peopleLookup.projectCompanyIds ? peopleLookup.projectCompanyIds(projectId) : null),
    // companies (MC1 Task 10): who may be invited to a meeting, and a standalone meeting's company.
    meetingInvitees,
    meetingCompany,
    pdfBranding: documentBrands.pdf, // companies: each PDF's company name and logo
    companyTime, // companies: each company's week start and working hours
    columnService,
    memberService,
    projectAuthz,
    projectNotices: createProjectNotices({
      notify: (n) => notificationService.notify(n),
      nameOf: async (userId) => {
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, username: true } });
        return u ? `${u.firstName} ${u.lastName}`.trim() || u.username : 'Someone';
      },
      projectName: async (projectId) => (await projectService.getProject(projectId)).name,
      logger,
    }),
    taskService,
    taskMoveService,
    carryForwardService,
    assigneeService,
    watcherService,
    tagService,
    checklistService,
    externalContactService,
    commentService,
    attachmentService,
    chatAttachmentStorage: attachmentStorage,
    attachmentAllowedMime,
    attachmentMaxSizeBytes: env.UPLOAD_MAX_BYTES,
    shrinkImage: imageShrinker.shrink,
    pictureShrinking: imageShrinker.status,
    dependencyService,
    userService,
    welcomeService,
    notificationService,
    dailyEmails: { service: dailyEmailService, log: dailyEmailRepository, isConfigured: () => emailService.isConfigured() },
    deviceTokenService,
    reportService,
    // Task exports (Excel / PDF) read the task with its lists in one go.
    taskExportSource: createPrismaTaskExportSource(prisma, companyTz),
    // The task PDF shows the task's pictures: read back from where attachments are stored, made small.
    readAttachment: async (storageKey: string) => (attachmentStorage.read ? attachmentStorage.read(storageKey) : null),
    pictureThumbnail: imageShrinker.toThumbnail,
    // Names shown in report exports: the filtered project and team member, and who generated it.
    reportNames: {
      async project(id) {
        return (await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { name: true } }))?.name ?? null;
      },
      async user(id) {
        const u = await prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true, username: true } });
        return u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.username : null;
      },
    },
    searchService,
    taskSearch: taskSearchEngine,
    meetingService,
    meetingSeriesService,
    projectMeetings: { load: createPrismaProjectMeetingsSource(prisma).load, timeZone: companyTz },
    isActiveUser,
    // Draft agenda: the project's open tasks and the last meeting's leftovers, as far as the person may see.
    meetingAgendaSources: (requester, input) =>
      gatherAgendaSources(
        {
          store: agendaSourceStore,
          async canUseProject(user, projectId) {
            const ids = await meetingAccess.accessibleProjectIds(user.id, user.roles);
            return !ids || ids.includes(projectId);
          },
          canViewMeeting: (userId, roles, meetingId) => meetingAccess.canViewMeeting(userId, roles, meetingId),
          timeZone: companyTz,
        },
        { requester, ...input },
      ),
    // Schedule meeting's free times: who is busy, inside the company's meeting hours.
    meetingFreeTimes: {
      busy: meetingRepository,
      // companies: the hours of the meeting's project / company / the meeting — only ones the asker may
      // use (else theirs): a project they can see, one of their companies, a meeting they can open.
      workingHours: async (target) =>
        target
          ? companyTime.hoursFor(
              await usableHoursTarget(target, {
                seeProject: (viewer, projectId) => companyAccess.canSeeProject(viewer, projectId),
                companyIds: (userId) => companyAccess.activeCompanyIds(userId),
                openMeeting: (viewer, meetingId) => meetingAccess.canViewMeeting(viewer.id, viewer.roles, meetingId),
              }),
            )
          : settingsService.workingHours(),
      userNames: resolveUserNames,
      timeZone: companyTz,
    },
    meetingAccess,
    attendeeService,
    agendaService,
    noteService,
    noteTaskService,
    meetingNotifyService,
    actionItemService,
    resolveMeetingProjectId,
    resolveTaskKeys,
    meetingListCounts,
    resolveUserNames,
    resolveProject,
    // Final minutes (Final MOM): kept in the meeting_minutes table, drafted by the same AI as the other features.
    finalMinutesRepository: createPrismaFinalMinutesRepository(prisma),
    // The minutes email's "Sent" log (meeting_minutes_sends) and the Cc suggestions.
    minutesSendRepository: createPrismaMinutesSendRepository(prisma),
    draftMinutesWithAi: (facts: string, requester: { userId: string; roles?: string[] }) => aiFeatureService.draftMinutes(facts, requester),
    // 1.22 (§10): …in the background — answered at once, kept as the draft (or offered) when ready.
    finalMinutesAi,
    // Final minutes saved, approved or reopened: `meeting:updated`, which every client (the apps
    // since 2a included) already answers by loading the meeting, its final minutes and the lists.
    onFinalMinutesChanged: (meetingId: string) => broadcastMeetingChange(meetingId, 'meeting:updated'),
    // The minutes PDF prints the project's picture: read it back from where uploads are stored.
    readProjectImage: async (url: string) =>
      url.startsWith('/uploads/') && attachmentStorage.read ? attachmentStorage.read(url.slice('/uploads/'.length)) : null,
    // …and a WebP, GIF or unusual PNG picture is converted so the logo still prints.
    printableProjectImage: imageShrinker.toPrintable,
    activityService,
    auditService,
    settingsService,
    aiConfigService,
    aiFeatureService,
    micoAiService,
    emailWebhookService,
    mailjetWebhookToken: env.MAILJET_WEBHOOK_TOKEN || undefined,
    corsOrigins: corsOrigin(parseCorsOrigins(env.CORS_ORIGINS)),
    appConfig: {
      timeZone: resolveTimeZone(env.COMPANY_TIMEZONE),
      productName: env.PRODUCT_NAME,
      companyName: env.COMPANY_NAME,
      emailEnabled: emailService.isConfigured(),
      // The company week start (everyone's default) and the weekly summary switch, read on each /config.
      company: () => settingsService.companySettings(),
      // The APK this server hosts (the downloads folder, or the web root); otherwise ANDROID_APP_URL (if set).
      androidAppUrl: androidAppLink(env.ANDROID_APP_URL, env.WEB_ROOT ? resolvePath(process.cwd(), env.WEB_ROOT) : null, downloadsDir),
      // The version inside that APK, in the order it is served (the downloads folder, then the web root).
      androidAppVersion: createHostedApkVersion([
        resolvePath(downloadsDir, 'MICO360-Tasks.apk'),
        env.WEB_ROOT ? resolvePath(process.cwd(), env.WEB_ROOT, 'downloads', 'MICO360-Tasks.apk') : null,
      ]),
    },
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    rateLimitMax: env.RATE_LIMIT_MAX,
    authRateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    idempotencyStore: createPrismaIdempotencyStore(prisma),
    dataExporter: createPrismaDataExporter(prisma),
    clientView: { service: clientAccessService, secureCookies: env.NODE_ENV === 'production', tasks: clientFlags.tasks, minutes: clientFlags.minutes },
    // Project and task templates: due dates skip the company's days off (the meeting hours' working days).
    templateService: createTemplateService({
      repo: createPrismaTemplateRepository(prisma),
      canViewProject: (userId, roles, projectId) => projectAccess.canViewProject(userId, roles, projectId),
      canManageProject: (userId, roles, projectId) => projectAuthz.canManageProject(userId, roles, projectId),
      people: peopleLookup,
      workingDays: async () => (await settingsService.workingHours()).days,
      timeZone: companyTz,
      names: resolveUserNames,
    }),
    inspections: {
      service: inspectionService,
      // Scheduled inspections: a project's schedules and due checks; "Every working day" is the Meeting hours' days.
      schedules: createInspectionScheduleService({
        source: createPrismaInspectionScheduleSource(prisma, { workingDays: async () => (await settingsService.workingHours()).days }),
        canViewProject: (userId, roles, projectId) => projectAccess.canViewProject(userId, roles, projectId),
        userNames: resolveUserNames,
        timeZone: companyTz,
      }),
      timeZone: companyTz,
      projectImage: (url) => readProjectPicture(url, readStoredProjectImage, imageShrinker.toPrintable),
      userName: async (id) => (await resolveUserNames([id])).get(id) ?? null,
      pdfBrand: documentBrands.pdf.inspection, // companies: the inspection's project's company
    },
    management: {
      service: managementService,
      timeZone: companyTz,
      userName: async (id) => (await resolveUserNames([id])).get(id) ?? null,
    },
    backups: backups.routes,
  });

  // Serve uploaded attachment files from disk at /uploads/<key> (matches the stored url).
  // Every file gets nosniff + a sandboxing CSP, and non-images download instead of rendering,
  // so an uploaded document can never run script on this origin.
  const { default: fastifyStatic } = await import('@fastify/static');
  const { resolve } = await import('node:path');
  const uploadsRoot = resolve(process.cwd(), env.UPLOAD_DIR);
  mkdirSync(uploadsRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: '/uploads/',
    setHeaders: (reply, filePath) => {
      for (const [name, value] of Object.entries(uploadResponseHeaders(filePath))) reply.header(name, value);
    },
  });

  // Serve brand assets (logo) so emails can reference a publicly-hosted logo image.
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), 'assets'),
    prefix: '/email-assets/',
    decorateReply: false,
  });

  // Self-contained installs serve the web app from this server (no nginx in front).
  if (env.WEB_ROOT) {
    await registerWebApp(app, { root: resolve(process.cwd(), env.WEB_ROOT), downloadsDir });
    logger.info('Serving the web app', { root: env.WEB_ROOT });
  }

  const realtime = createRealtime(app.server, {
    accessSecret: env.JWT_ACCESS_SECRET,
    corsOrigin: corsOrigin(parseCorsOrigins(env.CORS_ORIGINS)),
    // Handshake re-checks the live account (like the HTTP guard): revoked / suspended sessions are
    // refused and room checks use the current roles, not the ones baked into the token.
    checkSession: async (userId, tokenVersion) => {
      const state = await userStateLookup(userId);
      return state && state.active && state.tokenVersion === tokenVersion ? { roles: state.roles } : null;
    },
    // Room authz: a socket may only subscribe to projects its user can view.
    canJoinProject: (userId, roles, projectId) => projectAccess.canViewProject(userId, roles, projectId),
    // companies (MC1 Task 12): sockets sit in their companies' rooms (admins in `admins`), and
    // presence is announced only to the people who share a company (and administrators).
    companiesOf: async (userId, roles) => ({ companyIds: await companyAccess.activeCompanyIds(userId), admin: isAdminRoles(roles) }),
    // Persist last-active on every connect/disconnect (best-effort) for presence + delivered receipts.
    onPresence: (userId) => {
      void prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => {});
    },
  });
  broadcast = realtime.broadcast;
  broadcastToUser = realtime.broadcastToUser;
  broadcastToAudience = realtime.broadcastToAudience;
  // A new notification reaches its person's open pages (the bell refreshes; a meeting reminder pops up).
  onNotificationDelivered = (n) =>
    realtime.broadcastToUser(n.userId, 'notification:new', {
      id: n.id, type: n.type, title: n.title, body: n.body, entityType: n.entityType, entityId: n.entityId, createdAt: n.createdAt.toISOString(),
    });
  // Revoked sessions lose their live connections; removed members lose the project's room and
  // its chat channel (SEC-07).
  onSessionsRevoked = (userId) => realtime.disconnectUser(userId);
  onMemberRemoved = async (projectId, userId) => {
    realtime.leaveProject(userId, projectId);
    await chatService.removeProjectParticipant(projectId, userId).catch((err) => logger.error('chat participant cleanup failed', { err, projectId, userId }));
  };
  // companies (MC1 Task 12): a change to people's companies (added, removed, a company archived or
  // brought back) or to a project's companies reaches live connections at once — company rooms and
  // presence re-synced, project rooms left (`project:removed`), `companies:changed` to their apps.
  // The companies service (people's companies, archive / unarchive) and the project companies rules
  // (a project's companies changed) call it through these hooks.
  const refreshCompanyAccess = (userIds: string[], projectIds: string[] = []): void => {
    if (userIds.length) void realtime.refreshAccess(userIds).catch((err) => logger.error('realtime: refreshing company access failed', { err, userIds }));
    for (const projectId of projectIds) void realtime.refreshProjectAudience(projectId).catch((err) => logger.error('realtime: refreshing a project’s audience failed', { err, projectId }));
  };
  onCompanyAccessChanged = refreshCompanyAccess;
  onProjectAudienceChanged = (projectId) => refreshCompanyAccess([], [projectId]);

  // On-schedule recurring series: each copy is made on its due date, done or not, shown live on open
  // boards and announced to its people. Hourly, so a copy appears soon after local midnight; one
  // instance runs it at a time, and a task never gets two next copies, so re-runs are harmless.
  const runRecurrenceSchedule = () =>
    runExclusive(jobLock, 'recurrence-schedule-sweep', SWEEP_LEASE_MS, () => new Date(), async () => {
      for (const made of await recurrenceService.runSchedule()) {
        await taskSearchIndex.taskChanged(made.id);
        const task = await taskService.getTask(made.id);
        broadcast(task.projectId, 'task:created', task);
        for (const userId of await taskRecipientIds(task.id)) {
          await notificationService.notify({ userId, type: 'TASK_ASSIGNED', title: 'A recurring task is ready', body: taskNoticeBody(task), entityType: 'task', entityId: task.id });
        }
      }
    }).catch((err) => {
      logger.error('recurrence schedule sweep failed', { err });
      return false;
    });
  void runRecurrenceSchedule();
  const recurrenceTimer = setInterval(() => void runRecurrenceSchedule(), 60 * 60 * 1000);
  recurrenceTimer.unref?.();

  // Task search heals what changed without a refresh: every minute the tasks with no entry (made in
  // bulk — a project from a template, a restored backup) or edited since they were read; at startup
  // and every six hours every task whose words changed any other way (a removed comment, a renamed
  // tag) — and an index built with an older version is rebuilt (task-search-sweeps).
  startTaskSearchSweeps({ index: taskSearchIndex, lock: jobLock, logger });

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info('MICO360 Tasks API listening', { port: env.PORT, realtime: true, env: env.NODE_ENV });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
