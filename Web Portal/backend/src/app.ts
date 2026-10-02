import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { HttpError } from './lib/http-errors';
import type { Logger } from './lib/logger';
import { registerIdempotency, type IdempotencyStore } from './lib/idempotency';
import { registerEmailWebhookRoutes } from './modules/email/email-webhook-routes';
import type { EmailWebhookService } from './modules/email/email-webhook-service';
import { registerAuthRoutes, type AuthRouteDeps } from './modules/auth/auth-routes';
import { createAuthGuard, type UserStateLookup } from './modules/auth/auth-guard';
import { registerProjectRoutes } from './modules/projects/project-routes';
import type { ProjectService } from './modules/projects/project-service';
import { registerTaskRoutes } from './modules/tasks/task-routes';
import { registerTaskExportRoutes } from './modules/tasks/task-export-routes';
import type { TaskExportSource } from './modules/tasks/task-export';
import type { TaskService } from './modules/tasks/task-service';
import { registerAssigneeRoutes } from './modules/tasks/assignee-routes';
import type { AssigneeService } from './modules/tasks/assignee-service';
import { registerWatcherRoutes } from './modules/tasks/watcher-routes';
import type { WatcherService } from './modules/tasks/watcher-service';
import { registerTagRoutes } from './modules/tasks/tag-routes';
import type { TagService } from './modules/tasks/tag-service';
import { registerChecklistRoutes } from './modules/tasks/checklist-routes';
import type { ChecklistService } from './modules/tasks/checklist-service';
import { registerCommentRoutes } from './modules/tasks/comment-routes';
import type { CommentService } from './modules/tasks/comment-service';
import { registerChatRoutes } from './modules/chat/chat-routes';
import type { MessageService } from './modules/chat/message-service';
import { registerAttachmentRoutes } from './modules/tasks/attachment-routes';
import type { AttachmentService } from './modules/tasks/attachment-service';
import { registerDependencyRoutes } from './modules/tasks/dependency-routes';
import type { DependencyService } from './modules/tasks/dependency-service';
import { registerUserRoutes } from './modules/users/user-routes';
import type { UserService } from './modules/users/user-service';
import { registerNotificationRoutes } from './modules/notifications/notification-routes';
import type { NotificationService } from './modules/notifications/notification-service';
import { registerDeviceTokenRoutes } from './modules/device-tokens/device-token-routes';
import type { DeviceTokenService } from './modules/device-tokens/device-token-service';
import { registerReportRoutes } from './modules/reports/report-routes';
import type { ReportService } from './modules/reports/report-service';
import { registerSearchRoutes } from './modules/search/search-routes';
import type { SearchService } from './modules/search/search-service';
import { registerMeetingRoutes } from './modules/meetings/meeting-routes';
import type { MeetingService } from './modules/meetings/meeting-service';
import type { MeetingAccess } from './modules/meetings/meeting-access';
import { registerAttendeeRoutes } from './modules/meetings/attendee-routes';
import type { AttendeeService } from './modules/meetings/attendee-service';
import { registerAgendaRoutes } from './modules/meetings/agenda-routes';
import type { AgendaService } from './modules/meetings/agenda-service';
import { registerNoteRoutes } from './modules/meetings/note-routes';
import type { NoteService } from './modules/meetings/note-service';
import type { NoteTaskService } from './modules/meetings/note-task-service';
import { registerMinutesRoutes, type MinutesProjectSource } from './modules/meetings/minutes-routes';
import type { MeetingNotifyService } from './modules/meetings/meeting-notify-service';
import { registerActionItemRoutes } from './modules/meetings/action-item-routes';
import type { ActionItemService } from './modules/meetings/action-item-service';
import { registerColumnRoutes } from './modules/projects/column-routes';
import type { ColumnService } from './modules/projects/column-service';
import { registerMemberRoutes } from './modules/projects/member-routes';
import type { MemberService } from './modules/projects/member-service';
import { createProjectAuthz, type ProjectAuthz } from './modules/projects/project-authz';
import type { ProjectAccess } from './modules/projects/project-access';
import { registerActivityRoutes } from './modules/activity/activity-routes';
import type { ActivityService } from './modules/activity/activity-service';
import { registerAuditRoutes } from './modules/audit/audit-routes';
import type { AuditService } from './modules/audit/audit-service';
import { registerSettingsRoutes } from './modules/settings/settings-routes';
import type { SettingsService } from './modules/settings/settings-service';
import { registerAiRoutes } from './modules/ai/ai-config-routes';
import type { AiConfigService } from './modules/ai/ai-config-service';
import { registerAiFeatureRoutes } from './modules/ai/ai-feature-routes';
import type { AiFeatureService } from './modules/ai/ai-feature-service';
import type { CorsOriginMatcher } from './lib/cors-origins';
import type { DataExporter } from './modules/users/data-export';

export interface AppDeps extends AuthRouteDeps {
  corsOrigins?: string[] | boolean | CorsOriginMatcher;
  /** Public app config surfaced at GET /api/v1/config (company time zone, names, whether email works). */
  appConfig?: { timeZone: string; productName: string; companyName: string; emailEnabled?: boolean; androidAppUrl?: string | null };
  /**
   * Live account state for the auth guard (token version, status, current roles). When set, a
   * suspended / deleted / demoted user loses access at once instead of when their token expires.
   */
  userState?: UserStateLookup;
  projectService?: ProjectService;
  columnService?: ColumnService;
  memberService?: MemberService;
  projectAuthz?: ProjectAuthz;
  /** Object-level view authorization (T2.7). When present, task/column/member/comment reads are gated to accessible projects. */
  projectAccess?: ProjectAccess;
  taskService?: TaskService;
  carryForwardService?: import('./modules/tasks/carry-forward-service').CarryForwardService;
  assigneeService?: AssigneeService;
  watcherService?: WatcherService;
  tagService?: TagService;
  checklistService?: ChecklistService;
  commentService?: CommentService;
  chatService?: MessageService;
  /** Deliver a chat event to one user across their sockets (their DMs). */
  onChatUserEvent?: (userId: string, event: string, payload: unknown) => void;
  /** File storage for chat attachments (same adapter as task attachments). */
  chatAttachmentStorage?: import('./modules/tasks/attachment-repository').AttachmentStorage;
  attachmentService?: AttachmentService;
  attachmentMaxSizeBytes?: number;
  /** Allowed attachment mime types (shared by task + chat uploads); empty means any. */
  attachmentAllowedMime?: string[];
  dependencyService?: DependencyService;
  userService?: UserService;
  notificationService?: NotificationService;
  deviceTokenService?: DeviceTokenService;
  reportService?: ReportService;
  /** Reads a task with everything its Excel / PDF export shows. */
  taskExportSource?: TaskExportSource;
  /** Names for report exports (project, team member, author). */
  reportNames?: import('./modules/reports/report-routes').ReportNames;
  searchService?: SearchService;
  meetingService?: MeetingService;
  meetingAccess?: MeetingAccess;
  attendeeService?: AttendeeService;
  agendaService?: AgendaService;
  noteService?: NoteService;
  /** Enables ⭐ Create Task from Note (promotes a meeting note into a board task). */
  noteTaskService?: NoteTaskService;
  /** Calendar invitations, reminders, cancellations and minutes distribution for meetings. */
  meetingNotifyService?: MeetingNotifyService;
  /** Action Items register (meeting-scoped + cross-meeting "My Action Items"). */
  actionItemService?: ActionItemService;
  /** Inherit a meeting's project id on action-item creation. */
  resolveMeetingProjectId?: (meetingId: string) => Promise<string | null>;
  /** Resolve user ids → display names for server-rendered documents (e.g. meeting minutes). */
  resolveUserNames?: (ids: string[]) => Promise<Map<string, string>>;
  /** Resolve a project id → its details for server-rendered documents (meeting minutes header). */
  resolveProject?: (projectId: string) => Promise<MinutesProjectSource | null>;
  activityService?: ActivityService;
  auditService?: AuditService;
  settingsService?: SettingsService;
  aiConfigService?: AiConfigService;
  /** Product-facing AI features (task breakdown, NL capture, project summary, priority). */
  aiFeatureService?: AiFeatureService;
  onTaskEvent?: (projectId: string, event: string, payload: unknown) => void;
  logger?: Logger;
  /** Error tracking sink (Sentry adapter in prod; no-op by default) — called on 500s (T19.2). */
  errorReporter?: { captureException: (err: unknown, context?: Record<string, unknown>) => void };
  emailWebhookService?: EmailWebhookService;
  mailjetWebhookToken?: string;
  /**
   * Which proxies to trust for the client IP (Fastify `trustProxy`). Behind nginx / Hostinger's
   * proxy this must be set, otherwise every request appears to come from the proxy and all users
   * share one rate-limit bucket. Accepts true, a hop count, IPs/CIDRs, or 'loopback'.
   */
  trustProxy?: boolean | number | string | string[];
  /** Requests per minute per signed-in user (or per IP when signed out). Default 600. */
  rateLimitMax?: number;
  /** Requests per minute per IP for sign-in, code and password-reset endpoints. Default 20. */
  authRateLimitMax?: number;
  /** Enables `Idempotency-Key` support on POST routes (replay-safe offline queues). */
  idempotencyStore?: IdempotencyStore;
  /** "Download my data" (GET /users/me/export). */
  dataExporter?: DataExporter;
}

/** Only the API is rate limited: static files (uploads, brand assets, the web app) and the liveness check are not. */
function isRateLimitExempt(url: string): boolean {
  return !url.startsWith('/api/') || url === '/api/v1/health';
}

/** Sign-in and recovery endpoints get a stricter per-IP limit (brute force / email flooding). */
const SENSITIVE_AUTH_ROUTES = ['/api/v1/auth/login', '/api/v1/auth/otp/', '/api/v1/auth/password/'];

/** Map Prisma errors that come from bad input or races to clear 4xx responses. */
function prismaErrorResponse(err: unknown): { status: number; code: string; message: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { name?: string; code?: string };
  if (e.name === 'PrismaClientValidationError') return { status: 400, code: 'VALIDATION', message: 'Invalid input.' };
  if (e.name !== 'PrismaClientKnownRequestError') return null;
  switch (e.code) {
    case 'P2000':
      return { status: 400, code: 'VALUE_TOO_LONG', message: 'A value is too long.' };
    case 'P2002':
      return { status: 409, code: 'CONFLICT', message: 'That value is already in use.' };
    case 'P2003':
      return { status: 409, code: 'REFERENCE_CONFLICT', message: 'A related record is missing or still in use.' };
    case 'P2025':
      return { status: 404, code: 'NOT_FOUND', message: 'Not found.' };
    default:
      return null;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  // `logger: false` disables all Fastify logging (incl. request logs), so the
  // former `disableRequestLogging` option is redundant — and it's deprecated in
  // fastify 5. We log via deps.logger (structured JSON) instead.
  // Fastify accepts a hop count at runtime, but its typings only list boolean | string | string[].
  const app = Fastify({ logger: false, trustProxy: (deps.trustProxy ?? false) as boolean | string | string[] });

  // The verified user of a request (HMAC check only — no database), used to key rate limits
  // and idempotency records per user instead of per IP (a whole office can share one IP).
  const userIdOf = (req: FastifyRequest): string | null => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    try {
      const claims = deps.tokenService.verifyAccess(header.slice('Bearer '.length).trim());
      return claims.type === 'access' && typeof claims.sub === 'string' ? claims.sub : null;
    } catch {
      return null;
    }
  };

  await app.register(helmet, { contentSecurityPolicy: false });
  // Every method the API uses: @fastify/cors only allows GET, HEAD and POST unless told otherwise,
  // which would stop trusted origins (the Chrome extension, a separately hosted web app) from
  // editing, moving or deleting anything.
  // Content-Disposition is exposed so the apps can save an export under the name the server gives it.
  await app.register(cors, {
    origin: deps.corsOrigins ?? true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: ['Content-Disposition'],
  });
  // Must be added before the rate-limit plugin so its per-route config is in place when the
  // plugin's own onRoute hook reads it.
  app.addHook('onRoute', (route) => {
    if (SENSITIVE_AUTH_ROUTES.some((p) => route.url.startsWith(p))) {
      route.config = {
        ...(route.config ?? {}),
        rateLimit: { max: deps.authRateLimitMax ?? 20, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => `auth:${req.ip}` },
      } as typeof route.config;
    }
  });
  await app.register(rateLimit, {
    global: true,
    max: deps.rateLimitMax ?? 600,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const userId = userIdOf(req);
      return userId ? `user:${userId}` : `ip:${req.ip}`;
    },
    allowList: (req) => isRateLimitExempt(req.url),
  });
  if (deps.idempotencyStore) registerIdempotency(app, { store: deps.idempotencyStore, userIdOf });

  // Uploaded files (avatars, task/chat attachments, project images) and brand assets
  // are public and embedded cross-origin — by the SPA on a different origin/port and by
  // email clients. Helmet sets Cross-Origin-Resource-Policy: same-origin globally, which
  // makes the browser block those <img> loads (net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin).
  // Relax CORP to cross-origin for just those public asset paths; the API stays same-origin.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/uploads/') || req.url.startsWith('/email-assets/')) {
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Invalid input.', details: err.flatten() } });
    }
    const mapped = prismaErrorResponse(err);
    if (mapped) return reply.status(mapped.status).send({ error: { code: mapped.code, message: mapped.message } });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
    }
    if (status >= 500) {
      // Fastify's own logger is disabled; log structured JSON (or console fallback).
      if (deps.logger) deps.logger.error('request failed', { method: req.method, url: req.url, status, err });
      else console.error(`[${req.method} ${req.url}] ${status}`, err);
      deps.errorReporter?.captureException(err, { method: req.method, url: req.url });
    }
    return reply.status(status).send({
      error: { code: status >= 500 ? 'INTERNAL' : 'REQUEST_ERROR', message: status >= 500 ? 'Something went wrong.' : (err as Error).message },
    });
  });

  const startedAt = Date.now();
  app.get('/api/v1/health', async () => ({
    data: { status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), timestamp: new Date().toISOString() },
  }));

  // Public client config — the single source of truth for the company time zone
  // (readable by every role) plus the current server time to anchor the clock.
  app.get('/api/v1/config', async () => ({
    data: {
      timeZone: deps.appConfig?.timeZone ?? 'Asia/Muscat',
      productName: deps.appConfig?.productName ?? 'MICO360 Tasks',
      companyName: deps.appConfig?.companyName ?? 'MICO360',
      // Lets sign-in screens hide "email me a code" / password reset when email isn't set up.
      emailEnabled: deps.appConfig?.emailEnabled ?? true,
      // Where the "Download for Android" button points: ANDROID_APP_URL, or the APK a self-contained
      // install hosts at /downloads/MICO360-Tasks.apk. Null: the web app opens the public releases page.
      androidAppUrl: deps.appConfig?.androidAppUrl || null,
      serverTime: new Date().toISOString(),
    },
  }));
  // Process metrics for monitoring (T19.3). Admin-only: pid, Node version and memory are
  // internal details that anonymous callers shouldn't see (uptime checks use /health).
  // One guard for every route, so its short account-state cache is shared.
  const guard = createAuthGuard(deps.tokenService, { userState: deps.userState });
  app.get('/api/v1/metrics', { preHandler: guard.requireRoles('ADMIN') }, async () => {
    const mem = process.memoryUsage();
    return {
      data: {
        uptimeSeconds: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        pid: process.pid,
        nodeVersion: process.version,
      },
    };
  });

  await app.register(
    async (api) => {
      await registerAuthRoutes(api, deps);
      // Register multipart ONCE for the whole API (task/chat attachments + avatar/project images use req.file()).
      if (deps.attachmentService || deps.chatService || deps.chatAttachmentStorage) {
        await api.register(multipart, { limits: { fileSize: deps.attachmentMaxSizeBytes ?? 10 * 1024 * 1024, files: 1 } });
      }
      // Per-project authorization (T2.7). Defaults to admin-only when no manager lookup is wired.
      const projectAuthz =
        deps.projectAuthz ??
        createProjectAuthz({
          managers: { async isManager() { return false; }, async projectIdOfColumn() { return null; }, async projectIdOfTask() { return null; } },
        });
      // Object-level view authorization (undefined ⇒ endpoints stay open, e.g. in unit tests).
      const access = deps.projectAccess;
      const canViewTask = access ? (u: string, r: string[], t: string) => access.canViewTask(u, r, t) : undefined;
      const canViewProject = access ? (u: string, r: string[], p: string) => access.canViewProject(u, r, p) : undefined;
      const accessibleProjectIds = access ? (u: string, r: string[]) => access.accessibleProjectIds(u, r) : undefined;
      const mAccess = deps.meetingAccess;
      const canViewMeeting = mAccess ? (u: string, r: string[], m: string) => mAccess.canViewMeeting(u, r, m) : undefined;
      const meetingAccessibleProjectIds = mAccess ? (u: string, r: string[]) => mAccess.accessibleProjectIds(u, r) : undefined;
      if (deps.projectService) {
        await registerProjectRoutes(api, {
          projectService: deps.projectService,
          guard,
          listProjectTasks: deps.taskService ? (projectId) => deps.taskService!.listTasks({ projectId }) : undefined,
          timeZone: deps.appConfig?.timeZone,
          audit: deps.auditService,
          storage: deps.chatAttachmentStorage,
          imageMaxBytes: deps.attachmentMaxSizeBytes,
        });
      }
      if (deps.columnService) {
        await registerColumnRoutes(api, { columnService: deps.columnService, authz: projectAuthz, guard, broadcast: deps.onTaskEvent, canViewProject });
      }
      if (deps.taskExportSource) {
        await registerTaskExportRoutes(api, {
          guard,
          source: deps.taskExportSource,
          canViewTask,
          userName: deps.reportNames ? (id) => deps.reportNames!.user(id) : undefined,
          timeZone: deps.appConfig?.timeZone ?? 'Asia/Muscat',
        });
      }
      if (deps.memberService) {
        await registerMemberRoutes(api, { memberService: deps.memberService, authz: projectAuthz, guard, audit: deps.auditService, canViewProject });
      }
      if (deps.taskService) {
        await registerTaskRoutes(api, {
          taskService: deps.taskService,
          guard,
          broadcast: deps.onTaskEvent,
          canDeleteTask: (userId, roles, taskId) => projectAuthz.canManageTask(userId, roles, taskId),
          canViewTask,
          accessibleProjectIds,
          tagService: deps.tagService,
          assigneeService: deps.assigneeService,
          carryForwardService: deps.carryForwardService,
          projectOwnerOf: deps.projectService
            ? async (projectId) => (await deps.projectService!.getProject(projectId)).ownerId
            : undefined,
        });
      }
      if (deps.assigneeService) {
        await registerAssigneeRoutes(api, {
          assigneeService: deps.assigneeService,
          guard,
          broadcast: deps.onTaskEvent,
          projectIdOfTask: deps.taskService
            ? async (taskId) => (await deps.taskService!.getTask(taskId)).projectId
            : undefined,
          canViewTask,
        });
      }
      if (deps.watcherService) {
        await registerWatcherRoutes(api, {
          watcherService: deps.watcherService,
          guard,
          broadcast: deps.onTaskEvent,
          projectIdOfTask: deps.taskService
            ? async (taskId) => (await deps.taskService!.getTask(taskId)).projectId
            : undefined,
          canViewTask,
        });
      }
      if (deps.tagService) {
        await registerTagRoutes(api, {
          tagService: deps.tagService,
          guard,
          broadcast: deps.onTaskEvent,
          projectIdOfTask: deps.taskService
            ? async (taskId) => (await deps.taskService!.getTask(taskId)).projectId
            : undefined,
          canViewTask,
        });
      }
      if (deps.checklistService) {
        await registerChecklistRoutes(api, {
          checklistService: deps.checklistService,
          guard,
          broadcast: deps.onTaskEvent,
          projectIdOfTask: deps.taskService
            ? async (taskId) => (await deps.taskService!.getTask(taskId)).projectId
            : undefined,
          canViewTask,
        });
      }
      if (deps.commentService) {
        await registerCommentRoutes(api, {
          commentService: deps.commentService,
          guard,
          broadcast: deps.onTaskEvent,
          projectIdOfTask: deps.taskService
            ? async (taskId) => (await deps.taskService!.getTask(taskId)).projectId
            : undefined,
          canViewTask,
        });
      }
      if (deps.chatService) {
        await registerChatRoutes(api, {
          messageService: deps.chatService,
          guard,
          broadcastToProject: deps.onTaskEvent,
          broadcastToUser: deps.onChatUserEvent,
          storage: deps.chatAttachmentStorage,
          attachmentMaxSizeBytes: deps.attachmentMaxSizeBytes,
          attachmentAllowedMime: deps.attachmentAllowedMime,
        });
      }
      if (deps.attachmentService) {
        await registerAttachmentRoutes(api, {
          attachmentService: deps.attachmentService,
          guard,
          maxSizeBytes: deps.attachmentMaxSizeBytes ?? 10 * 1024 * 1024,
          canViewTask,
        });
      }
      if (deps.dependencyService) {
        await registerDependencyRoutes(api, { dependencyService: deps.dependencyService, guard, canViewTask });
      }
      if (deps.userService) {
        await registerUserRoutes(api, {
          userService: deps.userService,
          guard,
          audit: deps.auditService,
          storage: deps.chatAttachmentStorage,
          avatarMaxBytes: deps.attachmentMaxSizeBytes,
          exportData: deps.dataExporter,
          timeZone: deps.appConfig?.timeZone,
        });
      }
      if (deps.notificationService) {
        await registerNotificationRoutes(api, { notificationService: deps.notificationService, guard });
      }
      if (deps.deviceTokenService) {
        await registerDeviceTokenRoutes(api, { deviceTokenService: deps.deviceTokenService, guard });
      }
      if (deps.reportService) {
        await registerReportRoutes(api, { reportService: deps.reportService, guard, names: deps.reportNames });
      }
      if (deps.searchService) {
        await registerSearchRoutes(api, { searchService: deps.searchService, guard, accessibleProjectIds });
      }
      if (deps.meetingService) {
        await registerMeetingRoutes(api, { meetingService: deps.meetingService, guard, broadcast: deps.onTaskEvent, canViewMeeting, accessibleProjectIds: meetingAccessibleProjectIds, notify: deps.meetingNotifyService, logger: deps.logger });
      }
      if (deps.attendeeService) {
        await registerAttendeeRoutes(api, { attendeeService: deps.attendeeService, guard, canViewMeeting });
      }
      if (deps.agendaService) {
        await registerAgendaRoutes(api, { agendaService: deps.agendaService, guard, canViewMeeting });
      }
      if (deps.actionItemService) {
        await registerActionItemRoutes(api, {
          actionItemService: deps.actionItemService,
          guard,
          canViewMeeting,
          resolveMeetingProjectId: deps.resolveMeetingProjectId,
        });
      }
      if (deps.noteService) {
        await registerNoteRoutes(api, {
          noteService: deps.noteService,
          guard,
          canViewMeeting,
          noteTaskService: deps.noteTaskService,
          accessibleProjectIds,
        });
      }
      if (deps.meetingService && deps.attendeeService && deps.agendaService && deps.noteService && deps.resolveUserNames) {
        await registerMinutesRoutes(api, {
          meetingService: deps.meetingService,
          attendeeService: deps.attendeeService,
          agendaService: deps.agendaService,
          noteService: deps.noteService,
          guard,
          canViewMeeting,
          resolveUserNames: deps.resolveUserNames,
          resolveProject: deps.resolveProject,
          notify: deps.meetingNotifyService,
        });
      }
      if (deps.activityService) {
        await registerActivityRoutes(api, { activityService: deps.activityService, guard, canViewTask, accessibleProjectIds });
      }
      if (deps.auditService) {
        await registerAuditRoutes(api, { auditService: deps.auditService, guard, timeZone: deps.appConfig?.timeZone });
      }
      if (deps.settingsService) {
        await registerSettingsRoutes(api, { settingsService: deps.settingsService, guard, audit: deps.auditService });
      }
      if (deps.aiConfigService) {
        await registerAiRoutes(api, { aiConfigService: deps.aiConfigService, guard });
      }
      if (deps.aiFeatureService) {
        await registerAiFeatureRoutes(api, { aiFeatureService: deps.aiFeatureService, guard });
      }
      if (deps.emailWebhookService) {
        await registerEmailWebhookRoutes(api, { emailWebhookService: deps.emailWebhookService, token: deps.mailjetWebhookToken });
      }
    },
    { prefix: '/api/v1' },
  );

  return app;
}
