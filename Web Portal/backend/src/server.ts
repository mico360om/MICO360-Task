import { readFileSync } from 'node:fs';
import { getEnv, parseTrustProxy } from './config/env';
import { prisma } from './lib/prisma';
import { buildApp } from './app';
import { createPrismaIdempotencyStore } from './lib/idempotency';
import { uploadResponseHeaders } from './lib/upload-safety';
import { corsOrigin, parseCorsOrigins } from './lib/cors-origins';
import { registerWebApp, androidAppLink } from './lib/web-app';
import { resolve as resolvePath } from 'node:path';
import { createPrismaDataExporter } from './modules/users/data-export';
import { createAuthService } from './modules/auth/auth-service';
import { createTokenService } from './modules/auth/token-service';
import { createPrismaUserRepository } from './modules/auth/prisma-user-repository';
import { createPrismaRefreshTokenStore } from './modules/auth/prisma-refresh-token-store';
import { createProjectService } from './modules/projects/project-service';
import { createPrismaProjectRepository } from './modules/projects/prisma-project-repository';
import { createColumnService } from './modules/projects/column-service';
import { createPrismaColumnRepository } from './modules/projects/prisma-column-repository';
import { createMemberService } from './modules/projects/member-service';
import { createPrismaMemberRepository, createPrismaProjectExistsLookup, createPrismaProjectManagerLookup } from './modules/projects/prisma-member-repository';
import { createProjectAuthz } from './modules/projects/project-authz';
import { createProjectAccess } from './modules/projects/project-access';
import { createTaskService } from './modules/tasks/task-service';
import { createPrismaTaskRepository, createPrismaProjectLookup, createPrismaCarryForwardRepo } from './modules/tasks/prisma-task-repository';
import { createCarryForwardService } from './modules/tasks/carry-forward-service';
import { DEFAULT_CARRY_STATUSES } from './modules/tasks/board-date';
import { createAssigneeService } from './modules/tasks/assignee-service';
import { createWatcherService } from './modules/tasks/watcher-service';
import { createPrismaWatcherRepository } from './modules/tasks/prisma-watcher-repository';
import { createPrismaAssigneeRepository, createPrismaTaskLookup } from './modules/tasks/prisma-assignee-repository';
import { createTagService } from './modules/tasks/tag-service';
import { createPrismaTagRepository } from './modules/tasks/prisma-tag-repository';
import { createChecklistService } from './modules/tasks/checklist-service';
import { createPrismaChecklistRepository } from './modules/tasks/prisma-checklist-repository';
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
import { createPrismaAttachmentRepository } from './modules/tasks/prisma-attachment-repository';
import { createLocalDiskStorage } from './modules/tasks/local-disk-storage';
import { createDependencyService } from './modules/tasks/dependency-service';
import { createPrismaDependencyRepository } from './modules/tasks/prisma-dependency-repository';
import { createRecurrenceService } from './modules/tasks/recurrence-service';
import { createPrismaRecurrencePort } from './modules/tasks/prisma-recurrence-port';
import { createUserService } from './modules/users/user-service';
import { createPrismaUserRepository as createPrismaUserMgmtRepository } from './modules/users/prisma-user-repository';
import { createNotificationService } from './modules/notifications/notification-service';
import { createPrismaNotificationRepository, createPrismaPreferenceStore, createPrismaReminderLogStore, pruneReminderLog } from './modules/notifications/prisma-notification-repository';
import { planReminders } from './modules/notifications/reminder';
import { dispatchReminders } from './modules/notifications/reminder-dispatch';
import { buildDigests } from './modules/notifications/notification-digest';
import { planEscalations } from './modules/notifications/escalation';
import { runExclusive, createPrismaJobLockStore } from './lib/job-lock';
import { isMuted, normalizePreferences } from './modules/notifications/notification-preferences';
import { filterTaskRecipients, type TaskAudienceFacts } from './modules/notifications/recipient-access';
import { createDeviceTokenService } from './modules/device-tokens/device-token-service';
import { createPrismaDeviceTokenRepository } from './modules/device-tokens/prisma-device-token-repository';
import { createPushSender, type PushSender } from './modules/device-tokens/push-sender';
import { createFcmTransport, parseServiceAccount } from './modules/device-tokens/fcm-transport';
import { createPrismaUserStateLookup } from './modules/auth/prisma-user-state-lookup';
import { todayKey } from './lib/due-date';
import type { Prisma } from '@prisma/client';

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

/** Project-visibility facts of a task, for filtering notification recipients (see recipient-access). */
const taskAudienceSelect = {
  assignees: { select: { userId: true } },
  project: { select: { deletedAt: true, ownerId: true, managerId: true, createdById: true, members: { select: { userId: true } } } },
} satisfies Prisma.TaskSelect;

interface TaskAudienceRow {
  assignees: { userId: string }[];
  project: { deletedAt: Date | null; ownerId: string | null; managerId: string | null; createdById: string; members: { userId: string }[] } | null;
}

function toAudienceFacts(t: TaskAudienceRow): TaskAudienceFacts {
  return {
    assigneeIds: t.assignees.map((a) => a.userId),
    project: t.project
      ? { deletedAt: t.project.deletedAt, ownerId: t.project.ownerId, managerId: t.project.managerId, createdById: t.project.createdById, memberIds: t.project.members.map((m) => m.userId) }
      : null,
  };
}
import { createReportService } from './modules/reports/report-service';
import { createPrismaTaskExportSource } from './modules/tasks/task-export';
import { createPrismaReportDataSource } from './modules/reports/prisma-report-data-source';
import { createSearchService, createCachedSearchDataSource } from './modules/search/search-service';
import { createPrismaSearchDataSource } from './modules/search/prisma-search-data-source';
import { createPrismaMeetingRepository } from './modules/meetings/prisma-meeting-repository';
import { createMeetingService } from './modules/meetings/meeting-service';
import { createMeetingAccess } from './modules/meetings/meeting-access';
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
import { createPrismaAuditRepository } from './modules/audit/prisma-audit-repository';
import { createSettingsService } from './modules/settings/settings-service';
import { createAiConfigService } from './modules/ai/ai-config-service';
import { createAiFeatureService } from './modules/ai/ai-feature-service';
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
import { configureBrand } from './modules/email/brand';
import { createMailjetTransport } from './modules/email/mailer';
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
  });

  const projectRepository = createPrismaProjectRepository(prisma);
  const projectService = createProjectService({ projects: projectRepository });

  const columnService = createColumnService({ columns: createPrismaColumnRepository(prisma) });

  // Late-bound (chat + realtime are created further down): a removed member leaves the project's
  // chat channel and live room at once instead of when their tab closes.
  let onMemberRemoved: (projectId: string, userId: string) => Promise<void> = async () => {};
  const memberService = createMemberService({
    repo: createPrismaMemberRepository(prisma),
    projects: createPrismaProjectExistsLookup(prisma),
    onMemberRemoved: (projectId, userId) => onMemberRemoved(projectId, userId),
  });

  const projectAuthz = createProjectAuthz({ managers: createPrismaProjectManagerLookup(prisma) });
  // Object-level view authorization: gate task/column/member/comment reads to accessible projects.
  // Access follows project visibility only — being assigned to a task no longer grants access.
  const projectAccess = createProjectAccess({
    projects: projectRepository,
    managers: createPrismaProjectManagerLookup(prisma),
  });

  // Late-bound so moving a task to a DONE column can spawn the next recurring instance (below).
  type TaskRec = import('./modules/tasks/task-repository').TaskRecord;
  let onTaskMoved: (task: TaskRec, prevColumnId: string, actorId?: string) => Promise<void> = async () => {};
  let onTaskCreated: (task: TaskRec) => Promise<void> = async () => {};
  let onTaskDeleting: (task: TaskRec) => Promise<void> = async () => {};

  const companyTz = resolveTimeZone(env.COMPANY_TIMEZONE);
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
    onMoved: (task, prevColumnId, actorId) => onTaskMoved(task, prevColumnId, actorId),
    onCreated: (task) => onTaskCreated(task),
    onDeleting: (task) => onTaskDeleting(task),
  });

  // The next occurrence lands on today's board in the company time zone.
  const recurrenceService = createRecurrenceService({
    tasks: createPrismaRecurrencePort(prisma, { timeZone: companyTz }),
    timeZone: companyTz,
    onError: (err, taskId) => logger.error('recurring task: next copy failed', { err, taskId }),
  });
  // onTaskMoved is wired below, once the notification + activity services exist.

  // Late-bound so assignment can create notifications + activity once those services exist (below).
  let onTaskAssigned: (taskId: string, userIds: string[], actorId?: string) => Promise<void> = async () => {};

  const assigneeService = createAssigneeService({
    repo: createPrismaAssigneeRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    onAssigned: (taskId, userIds, actorId) => onTaskAssigned(taskId, userIds, actorId),
  });

  const watcherRepo = createPrismaWatcherRepository(prisma);
  const watcherService = createWatcherService({ repo: watcherRepo, taskLookup: createPrismaTaskLookup(prisma) });

  // Which of these users are active, and which of them are admins (admins can see every task).
  const activeUserFacts = async (userIds: string[]): Promise<{ activeIds: string[]; adminIds: string[] }> => {
    if (userIds.length === 0) return { activeIds: [], adminIds: [] };
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, roles: { select: { role: { select: { name: true } } } } },
    });
    return { activeIds: users.map((u) => u.id), adminIds: users.filter((u) => u.roles.some((r) => r.role.name === 'ADMIN')).map((u) => u.id) };
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
  });

  const checklistService = createChecklistService({
    repo: createPrismaChecklistRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
  });

  // Late-bound so a comment @mention can notify the mentioned users once notifications exist (below).
  let onCommentMention: (taskId: string, authorId: string, usernames: string[]) => Promise<void> = async () => {};
  // Late-bound so any comment notifies the task's assignees once notifications exist (below).
  let onComment: (taskId: string, authorId: string, commentId: string) => Promise<void> = async () => {};

  const commentService = createCommentService({
    repo: createPrismaCommentRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    onMention: (taskId, authorId, usernames) => onCommentMention(taskId, authorId, usernames),
    onComment: (taskId, authorId, commentId) => onComment(taskId, authorId, commentId),
  });

  // Late-bound chat notification hooks (wired once notifications exist, below).
  let onChatMention: (usernames: string[], authorId: string, conversationId: string) => Promise<void> = async () => {};
  let onChatDirect: (recipientId: string, authorId: string, conversationId: string) => Promise<void> = async () => {};

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
    logger,
  });

  const attachmentAllowedMime = env.UPLOAD_ALLOWED_MIME.split(',').map((s) => s.trim()).filter(Boolean);

  const attachmentService = createAttachmentService({
    repo: createPrismaAttachmentRepository(prisma),
    taskLookup: createPrismaTaskLookup(prisma),
    storage: attachmentStorage,
    maxSizeBytes: env.UPLOAD_MAX_BYTES,
    allowedMimeTypes: attachmentAllowedMime,
    maxTotalBytesPerTask: env.UPLOAD_MAX_TOTAL_BYTES_PER_TASK,
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
  const userService = createUserService({
    users: userMgmtRepository,
    revokeSessions: (userId) => revokeSessions(userId),
    onSessionsRevoked: (userId) => onSessionsRevoked(userId),
    issueSession: (u) => issueSession(u),
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

  const notificationService = createNotificationService({
    notifications: createPrismaNotificationRepository(prisma),
    preferences: createPrismaPreferenceStore(prisma),
    push: pushSender,
    logger,
  });
  const deviceTokenService = createDeviceTokenService({ deviceTokens: deviceTokenRepository });

  const reportService = createReportService({ data: createPrismaReportDataSource(prisma), timeZone: companyTz });

  // Cache the (broad) search snapshot for a few seconds so bursty, debounced searches don't
  // reload every meeting/note/task per keystroke — important on low-memory hosts.
  const searchService = createSearchService({
    data: createCachedSearchDataSource(createPrismaSearchDataSource(prisma), { ttlMs: 15_000 }),
  });

  // Meetings & Meeting Notes module (project-linked and standalone).
  const meetingRepository = createPrismaMeetingRepository(prisma);
  const isActiveUser = async (userId: string): Promise<boolean> =>
    (await prisma.user.count({ where: { id: userId, deletedAt: null, status: 'ACTIVE' } })) > 0;
  // Who may change a meeting: organizer, creator, admin — or whoever manages its project
  // (the project's manager or owner, or a MANAGER member).
  const meetingAccess = createMeetingAccess({
    meetings: meetingRepository,
    projectAccess: {
      canViewProject: (userId, roles, projectId) => projectAccess.canViewProject(userId, roles, projectId),
      accessibleProjectIds: (userId, roles) => projectAccess.accessibleProjectIds(userId, roles),
      async canManageProject(userId, roles, projectId) {
        if (roles.includes('ADMIN')) return true;
        const managed = await prisma.project.findFirst({
          where: { id: projectId, deletedAt: null, OR: [{ managerId: userId }, { ownerId: userId }, { members: { some: { userId, role: 'MANAGER' } } }] },
          select: { id: true },
        });
        return managed !== null;
      },
    },
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
  let onAttendeeRemoved: (meetingId: string, attendee: AttendeeRecord) => void = () => {};
  const attendeeService = createAttendeeService({
    attendees: createPrismaAttendeeRepository(prisma),
    canEditMeeting,
    onChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:attendees'),
    onRemoved: (meetingId, attendee) => onAttendeeRemoved(meetingId, attendee),
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
  });

  const activityService = createActivityService({ activities: createPrismaActivityRepository(prisma) });

  // Now that notifications + activity exist, make task assignment actually fire them.
  onTaskAssigned = async (taskId, userIds, actorId) => {
    // Self-assignment isn't news to the person who did it.
    for (const userId of await visibleTaskRecipients(taskId, userIds, actorId)) {
      await notificationService.notify({
        userId,
        type: 'TASK_ASSIGNED',
        title: 'You were assigned a task',
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

  onTaskCreated = async (task) => {
    await activityService.record({ taskId: task.id, projectId: task.projectId, userId: task.createdById, action: 'CREATED', meta: { title: task.title } });
  };

  // On a real stage change: spawn the next recurring instance when completed, and
  // notify the task's assignees of the status change.
  onTaskMoved = async (task, prevColumnId, actorId) => {
    if (prevColumnId === task.columnId) return; // reorder within a column — not a status change
    const [toCol, fromCol] = await Promise.all([
      prisma.kanbanColumn.findUnique({ where: { id: task.columnId }, select: { name: true, category: true } }),
      prisma.kanbanColumn.findUnique({ where: { id: prevColumnId }, select: { name: true, category: true } }),
    ]);

    if (task.recurrenceRule && toCol?.category === 'DONE') {
      const next = await recurrenceService.onTaskCompleted({
        id: task.id,
        dueDate: task.dueDate,
        recurrenceRule: task.recurrenceRule,
        recurrenceParentId: task.recurrenceParentId,
      });
      // Open boards show the new occurrence at once (its CREATED activity is written by the port).
      if (next) broadcast(task.projectId, 'task:created', await taskService.getTask(next.id));
    }

    // Everyone following the task except whoever moved it.
    for (const userId of await taskRecipientIds(task.id, actorId)) {
      await notificationService.notify({
        userId,
        type: 'TASK_STATUS',
        title: `Task moved to ${toCol?.name ?? 'a new stage'}`,
        entityType: 'task',
        entityId: task.id,
      });
    }

    // One activity row for the move, attributed to the actor: COMPLETED / REOPENED / MOVED + from→to.
    if (actorId) {
      const action = toCol?.category === 'DONE' ? 'COMPLETED' : fromCol?.category === 'DONE' ? 'REOPENED' : 'MOVED';
      await activityService.record({ taskId: task.id, projectId: task.projectId, userId: actorId, action, meta: { from: fromCol?.name ?? null, to: toCol?.name ?? null } });
    }
  };

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
    if (next) broadcast(task.projectId, 'task:created', await taskService.getTask(next.id));
  };

  // Deadline reminders: notify assignees of overdue + soon-due tasks. Runs at startup
  // and periodically; a PERSISTED per-day marker (reminder_logs) avoids re-notifying the same
  // task — unlike an in-memory guard, it survives restarts and is shared across instances.
  const reminderLogStore = createPrismaReminderLogStore(prisma);
  // Active users and admins, for the sweeps' recipient filtering (one query per sweep).
  const sweepAudience = async () => {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, email: true, firstName: true, status: true, notificationPrefs: true, roles: { select: { role: { select: { name: true } } } } },
    });
    const active = users.filter((u) => u.status === 'ACTIVE');
    return {
      users: active,
      activeIds: active.map((u) => u.id),
      adminIds: active.filter((u) => u.roles.some((r) => r.role.name === 'ADMIN')).map((u) => u.id),
    };
  };

  async function runReminderSweep(): Promise<void> {
    const period = todayKey(companyTz); // company-local yyyy-mm-dd
    await pruneReminderLog(prisma).catch(() => {}); // keep the marker table bounded
    // Tasks of deleted projects are gone for everyone — no more reminders for them.
    const tasks = await prisma.task.findMany({
      where: { deletedAt: null, dueDate: { not: null }, project: { is: { deletedAt: null } } },
      select: { id: true, title: true, dueDate: true, completedAt: true, column: { select: { category: true } }, watchers: { select: { userId: true } }, ...taskAudienceSelect },
    });
    // Each user's reminder lead time comes from their notification preferences (default window otherwise).
    const { users, activeIds, adminIds } = await sweepAudience();
    const leadByUser = new Map<string, number>();
    for (const u of users) {
      const lead = normalizePreferences(u.notificationPrefs).reminderLeadMinutes;
      if (lead != null) leadByUser.set(u.id, lead);
    }
    const planned = planReminders(
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        completedAt: t.completedAt,
        columnCategory: t.column?.category ?? null,
        // Watchers get due/overdue reminders too (deduped with assignees) — while they can still see the task.
        assigneeIds: filterTaskRecipients([...t.assignees.map((a) => a.userId), ...t.watchers.map((w) => w.userId)], toAudienceFacts(t), { activeIds, adminIds }),
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

  // A comment @mention notifies each mentioned user who can open the task (never the author).
  onCommentMention = async (taskId, authorId, usernames) => {
    const mentioned = await prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
    for (const userId of await visibleTaskRecipients(taskId, mentioned.map((m) => m.id), authorId)) {
      await notificationService.notify({
        userId,
        type: 'MENTION',
        title: 'You were mentioned in a comment',
        entityType: 'task',
        entityId: taskId,
      });
    }
  };

  // Any comment notifies the task's assignees + watchers (except the comment's author).
  onComment = async (taskId, authorId) => {
    for (const userId of await taskRecipientIds(taskId, authorId)) {
      await notificationService.notify({
        userId,
        type: 'TASK_COMMENT',
        title: 'New comment on your task',
        entityType: 'task',
        entityId: taskId,
      });
    }
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
  // A direct message notifies its recipient.
  onChatDirect = async (recipientId, authorId, conversationId) => {
    if (recipientId === authorId) return;
    await notificationService.notify({
      userId: recipientId,
      type: 'CHAT_MESSAGE',
      title: 'New direct message',
      entityType: 'conversation',
      entityId: conversationId,
    });
  };

  const auditService = createAuditService({ audit: createPrismaAuditRepository(prisma) });

  const settingsService = createSettingsService({ settings: createPrismaSettingsRepository(prisma) });
  // Provider API keys are encrypted at rest (SECRETS_ENCRYPTION_KEY, else derived from the JWT secret).
  const aiConfigRepository = createPrismaAiConfigRepository(prisma, { logger });
  const aiConfigService = createAiConfigService({ repo: aiConfigRepository, audit: auditService, allowPrivateHosts: env.AI_ALLOW_PRIVATE_HOSTS });
  // Product-facing AI features read the same config (default chat model) and call the provider,
  // within per-user limits and each model's concurrency limit.
  const aiFeatureService = createAiFeatureService({
    repo: aiConfigRepository,
    timeZone: companyTz,
    allowPrivateHosts: env.AI_ALLOW_PRIVATE_HOSTS,
    limits: { perMinute: env.AI_USER_REQUESTS_PER_MINUTE, perDay: env.AI_USER_REQUESTS_PER_DAY },
  });

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
    // Use the hosted system logo (white, for the brand-red header) unless overridden.
    logoUrl: env.EMAIL_LOGO_URL || `${env.API_BASE_URL}/email-assets/logo-w.png`,
  });

  const emailService = createEmailService({
    transport: createMailjetTransport({ apiKey: env.MAILJET_API_KEY, secretKey: env.MAILJET_SECRET_KEY, from: env.MAIL_FROM }),
    isSuppressed: createPrismaSuppressionChecker(prisma),
    log: createPrismaEmailLogStore(prisma),
    logger,
  });
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
    attendees: { listByMeeting: (id) => attendeeService.listAttendees(id) },
    email: emailService,
    resolveUser: resolveMeetingUser,
    resolveProjectName: async (projectId) => (await resolveProject(projectId))?.name ?? null,
    appUrl: env.APP_URL,
    defaultTimeZone: companyTz, // times in emails are shown in the company zone, not UTC
    logger,
  });
  // Taking someone off an invited meeting removes it from their calendar (best-effort).
  onAttendeeRemoved = (meetingId, attendee) => {
    meetingNotifyService
      .sendAttendeeRemoved(meetingId, attendee)
      .catch((err) => logger.error('meeting attendee removal notice failed', { err, meetingId }));
  };
  // Remind attendees of meetings starting within the next hour (one lease-locked instance, every 15 min).
  const MEETING_REMINDER_LEAD_MS = 60 * 60 * 1000;
  const runMeetingReminders = () =>
    runExclusive(jobLock, 'meeting-reminder-sweep', SWEEP_LEASE_MS, () => new Date(), async () => {
      await meetingNotifyService.runReminderSweep(MEETING_REMINDER_LEAD_MS);
    }).catch((err) => {
      logger.error('meeting reminder sweep failed', { err });
      return false;
    });
  void runMeetingReminders();
  const meetingReminderTimer = setInterval(() => void runMeetingReminders(), 15 * 60 * 1000);
  meetingReminderTimer.unref?.();

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
      select: { id: true, key: true, title: true, dueDate: true, completedAt: true, column: { select: { category: true } }, watchers: { select: { userId: true } }, ...taskAudienceSelect },
    });
    const { users, activeIds, adminIds } = await sweepAudience();
    const digests = buildDigests(
      tasks.map((t) => ({
        id: t.id, key: t.key, title: t.title, dueDate: t.dueDate, completedAt: t.completedAt,
        columnCategory: t.column?.category ?? null,
        // Someone who has left the project no longer gets its tasks in their digest.
        recipientIds: filterTaskRecipients([...t.assignees.map((a) => a.userId), ...t.watchers.map((w) => w.userId)], toAudienceFacts(t), { activeIds, adminIds }),
      })),
      { timeZone: companyTz },
    );
    const userById = new Map(users.map((u) => [u.id, u]));
    for (const digest of digests) {
      const user = userById.get(digest.userId);
      if (!user) continue;
      // A muted digest is muted everywhere — in-app and email.
      if (isMuted(normalizePreferences(user.notificationPrefs), 'TASK_DIGEST')) continue;
      // A per-day marker keeps the digest to once daily even as the sweep re-runs hourly.
      const dedupe = `digest:${digest.userId}:${day}`;
      if (await reminderLogStore.has(dedupe)) continue;
      await reminderLogStore.add(dedupe);
      const total = digest.overdue.length + digest.dueToday.length;
      const summary = `${digest.overdue.length} overdue · ${digest.dueToday.length} due today`;
      const items = [...digest.overdue.map((i) => `${i.key} ${i.title} (overdue, due ${i.dueDate})`), ...digest.dueToday.map((i) => `${i.key} ${i.title} (due today)`)];
      const lines = items.map((i) => `• ${i}`).join('\n');
      // In-app notification — reliable regardless of email deliverability. Nothing stored means
      // the type is suppressed for this user, so no email either.
      const inApp = await notificationService.notify({ userId: digest.userId, type: 'TASK_DIGEST', title: `Your daily digest — ${summary}`, body: lines, entityType: 'digest', entityId: day });
      if (!inApp) continue;
      // Email digest (best-effort — needs a configured mail transport).
      if (user.email) {
        await emailService
          .sendNotification(user.email, { heading: 'Your task digest', message: `Hi ${user.firstName || 'there'}, you have ${total} task${total === 1 ? '' : 's'} needing attention today — ${summary}.`, items, actionLabel: 'Open My Tasks', actionLink: `${env.APP_URL}/my-tasks` })
          .catch((err) => logger.warn('digest email failed', { err, userId: digest.userId }));
      }
    }
  }

  async function runEscalationSweep(): Promise<void> {
    const { day } = companyDayHour();
    const tasks = await prisma.task.findMany({
      where: { deletedAt: null, project: { is: { deletedAt: null } } },
      select: { id: true, key: true, title: true, dueDate: true, completedAt: true, projectId: true, column: { select: { category: true } } },
    });
    const plans = planEscalations(
      tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, dueDate: t.dueDate, completedAt: t.completedAt, projectId: t.projectId, columnCategory: t.column?.category ?? null })),
      { timeZone: companyTz },
    );
    if (plans.length === 0) return;
    // Recipients = each project's owner + managers.
    const projectIds = Array.from(new Set(plans.map((p) => p.projectId)));
    const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, ownerId: true, members: { where: { role: 'MANAGER' }, select: { userId: true } } } });
    const recipientsByProject = new Map(projects.map((p) => [p.id, Array.from(new Set([...(p.ownerId ? [p.ownerId] : []), ...p.members.map((m) => m.userId)]))]));
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

  const otpService = createOtpService({
    users: createPrismaOtpUserLookup(prisma),
    otps: createPrismaOtpStore(prisma),
    mailer: emailService,
    ttlSeconds: env.OTP_TTL_SECONDS,
    otpLength: env.OTP_LENGTH,
    maxAttempts: 3,
    logger,
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
    logger,
  });

  // Realtime broadcasters are wired after the HTTP server exists (below).
  let broadcast: (projectId: string, event: string, payload: unknown) => void = () => {};
  let broadcastToUser: (userId: string, event: string, payload: unknown) => void = () => {};
  let broadcastToAudience: (audience: { projectId?: string | null; userIds?: string[] }, event: string, payload: unknown) => void = () => {};

  // Live account state (token version, status, current roles) for the HTTP guard and sockets:
  // a suspended, deleted or demoted user loses access at once, not when their token expires.
  const userStateLookup = createPrismaUserStateLookup(prisma);

  const app = await buildApp({
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
    projectAccess,
    columnService,
    memberService,
    projectAuthz,
    taskService,
    carryForwardService,
    assigneeService,
    watcherService,
    tagService,
    checklistService,
    commentService,
    attachmentService,
    chatAttachmentStorage: attachmentStorage,
    attachmentAllowedMime,
    attachmentMaxSizeBytes: env.UPLOAD_MAX_BYTES,
    dependencyService,
    userService,
    notificationService,
    deviceTokenService,
    reportService,
    // Task exports (Excel / PDF) read the task with its lists in one go.
    taskExportSource: createPrismaTaskExportSource(prisma, companyTz),
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
    meetingService,
    meetingAccess,
    attendeeService,
    agendaService,
    noteService,
    noteTaskService,
    meetingNotifyService,
    actionItemService,
    resolveMeetingProjectId,
    resolveUserNames,
    resolveProject,
    activityService,
    auditService,
    settingsService,
    aiConfigService,
    aiFeatureService,
    emailWebhookService,
    mailjetWebhookToken: env.MAILJET_WEBHOOK_TOKEN || undefined,
    corsOrigins: corsOrigin(parseCorsOrigins(env.CORS_ORIGINS)),
    appConfig: {
      timeZone: resolveTimeZone(env.COMPANY_TIMEZONE),
      productName: env.PRODUCT_NAME,
      companyName: env.COMPANY_NAME,
      emailEnabled: emailService.isConfigured(),
      // A self-contained install hosts the APK in its web root; otherwise ANDROID_APP_URL (if set).
      androidAppUrl: androidAppLink(env.ANDROID_APP_URL, env.WEB_ROOT ? resolvePath(process.cwd(), env.WEB_ROOT) : null),
    },
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    rateLimitMax: env.RATE_LIMIT_MAX,
    authRateLimitMax: env.AUTH_RATE_LIMIT_MAX,
    idempotencyStore: createPrismaIdempotencyStore(prisma),
    dataExporter: createPrismaDataExporter(prisma),
  });

  // Serve uploaded attachment files from disk at /uploads/<key> (matches the stored url).
  // Every file gets nosniff + a sandboxing CSP, and non-images download instead of rendering,
  // so an uploaded document can never run script on this origin.
  const { default: fastifyStatic } = await import('@fastify/static');
  const { resolve } = await import('node:path');
  const { mkdirSync } = await import('node:fs');
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
    await registerWebApp(app, { root: resolve(process.cwd(), env.WEB_ROOT) });
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
    // Persist last-active on every connect/disconnect (best-effort) for presence + delivered receipts.
    onPresence: (userId) => {
      void prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => {});
    },
  });
  broadcast = realtime.broadcast;
  broadcastToUser = realtime.broadcastToUser;
  broadcastToAudience = realtime.broadcastToAudience;
  // Revoked sessions lose their live connections; removed members lose the project's room and
  // its chat channel (SEC-07).
  onSessionsRevoked = (userId) => realtime.disconnectUser(userId);
  onMemberRemoved = async (projectId, userId) => {
    realtime.leaveProject(userId, projectId);
    await chatService.removeProjectParticipant(projectId, userId).catch((err) => logger.error('chat participant cleanup failed', { err, projectId, userId }));
  };

  // On-schedule recurring series: each copy is made on its due date, done or not, shown live on open
  // boards and announced to its people. Hourly, so a copy appears soon after local midnight; one
  // instance runs it at a time, and a task never gets two next copies, so re-runs are harmless.
  const runRecurrenceSchedule = () =>
    runExclusive(jobLock, 'recurrence-schedule-sweep', SWEEP_LEASE_MS, () => new Date(), async () => {
      for (const made of await recurrenceService.runSchedule()) {
        const task = await taskService.getTask(made.id);
        broadcast(task.projectId, 'task:created', task);
        for (const userId of await taskRecipientIds(task.id)) {
          await notificationService.notify({ userId, type: 'TASK_ASSIGNED', title: 'A recurring task is ready', body: task.title, entityType: 'task', entityId: task.id });
        }
      }
    }).catch((err) => {
      logger.error('recurrence schedule sweep failed', { err });
      return false;
    });
  void runRecurrenceSchedule();
  const recurrenceTimer = setInterval(() => void runRecurrenceSchedule(), 60 * 60 * 1000);
  recurrenceTimer.unref?.();

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info('MICO360 Tasks API listening', { port: env.PORT, realtime: true, env: env.NODE_ENV });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
