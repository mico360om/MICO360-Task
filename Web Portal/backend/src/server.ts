import { getEnv } from './config/env';
import { prisma } from './lib/prisma';
import { buildApp } from './app';
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
import { normalizePreferences } from './modules/notifications/notification-preferences';
import { createDeviceTokenService } from './modules/device-tokens/device-token-service';
import { createPrismaDeviceTokenRepository } from './modules/device-tokens/prisma-device-token-repository';

/** Validate an IANA time zone; fall back to Asia/Muscat (Oman) if misconfigured. */
function resolveTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Asia/Muscat';
  }
}
import { createReportService } from './modules/reports/report-service';
import { createPrismaReportDataSource } from './modules/reports/prisma-report-data-source';
import { createSearchService, createCachedSearchDataSource } from './modules/search/search-service';
import { createPrismaSearchDataSource } from './modules/search/prisma-search-data-source';
import { createPrismaMeetingRepository } from './modules/meetings/prisma-meeting-repository';
import { createMeetingService } from './modules/meetings/meeting-service';
import { createMeetingAccess } from './modules/meetings/meeting-access';
import { createPrismaAttendeeRepository } from './modules/meetings/prisma-attendee-repository';
import { createAttendeeService } from './modules/meetings/attendee-service';
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
import { createPrismaEmailEventStore, createPrismaSuppressionChecker } from './modules/email/prisma-email-event-store';
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
  });

  const projectRepository = createPrismaProjectRepository(prisma);
  const projectService = createProjectService({ projects: projectRepository });

  const columnService = createColumnService({ columns: createPrismaColumnRepository(prisma) });

  const memberService = createMemberService({
    repo: createPrismaMemberRepository(prisma),
    projects: createPrismaProjectExistsLookup(prisma),
  });

  const projectAuthz = createProjectAuthz({ managers: createPrismaProjectManagerLookup(prisma) });
  // Object-level view authorization: gate task/column/member/comment reads to accessible projects.
  const projectAccess = createProjectAccess({
    projects: projectRepository,
    managers: createPrismaProjectManagerLookup(prisma),
    // A user assigned to a task can always open it, even outside their project memberships.
    assignees: {
      async isAssignee(taskId, userId) {
        const row = await prisma.taskAssignee.findUnique({ where: { taskId_userId: { taskId, userId } }, select: { taskId: true } });
        return row !== null;
      },
    },
  });

  // Late-bound so moving a task to a DONE column can spawn the next recurring instance (below).
  type TaskRec = import('./modules/tasks/task-repository').TaskRecord;
  let onTaskMoved: (task: TaskRec, prevColumnId: string, actorId?: string) => Promise<void> = async () => {};
  let onTaskCreated: (task: TaskRec) => Promise<void> = async () => {};

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
  });

  const recurrenceService = createRecurrenceService({ tasks: createPrismaRecurrencePort(prisma) });
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
  // Everyone who should hear about a task: its assignees plus anyone watching (following) it.
  const taskRecipientIds = async (taskId: string): Promise<string[]> => {
    const [assignees, watcherIds] = await Promise.all([
      prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } }),
      watcherRepo.listWatcherIds(taskId),
    ]);
    return [...new Set([...assignees.map((a) => a.userId), ...watcherIds])];
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
  const userMgmtRepository = createPrismaUserMgmtRepository(prisma);
  const userService = createUserService({
    users: userMgmtRepository,
    revokeSessions: (userId) => revokeSessions(userId),
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

  const notificationService = createNotificationService({
    notifications: createPrismaNotificationRepository(prisma),
    preferences: createPrismaPreferenceStore(prisma),
  });
  const deviceTokenService = createDeviceTokenService({ deviceTokens: createPrismaDeviceTokenRepository(prisma) });

  const reportService = createReportService({ data: createPrismaReportDataSource(prisma) });

  // Cache the (broad) search snapshot for a few seconds so bursty, debounced searches don't
  // reload every meeting/note/task per keystroke — important on low-memory hosts.
  const searchService = createSearchService({
    data: createCachedSearchDataSource(createPrismaSearchDataSource(prisma), { ttlMs: 15_000 }),
  });

  // Meetings & Meeting Notes module (project-linked and standalone).
  const meetingRepository = createPrismaMeetingRepository(prisma);
  const meetingService = createMeetingService({
    meetings: meetingRepository,
    onChanged: (meeting, kind) => {
      if (meeting.projectId) broadcast(meeting.projectId, `meeting:${kind}`, { id: meeting.id });
    },
  });
  const meetingAccess = createMeetingAccess({ meetings: meetingRepository, projectAccess });
  const broadcastMeetingChange = (meetingId: string, event: string) => {
    void meetingRepository.accessCore(meetingId).then((core) => {
      if (core?.projectId) broadcast(core.projectId, event, { id: meetingId });
    });
  };
  const attendeeService = createAttendeeService({
    attendees: createPrismaAttendeeRepository(prisma),
    onChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:attendees'),
  });
  const agendaService = createAgendaService({
    agenda: createPrismaAgendaRepository(prisma),
    onChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:agenda'),
  });
  const noteService = createNoteService({
    notes: createPrismaNoteRepository(prisma),
    onChanged: (meetingId) => broadcastMeetingChange(meetingId, 'meeting:notes'),
  });
  // ⭐ Create Task from Note — promotes a meeting note into a board task.
  const actionItemService = createActionItemService({
    actionItems: createPrismaActionItemRepository(prisma),
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
    for (const userId of userIds) {
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
      await recurrenceService.onTaskCompleted({
        id: task.id,
        dueDate: task.dueDate,
        recurrenceRule: task.recurrenceRule,
        recurrenceParentId: task.recurrenceParentId,
      });
    }

    for (const userId of await taskRecipientIds(task.id)) {
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

  // Deadline reminders: notify assignees of overdue + soon-due tasks. Runs at startup
  // and periodically; a PERSISTED per-day marker (reminder_logs) avoids re-notifying the same
  // task — unlike an in-memory guard, it survives restarts and is shared across instances.
  const reminderLogStore = createPrismaReminderLogStore(prisma);
  async function runReminderSweep(): Promise<void> {
    const period = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
    await pruneReminderLog(prisma).catch(() => {}); // keep the marker table bounded
    const tasks = await prisma.task.findMany({
      where: { deletedAt: null, dueDate: { not: null } },
      select: { id: true, title: true, dueDate: true, column: { select: { category: true } }, assignees: { select: { userId: true } }, watchers: { select: { userId: true } } },
    });
    // Each user's reminder lead time comes from their notification preferences (default window otherwise).
    const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, notificationPrefs: true } });
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
        columnCategory: t.column?.category ?? null,
        // Watchers get due/overdue reminders too, deduped with assignees.
        assigneeIds: [...new Set([...t.assignees.map((a) => a.userId), ...t.watchers.map((w) => w.userId)])],
      })),
      { leadMinutesFor: (id) => leadByUser.get(id) },
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

  // A comment @mention notifies each mentioned user (except the author themselves).
  onCommentMention = async (taskId, authorId, usernames) => {
    const mentioned = await prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
    for (const { id: userId } of mentioned) {
      if (userId === authorId) continue;
      await notificationService.notify({
        userId,
        type: 'MENTION',
        title: 'You were mentioned in a comment',
        entityType: 'task',
        entityId: taskId,
      });
    }
  };

  // Any comment notifies the task's assignees (except the comment's author).
  onComment = async (taskId, authorId) => {
    for (const userId of await taskRecipientIds(taskId)) {
      if (userId === authorId) continue;
      await notificationService.notify({
        userId,
        type: 'TASK_COMMENT',
        title: 'New comment on your task',
        entityType: 'task',
        entityId: taskId,
      });
    }
  };

  // A chat @mention notifies each mentioned user (except the author).
  onChatMention = async (usernames, authorId, conversationId) => {
    const mentioned = await prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
    for (const { id: userId } of mentioned) {
      if (userId === authorId) continue;
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
  const aiConfigRepository = createPrismaAiConfigRepository(prisma);
  const aiConfigService = createAiConfigService({ repo: aiConfigRepository, audit: auditService });
  // Product-facing AI features read the same config (default chat model) and call the provider.
  const aiFeatureService = createAiFeatureService({ repo: aiConfigRepository });

  // Per-date boards: each night carry still-open tasks onto today's board. Config lives in
  // system settings (admin-editable) — carryForward.enabled + carryForward.statuses — with defaults.
  const carryForwardService = createCarryForwardService({
    repo: createPrismaCarryForwardRepo(prisma),
    timeZone: companyTz,
    config: async () => {
      const all = await settingsService.getAll();
      const byKey = new Map(all.map((s) => [s.key, s.value] as const));
      const enabled = byKey.has('carryForward.enabled') ? Boolean(byKey.get('carryForward.enabled')) : true;
      const statuses = Array.isArray(byKey.get('carryForward.statuses'))
        ? (byKey.get('carryForward.statuses') as string[])
        : DEFAULT_CARRY_STATUSES;
      return { enabled, statuses };
    },
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
  });

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
  });
  // Remind attendees of meetings starting within the next hour (one lease-locked instance, every 15 min).
  const MEETING_REMINDER_LEAD_MS = 60 * 60 * 1000;
  const runMeetingReminders = () =>
    runExclusive(jobLock, 'meeting-reminder-sweep', SWEEP_LEASE_MS, () => new Date(), async () => {
      await meetingNotifyService.runReminderSweep(MEETING_REMINDER_LEAD_MS);
    }).catch(() => false);
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
      select: { id: true, key: true, title: true, dueDate: true, column: { select: { category: true } }, assignees: { select: { userId: true } }, watchers: { select: { userId: true } } },
    });
    const digests = buildDigests(
      tasks.map((t) => ({
        id: t.id, key: t.key, title: t.title, dueDate: t.dueDate,
        columnCategory: t.column?.category ?? null,
        recipientIds: [...new Set([...t.assignees.map((a) => a.userId), ...t.watchers.map((w) => w.userId)])],
      })),
    );
    const userById = new Map((await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, email: true, firstName: true, notificationPrefs: true } })).map((u) => [u.id, u]));
    for (const digest of digests) {
      const user = userById.get(digest.userId);
      if (!user) continue;
      // A per-day marker keeps the digest to once daily even as the sweep re-runs hourly.
      const dedupe = `digest:${digest.userId}:${day}`;
      if (await reminderLogStore.has(dedupe)) continue;
      await reminderLogStore.add(dedupe);
      const total = digest.overdue.length + digest.dueToday.length;
      const summary = `${digest.overdue.length} overdue · ${digest.dueToday.length} due today`;
      const lines = [...digest.overdue.map((i) => `• ${i.key} ${i.title} (overdue, due ${i.dueDate})`), ...digest.dueToday.map((i) => `• ${i.key} ${i.title} (due today)`)].join('\n');
      // In-app notification (always) — reliable regardless of email deliverability.
      await notificationService.notify({ userId: digest.userId, type: 'TASK_DIGEST', title: `Your daily digest — ${summary}`, body: lines, entityType: 'digest', entityId: day });
      // Email digest (best-effort — needs a configured mail transport).
      if (user.email) {
        await emailService
          .sendNotification(user.email, { heading: 'Your task digest', message: `Hi ${user.firstName || 'there'}, you have ${total} task${total === 1 ? '' : 's'} needing attention today — ${summary}.\n\n${lines}`, actionLabel: 'Open My Tasks', actionLink: `${env.APP_URL}/my-tasks` })
          .catch(() => {});
      }
    }
  }

  async function runEscalationSweep(): Promise<void> {
    const { day } = companyDayHour();
    const tasks = await prisma.task.findMany({
      where: { deletedAt: null, project: { is: { deletedAt: null } } },
      select: { id: true, key: true, title: true, dueDate: true, projectId: true, column: { select: { category: true } } },
    });
    const plans = planEscalations(tasks.map((t) => ({ id: t.id, key: t.key, title: t.title, dueDate: t.dueDate, projectId: t.projectId, columnCategory: t.column?.category ?? null })));
    if (plans.length === 0) return;
    // Recipients = each project's owner + managers.
    const projectIds = [...new Set(plans.map((p) => p.projectId))];
    const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, ownerId: true, members: { where: { role: 'MANAGER' }, select: { userId: true } } } });
    const recipientsByProject = new Map(projects.map((p) => [p.id, [...new Set([...(p.ownerId ? [p.ownerId] : []), ...p.members.map((m) => m.userId)])]]));
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
  });

  const passwordResetService = createPasswordResetService({
    store: createPrismaPasswordResetStore(prisma),
    users: createPrismaResetUserRepo(prisma),
    mailer: emailService,
    ttlSeconds: env.PASSWORD_RESET_TTL_SECONDS,
    appUrl: env.APP_URL,
    hashPassword,
    revokeSessions: (userId) => tokenService.revokeAllForUser(userId),
  });

  // Realtime broadcasters are wired after the HTTP server exists (below).
  let broadcast: (projectId: string, event: string, payload: unknown) => void = () => {};
  let broadcastToUser: (userId: string, event: string, payload: unknown) => void = () => {};

  const app = await buildApp({
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
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    appConfig: {
      timeZone: resolveTimeZone(env.COMPANY_TIMEZONE),
      productName: env.PRODUCT_NAME,
      companyName: env.COMPANY_NAME,
    },
  });

  // Serve uploaded attachment files from disk at /uploads/<key> (matches the stored url).
  const { default: fastifyStatic } = await import('@fastify/static');
  const { resolve } = await import('node:path');
  const { mkdirSync } = await import('node:fs');
  const uploadsRoot = resolve(process.cwd(), env.UPLOAD_DIR);
  mkdirSync(uploadsRoot, { recursive: true });
  await app.register(fastifyStatic, { root: uploadsRoot, prefix: '/uploads/' });

  // Serve brand assets (logo) so emails can reference a publicly-hosted logo image.
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), 'assets'),
    prefix: '/email-assets/',
    decorateReply: false,
  });

  const realtime = createRealtime(app.server, {
    accessSecret: env.JWT_ACCESS_SECRET,
    corsOrigin: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    // Room authz: a socket may only subscribe to projects its user can view.
    canJoinProject: (userId, roles, projectId) => projectAccess.canViewProject(userId, roles, projectId),
    // Persist last-active on every connect/disconnect (best-effort) for presence + delivered receipts.
    onPresence: (userId) => {
      void prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => {});
    },
  });
  broadcast = realtime.broadcast;
  broadcastToUser = realtime.broadcastToUser;

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info('MICO360 Tasks API listening', { port: env.PORT, realtime: true, env: env.NODE_ENV });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
