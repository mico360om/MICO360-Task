import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { RecordTaskActivity } from './modules/activity/task-activity';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { HttpError, NotFoundError } from './lib/http-errors';
import type { Logger } from './lib/logger';
import { DATABASE_BUSY_MESSAGE, databaseConnectionCode } from './lib/db-connection';
import { registerIdempotency, type IdempotencyStore } from './lib/idempotency';
import { registerRequestTiming } from './lib/request-timing';
import { registerEmailWebhookRoutes } from './modules/email/email-webhook-routes';
import type { EmailWebhookService } from './modules/email/email-webhook-service';
import { registerAuthRoutes, type AuthRouteDeps } from './modules/auth/auth-routes';
import { createAuthGuard, type UserStateLookup } from './modules/auth/auth-guard';
import type { ManagerViewLookup } from './modules/auth/manager-view';
import { registerManagerViewRoutes, type ManagerViewStore } from './modules/users/manager-view-routes';
import { registerProjectRoutes } from './modules/projects/project-routes';
import type { ProjectOverviewSource } from './modules/projects/project-overview';
import type { ProjectService } from './modules/projects/project-service';
import { registerTaskRoutes, type TaskMeetingLookup } from './modules/tasks/task-routes';
import { registerTaskApprovalRoutes, type ApprovalSource, type ApprovalViewer, type TaskApprovalDetails } from './modules/tasks/task-approval-routes';
import type { TaskRecord } from './modules/tasks/task-repository';
import { registerTaskExportRoutes } from './modules/tasks/task-export-routes';
import { registerTaskMoveRoutes } from './modules/tasks/task-move-routes';
import type { TaskMoveService } from './modules/tasks/task-move-service';
import { installMergedTaskRedirect, registerTaskMergeRoutes } from './modules/task-merge/merge-routes';
import { registerTaskDuplicateRoutes } from './modules/tasks/task-duplicate-routes';
import type { TaskDuplicateService } from './modules/tasks/task-duplicate';
import type { DuplicateLinks } from './modules/tasks/task-routes';
import type { TaskMergeService } from './modules/task-merge/merge-service';
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
import { registerExternalContactRoutes } from './modules/tasks/external-contact-routes';
import type { ExternalContactService } from './modules/tasks/external-contact-service';
import { registerCommentRoutes } from './modules/tasks/comment-routes';
import type { CommentService } from './modules/tasks/comment-service';
import { registerChatRoutes } from './modules/chat/chat-routes';
import type { MessageService } from './modules/chat/message-service';
import { registerAttachmentRoutes } from './modules/tasks/attachment-routes';
import type { AttachmentService } from './modules/tasks/attachment-service';
import { registerDependencyRoutes } from './modules/tasks/dependency-routes';
import type { DependencyService } from './modules/tasks/dependency-service';
import { registerUserRoutes } from './modules/users/user-routes';
import { registerPreferenceRoutes, type PreferencesRepository } from './modules/users/user-preferences';
import type { UserService } from './modules/users/user-service';
import type { WelcomeService } from './modules/users/welcome-service';
import { registerNotificationRoutes } from './modules/notifications/notification-routes';
import { registerDailyEmailRoutes, type DailyEmailRouteDeps } from './modules/daily-emails/daily-email-routes';
import type { NotificationService } from './modules/notifications/notification-service';
import { registerDeviceTokenRoutes } from './modules/device-tokens/device-token-routes';
import type { DeviceTokenService } from './modules/device-tokens/device-token-service';
import { registerReportRoutes } from './modules/reports/report-routes';
import type { ReportService } from './modules/reports/report-service';
import { registerSearchRoutes } from './modules/search/search-routes';
import type { SearchService } from './modules/search/search-service';
import { registerMeetingRoutes, type MeetingListCounts } from './modules/meetings/meeting-routes';
import type { MeetingService } from './modules/meetings/meeting-service';
import type { MeetingSeriesService } from './modules/meetings/meeting-series-service';
import type { MeetingAccess } from './modules/meetings/meeting-access';
import { registerAttendeeRoutes } from './modules/meetings/attendee-routes';
import type { AttendeeService } from './modules/meetings/attendee-service';
import { registerAgendaRoutes } from './modules/meetings/agenda-routes';
import type { AgendaService } from './modules/meetings/agenda-service';
import { registerNoteRoutes } from './modules/meetings/note-routes';
import type { NoteService } from './modules/meetings/note-service';
import type { NoteTaskService } from './modules/meetings/note-task-service';
import { registerMinutesRoutes, type MinutesProjectSource } from './modules/meetings/minutes-routes';
import type { FinalMinutesRepository } from './modules/meetings/final-minutes-repository';
import type { MeetingNotifyService } from './modules/meetings/meeting-notify-service';
import { registerActionItemRoutes } from './modules/meetings/action-item-routes';
import { registerNamedSeriesRoutes } from './modules/meetings/named-series-routes';
import type { NamedSeriesService } from './modules/meetings/named-series-service';
import type { ActionItemService } from './modules/meetings/action-item-service';
import { registerColumnRoutes } from './modules/projects/column-routes';
import type { ColumnService } from './modules/projects/column-service';
import { registerMemberRoutes } from './modules/projects/member-routes';
import type { MemberService } from './modules/projects/member-service';
import { createProjectAuthz, type ProjectAuthz } from './modules/projects/project-authz';
import type { ProjectNotices } from './modules/projects/project-notices';
import type { ProjectAccess } from './modules/projects/project-access';
import { registerActivityRoutes } from './modules/activity/activity-routes';
import type { ActivityService } from './modules/activity/activity-service';
import { registerAuditRoutes } from './modules/audit/audit-routes';
import type { AuditService } from './modules/audit/audit-service';
import { registerSettingsRoutes } from './modules/settings/settings-routes';
import { registerAboutRoutes, type AboutRouteDeps } from './modules/about/about-routes';
import type { SettingsService } from './modules/settings/settings-service';
import { registerAiRoutes } from './modules/ai/ai-config-routes';
import type { AiConfigService } from './modules/ai/ai-config-service';
import { registerAiFeatureRoutes } from './modules/ai/ai-feature-routes';
import type { AiFeatureService } from './modules/ai/ai-feature-service';
import { registerPlanningRoutes } from './modules/planning/planning-routes';
import type { TimelineSource } from './modules/planning/timeline';
import type { WorkloadStore } from './modules/planning/workload-service';
import { defaultCompanyTimeZone } from './modules/tasks/task-status';
import { registerMicoAiRoutes } from './modules/mico-ai/mico-ai-routes';
import type { MicoAiService } from './modules/mico-ai/mico-ai-service';
import type { CorsOriginMatcher } from './lib/cors-origins';
import type { DataExporter } from './modules/users/data-export';
import { registerClientViewRoutes, type ClientViewRouteDeps } from './modules/client-view/client-view-routes';
import { registerTemplateRoutes } from './modules/templates/template-routes';
import type { TemplateService } from './modules/templates/template-service';
import { registerInspectionRoutes, type InspectionRouteDeps } from './modules/inspections/inspection-routes';
import { registerManagementRoutes, type ManagementRouteDeps } from './modules/management/management-routes';
import { registerBackupRoutes, type BackupRouteDeps } from './modules/backups/backup-routes';
import { registerMicrosoftRoutes, type MicrosoftRouteDeps } from './modules/integrations/microsoft/microsoft-routes';
import type { MeetingTeamsLinks } from './modules/meetings/meeting-routes';
import type { CompanyAccess } from './modules/companies/company-access';
import { createArchiveGuard, installArchiveGuard, type ArchiveLookup } from './modules/companies/archive-guard';
import { NO_PICK, createPickResolver, type PickOf } from './modules/companies/company-pick';
import { registerCompanyRoutes } from './modules/companies/company-routes';
import type { CompanyService } from './modules/companies/company-service';
import type { CompanyMembership } from './modules/companies/company-membership';
import type { OnProjectAudienceChanged, ProjectCompanies } from './modules/companies/project-companies';
import { registerPeopleRoutes } from './modules/companies/people-routes';
import { keepKnownPeople, type PersonOptions } from './modules/companies/person-options';
import { fullViewOrInviteeRefusal } from './modules/meetings/invitee-view';
import { inviteTargetOf, type MeetingInvitees } from './modules/meetings/meeting-invitees';
import type { MeetingCompanyRule } from './modules/meetings/meeting-company';
import type { PdfBrands } from './modules/companies/company-branding';
import { registerClientAccountRoutes } from './modules/clients/client-account-routes';
import type { ClientAccounts } from './modules/clients/client-accounts';
import { registerPortalRoutes } from './modules/clients/portal-routes';
import type { PortalService } from './modules/clients/portal-service';
import type { CompanyTime } from './modules/companies/company-time';
import { registerErrorLogRoutes } from './modules/error-log/error-log-routes';
import type { ErrorLogService } from './modules/error-log/error-log-service';
import type { DatabaseCheckResult } from './modules/error-log/database-check';
import { registerDashboardRoutes } from './modules/dashboard/dashboard-routes';
import { registerHealthRoutes } from './modules/project-health/health-routes';
import type { ProjectHealthService } from './modules/project-health/health-service';
import type { PrioritiesService } from './modules/dashboard/priorities-service';
import type { DashboardLayoutStore } from './modules/dashboard/dashboard-layout-store';

export interface AppDeps extends AuthRouteDeps {
  /** Each person's own date settings (week start, time zone) — GET/PUT /users/me/preferences. */
  userPreferences?: PreferencesRepository;
  /** How many copies a recurring series has (the calendar's projected dates respect its count). */
  seriesInstanceCount?: (seriesId: string) => Promise<number>;
  /** The meeting a task came from, for its details (defaults to the meeting service + meeting access). */
  taskMeeting?: TaskMeetingLookup;
  /** The inspection form a task carries, for its details: its title, and whether it was deleted. */
  taskInspectionForm?: (formId: string) => Promise<{ id: string; title: string; deleted: boolean } | null>;
  /** Task approvals: the To approve list (and Approve / Send back through the task service). */
  approvalSource?: ApprovalSource;
  /** A task's approval as its details show it to one person. */
  taskApprovalDetails?: (viewer: ApprovalViewer, task: TaskRecord) => Promise<TaskApprovalDetails>;
  /** 1.23.4 Smarter Dashboard: "My Priorities Today" (GET /dashboard/priorities). */
  dashboardPriorities?: Pick<PrioritiesService, 'get'>;
  /** 1.23.4 Smarter Dashboard: each person's widget arrangement and the administrators' two defaults. */
  dashboardLayouts?: DashboardLayoutStore;
  /**
   * 1.23.5 Project overview & health: the cards' marks and risks (GET /projects/overview), the Overview
   * tab's health, risks and owners (GET /projects/:id/health) and Next actions (GET /projects/:id/next-actions).
   */
  projectHealth?: Pick<ProjectHealthService, 'cards' | 'detail' | 'nextActions' | 'changed'>;
  /** Write a line to a task's activity timeline — checklist, comment, file and blocker changes. */
  recordTaskActivity?: RecordTaskActivity;
  corsOrigins?: string[] | boolean | CorsOriginMatcher;
  /** Public app config surfaced at GET /api/v1/config (company time zone, names, whether email works). */
  appConfig?: {
    timeZone: string;
    productName: string;
    companyName: string;
    emailEnabled?: boolean;
    androidAppUrl?: string | null;
    /** The version of the app file the site offers (read from the file; null: none or unknown). */
    androidAppVersion?: () => string | null;
    /** The company week start (everyone's default) and whether the weekly management summary is on. */
    company?: () => Promise<{ weekStart: 0 | 1 | 6; weeklySummaryEnabled: boolean }>;
    /** 1.23: automatic Teams links are set up on this server (the website shows them only then). */
    microsoftTeams?: boolean;
  };
  /**
   * Live account state for the auth guard (token version, status, current roles). When set, a
   * suspended / deleted / demoted user loses access at once instead of when their token expires.
   */
  userState?: UserStateLookup;
  /** Manager View (owner, 10 Nov): an administrator's own switch — GET/PUT /users/me/manager-view. */
  managerViewStore?: ManagerViewStore;
  /** Manager View's project-settings rule: does this person run the project (absent: refused, fails closed). */
  managerViewLookup?: ManagerViewLookup;
  projectService?: ProjectService;
  /** The Projects page's figures in grouped queries (GET /projects/overview). */
  projectOverview?: ProjectOverviewSource;
  /** The Timeline page's figures, milestones and meetings in grouped queries (GET /timeline). */
  timelineSource?: TimelineSource;
  /** The Workload page's people, tasks due and teams in grouped queries (GET /workload). */
  workloadStore?: WorkloadStore;
  /** The time now for the Timeline and Workload pages (tests pin it). */
  planningNow?: () => Date;
  columnService?: ColumnService;
  memberService?: MemberService;
  projectAuthz?: ProjectAuthz;
  /** Tells people they've been put on a project (on creation and on the Team tab). */
  projectNotices?: ProjectNotices;
  /** Object-level view authorization (T2.7). When present, task/column/member/comment reads are gated to accessible projects. */
  projectAccess?: ProjectAccess;
  taskService?: TaskService;
  /** 1.23.7: a task's file was shown to clients ("Show to client"): their notices. */
  onFileShownToClient?: (attachmentId: string) => void | Promise<void>;
  /** Moving tasks to another project (move-targets, move-preview, move-to-project). */
  taskMoveService?: TaskMoveService;
  /** 1.23.1 Merge tasks: the merge dialog, the merge, a main task's "Merged from" panel and Undo. */
  taskMergeService?: TaskMergeService;
  /** Duplicate Task: the review form's pre-fill and the copy (GET/POST /tasks/:id/duplicate). */
  taskDuplicateService?: TaskDuplicateService;
  /** Duplicate Task: copies one person may make a minute (default 20; each copies its files on the server). */
  duplicatesPerMinute?: number;
  /** Duplicate Task: the task a copy was made from, and an original's copies (a task's details; each shown only to whoever may open it). */
  duplicateLinks?: (taskId: string) => Promise<DuplicateLinks>;
  carryForwardService?: import('./modules/tasks/carry-forward-service').CarryForwardService;
  assigneeService?: AssigneeService;
  watcherService?: WatcherService;
  tagService?: TagService;
  checklistService?: ChecklistService;
  /** 1.23.3: tell someone they were given a checklist item (bell, and email/push by their settings). */
  onChecklistItemAssigned?: (n: { taskId: string; itemId: string; text: string; assigneeId: string; actorId: string }) => Promise<void>;
  /** 1.23.3 My Tasks → "Checklist items for me": open items given to a person, in these projects. */
  checklistMine?: (userId: string, projectIds: string[] | null) => Promise<import('./modules/tasks/checklist-routes').MyChecklistItem[]>;
  /** 1.23.3: dated checklist items for the calendar, in the caller's scope. */
  checklistDue?: (opts: { from: string; to: string; userId: string; ownIds: string[] | null; listIds: string[] | null }) => Promise<unknown[]>;
  /** People's names by id (checklist: who deleted something, who an item was taken from). */
  namesOfUsers?: (userIds: string[]) => Promise<Map<string, string>>;
  /** External contacts on tasks: the people outside the company responsible for a task. */
  externalContactService?: ExternalContactService;
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
  /** Makes an attached picture smaller before it is stored (chat; tasks get it in their service). */
  shrinkImage?: (content: Buffer, mimeType: string) => Promise<Buffer>;
  /** Whether pictures are made smaller on this server (null until checked), shown on /health. */
  pictureShrinking?: () => boolean | null;
  dependencyService?: DependencyService;
  userService?: UserService;
  /** Welcome emails from User Management (a "Set your password" link); administrators only. */
  welcomeService?: WelcomeService;
  /** 1.23.6: System Settings → Accounts, "Invitation links last" (days; unused temporary passwords too). */
  invitationDays?: () => Promise<number>;
  /** Onboarding: the New / Manage account forms' duplicate check while typing. */
  identityLookup?: import('./modules/users/identity-check').IdentityLookup;
  /** Onboarding: an administrator's "Send password reset" (a link valid 1 hour). */
  adminPasswordReset?: { isConfigured(): boolean; sendForAdministrator(userId: string): Promise<import('./modules/auth/password-reset-service').AdminResetOutcome> };
  /** 1.23 Client accounts (administrators) and "Clients with access" on a project. */
  clientAccounts?: ClientAccounts;
  /** 1.23 The Client portal's reads and actions (client accounts only). */
  portal?: PortalService;
  /** 1.23: the client copy of shown minutes for a client the minutes are emailed to (else they get nothing). */
  clientMinutes?: import('./modules/meetings/minutes-routes').MinutesRouteDeps['clientMinutes'];
  /** PDFs a client may download a minute from the portal (default 10). */
  portalPdfsPerMinute?: number;
  notificationService?: NotificationService;
  /** Free times for Schedule meeting (busy meetings, working hours, names). */
  meetingFreeTimes?: import('./modules/meetings/meeting-routes').FreeTimesDeps;
  /** Is this an existing, active user? Checks the people sent with a new meeting. */
  isActiveUser?: (userId: string) => Promise<boolean>;
  /** Draft agenda's project tasks and last meeting's leftovers, gathered with the person's access. */
  meetingAgendaSources?: import('./modules/ai/ai-feature-routes').AgendaSourcesFor;
  /**
   * The two morning task emails: "Send me a test now", and for admins the delivery log, the day's
   * overview, sending today's emails now (everyone's or one person's) and a preview.
   */
  dailyEmails?: Omit<DailyEmailRouteDeps, 'guard' | 'audit'>;
  deviceTokenService?: DeviceTokenService;
  reportService?: ReportService;
  /** Reads a task with everything its Excel / PDF export shows. */
  taskExportSource?: TaskExportSource;
  /** Reads an attached file's stored bytes by its storage key, so a task's PDF shows its pictures. */
  readAttachment?: (storageKey: string) => Promise<Buffer | null>;
  /** Makes a small picture a PDF can print (a JPEG thumbnail) from a stored one: a task PDF's pictures. */
  pictureThumbnail?: (raw: Buffer) => Promise<Buffer | null>;
  /** Names for report exports (project, team member, author). */
  reportNames?: import('./modules/reports/report-routes').ReportNames;
  searchService?: SearchService;
  /** The full task search (GET /search/tasks): the task search index, scoped to what each person can open. */
  taskSearch?: Pick<import('./modules/search/task-search-engine').TaskSearchEngine, 'search'>;
  /** 1.23 Search everything (GET /search/all, the AI panel): every kind of item each person may open. */
  searchEverything?: import('./modules/search/search-routes').SearchEverythingDeps;
  /** 1.23.6 Saved searches (GET/POST /search/saved…). */
  savedSearches?: import('./modules/search/saved-searches').SavedSearches;
  meetingService?: MeetingService;
  /** Repeating meetings: creates a series' meetings and changes all its upcoming ones. */
  meetingSeriesService?: MeetingSeriesService;
  /** 1.23 Meeting series (named series of related meetings): their routes, the list's chips, the minutes' carry-over. */
  namedSeriesService?: NamedSeriesService;
  /** A project's meetings, decisions and action items for its dashboard. */
  projectMeetings?: import('./modules/meetings/meeting-routes').ProjectMeetingsDeps;
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
  /** Each listed meeting's people, minutes, decisions and open action items (the meetings list). */
  meetingListCounts?: (meetingIds: string[]) => Promise<Record<string, MeetingListCounts>>;
  /**
   * Board keys of tasks by id (meeting action items name their linked task); with `projectIds`, only of
   * the tasks in those projects (1.22.3 review: the reader's; null: every project).
   */
  resolveTaskKeys?: (taskIds: string[], projectIds?: readonly string[] | null) => Promise<Record<string, string>>;
  /** Resolve user ids → display names for server-rendered documents (e.g. meeting minutes). */
  resolveUserNames?: (ids: string[]) => Promise<Map<string, string>>;
  /** Resolve a project id → its details for server-rendered documents (meeting minutes header). */
  resolveProject?: (projectId: string) => Promise<MinutesProjectSource | null>;
  /** Reads a project's stored picture for the minutes PDF header. */
  readProjectImage?: (imageUrl: string) => Promise<Buffer | null>;
  /** Converts a picture the PDF can't take as stored (WebP, GIF, some PNGs) into one it can. */
  printableProjectImage?: (raw: Buffer) => Promise<Buffer | null>;
  /** Where meetings' final minutes (Final MOM) are kept. */
  finalMinutesRepository?: FinalMinutesRepository;
  /** Each send of a meeting's minutes: its "Sent" log and the Cc suggestions (1.22). */
  minutesSendRepository?: import('./modules/meetings/minutes-send-repository').MinutesSendRepository;
  /** Drafts final minutes with the AI from a meeting's facts. */
  draftMinutesWithAi?: (facts: string, requester: { userId: string; roles?: string[] }) => Promise<unknown>;
  /** 1.22 (§10): "Draft with AI" running in the background (answered at once, kept when ready). */
  finalMinutesAi?: import('./modules/meetings/final-minutes-ai').FinalMinutesAi;
  /** A meeting's final minutes were saved, approved or reopened (its live event). */
  onFinalMinutesChanged?: (meetingId: string) => void;
  activityService?: ActivityService;
  auditService?: AuditService;
  settingsService?: SettingsService;
  /** The running build's version and the changelog (GET /version, /releases). */
  about?: Pick<AboutRouteDeps, 'release'>;
  aiConfigService?: AiConfigService;
  /** Product-facing AI features (task breakdown, NL capture, project summary, priority). */
  aiFeatureService?: AiFeatureService;
  /** MICO AI: each person's private chats with the read-only assistant. */
  micoAiService?: MicoAiService;
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
  /** Security review (1.23): a person's searches a minute on each search route (default 120). */
  searchPerMinute?: number;
  /** Requests per minute per IP for sign-in, code and password-reset endpoints. Default 20. */
  authRateLimitMax?: number;
  /** Enables `Idempotency-Key` support on POST routes (replay-safe offline queues). */
  idempotencyStore?: IdempotencyStore;
  /** "Download my data" (GET /users/me/export). */
  dataExporter?: DataExporter;
  /**
   * Client view: the read-only page a client follows one project on (/client/…, no staff sign-in),
   * and the staff routes that share a project and mark its items "Show to client".
   */
  clientView?: Pick<ClientViewRouteDeps, 'service' | 'secureCookies' | 'tasks' | 'minutes' | 'rateLimits' | 'onTaskShown'>;
  /** Project and task templates (the Templates page, “Start from a template”, “Save as template”). */
  templateService?: TemplateService;
  /** Inspection checklists: forms, a project's inspections, answers, signing, follow-up tasks, reports. */
  inspections?: Omit<InspectionRouteDeps, 'guard' | 'broadcast'>;
  /** The Management page: every project's health, inspections, people and trends; its lists and its PDF. */
  management?: Omit<ManagementRouteDeps, 'guard'>;
  /** System Settings → Backups: the copies, "Back up now", downloads and Google Drive (administrators only). */
  backups?: Omit<BackupRouteDeps, 'guard' | 'audit'>;
  /**
   * Companies: who belongs to which company and which projects each one sees (the access rule every
   * project and people query is built from), and the company a request picked (X-Company-Id).
   */
  companyAccess?: CompanyAccess;
  /** 1.22: an archived project is read-only on the server too — the facts its write routes' check reads. */
  archiveLookup?: ArchiveLookup;
  /** companies: System → Companies (administrators) and each person's own companies (GET /me/companies). */
  companyService?: CompanyService;
  /** companies: people's companies and primary company (User Management; the Companies page's people). */
  companyMembership?: CompanyMembership;
  /** companies: projects' companies (their payload) — the project service holds the rules. */
  projectCompanies?: ProjectCompanies;
  /** companies: a project's companies changed (the realtime server re-checks who may see it). */
  onProjectAudienceChanged?: OnProjectAudienceChanged;
  /** companies: people as pickers show them (team candidates, meeting invitations) — names and pictures only. */
  personOptions?: PersonOptions;
  /** companies: a project's ACTIVE companies (null: none at all, from before companies) — its Team tab's candidates. */
  projectCompanyIds?: (projectId: string) => Promise<string[] | null>;
  /** companies: who may be invited to a meeting (its project's or its own company), MC1 Task 10. */
  meetingInvitees?: MeetingInvitees;
  /** companies: the company of a meeting without a project, MC1 Task 10. */
  meetingCompany?: MeetingCompanyRule;
  /** Companies: each PDF's company brand — its name (2+ companies) and logo (MC1 Task 14). Absent: the site's. */
  pdfBranding?: PdfBrands;
  /** Companies: each company's week start and working days and hours (MC1 Task 15). Absent: the site's. */
  companyTime?: Pick<CompanyTime, 'hoursFor'>;
  /**
   * 1.22.4 the Error log: browsers' reports (POST /client-errors, /client-errors/csp) and System
   * Settings → Error log (administrators). The server's own errors reach it through the logger.
   */
  errorLog?: ErrorLogService;
  /** 1.23.1: the database self-check's latest result (System Settings → Error log shows it). */
  databaseCheck?: { latest(): DatabaseCheckResult | null; run?(): Promise<DatabaseCheckResult> };
  /** 1.23: Settings → Microsoft Teams (each person's own connection) and Make Teams link on a meeting. */
  microsoft?: Omit<MicrosoftRouteDeps, 'guard' | 'audit'>;
  /** 1.23: the meeting form's "Create a Teams link" (made, taken away or made plain after a save). */
  meetingTeams?: MeetingTeamsLinks;
}

/** Only the API is rate limited: static files (uploads, brand assets, the web app) and the liveness check are not. */
function isRateLimitExempt(url: string): boolean {
  return !url.startsWith('/api/') || url === '/api/v1/health';
}

/**
 * Sign-in and recovery endpoints get a stricter per-IP limit (brute force / email flooding), the
 * fingerprint routes too (they take a key or a refresh token instead of a session).
 */
const SENSITIVE_AUTH_ROUTES = ['/api/v1/auth/login', '/api/v1/auth/otp/', '/api/v1/auth/password/', '/api/v1/auth/biometric-', '/api/v1/auth/challenge/'];

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
  // 1.23.3: each API answer says the server's time and its time in the database (Server-Timing), first of all.
  registerRequestTiming(app);

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
    // 1.22.4: X-Collect-Browser-Errors tells a page on another origin (development) that the Error log is off.
    // 1.23.3: Server-Timing — where a slow request's time went (the website sends it with its report).
    exposedHeaders: ['Content-Disposition', 'X-Collect-Browser-Errors', 'Server-Timing'],
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
    // Private data. API answers are never stored by a browser or a proxy (a shared computer's Back
    // button or a caching proxy must not replay someone's tasks), and neither they nor uploaded
    // files may appear in a search engine.
    if (req.url.startsWith('/api/')) {
      if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
      reply.header('X-Robots-Tag', 'noindex, nofollow');
    } else if (req.url.startsWith('/uploads/')) {
      reply.header('X-Robots-Tag', 'noindex, nofollow');
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
    // 1.23.1: the database couldn't be reached, dropped the connection or had none free — a blip (the live
    // site's came at deploy restarts), not a bug: 503 with words that say to try again, still recorded
    // (the Error log keeps one row per kind, with its code).
    if (databaseConnectionCode(err)) {
      if (deps.logger) deps.logger.error('request failed', { method: req.method, url: req.url, route: req.routeOptions?.url, status: 503, err, userId: req.user?.id });
      else console.error(`[${req.method} ${req.url}] 503`, err);
      return reply.status(503).header('Retry-After', '5').send({ error: { code: 'DATABASE_BUSY', message: DATABASE_BUSY_MESSAGE } });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } });
    }
    if (status >= 500) {
      // Fastify's own logger is disabled; log structured JSON (or console fallback).
      // The route pattern and the person go to the Error log with it (1.22.4; never the address, which can carry a token).
      if (deps.logger) deps.logger.error('request failed', { method: req.method, url: req.url, route: req.routeOptions?.url, status, err, userId: req.user?.id });
      else console.error(`[${req.method} ${req.url}] ${status}`, err);
      deps.errorReporter?.captureException(err, { method: req.method, url: req.url });
    }
    return reply.status(status).send({
      error: { code: status >= 500 ? 'INTERNAL' : 'REQUEST_ERROR', message: status >= 500 ? 'Something went wrong.' : (err as Error).message },
    });
  });

  const startedAt = Date.now();
  app.get('/api/v1/health', async () => ({
    data: {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
      // Whether attached pictures are stored smaller here: false means the picture library
      // couldn't load on this server, so they are kept at full size.
      pictureShrinking: deps.pictureShrinking?.() ?? null,
    },
  }));

  // Public client config — the single source of truth for the company time zone
  // (readable by every role) plus the current server time to anchor the clock.
  app.get('/api/v1/config', async () => ({
    data: {
      // The company's week start — everyone's default week start until they choose their own — and
      // whether the weekly management summary is on. Read each time (an administrator can change them);
      // Sunday and on when they can't be read.
      ...(await (deps.appConfig?.company?.() ?? Promise.resolve({ weekStart: 0, weeklySummaryEnabled: true })).catch(() => ({ weekStart: 0, weeklySummaryEnabled: true }))),
      timeZone: deps.appConfig?.timeZone ?? 'Asia/Muscat',
      productName: deps.appConfig?.productName ?? 'MICO360 Tasks',
      companyName: deps.appConfig?.companyName ?? 'MICO360',
      // Lets sign-in screens hide "email me a code" / password reset when email isn't set up.
      emailEnabled: deps.appConfig?.emailEnabled ?? true,
      // Where the "Download for Android" button points: ANDROID_APP_URL (a full address). Null for the
      // APK this site hosts itself: the web app offers /downloads/MICO360-Tasks.apk on its own site
      // and asks the site whether the file is there, and the phone app opens that path on the server
      // it is connected to (it can't open a site-relative path). Never a code-hosting page.
      androidAppUrl: deps.appConfig?.androidAppUrl && !deps.appConfig.androidAppUrl.startsWith('/') ? deps.appConfig.androidAppUrl : null,
      // The phone app says "new version" only when this download is newer than itself, so a release
      // that changes only the website never asks anyone to update.
      androidAppVersion: deps.appConfig?.androidAppVersion?.() ?? null,
      // 1.22.4: whether the page sends its errors, blocked files and slow pages to the Error log
      // (System Settings → "Collect browser errors"; off where there is no Error log).
      collectBrowserErrors: deps.errorLog ? await deps.errorLog.collectingNow() : false,
      // 1.23: Teams links are set up here (Settings → Microsoft Teams and the meeting form's tick show then).
      microsoftTeams: deps.appConfig?.microsoftTeams ?? false,
      serverTime: new Date().toISOString(),
    },
  }));
  // Process metrics for monitoring (T19.3). Admin-only: pid, Node version and memory are
  // internal details that anonymous callers shouldn't see (uptime checks use /health).
  // One guard for every route, so its short account-state cache is shared.
  const guard = createAuthGuard(deps.tokenService, { userState: deps.userState, ...(deps.managerViewLookup ? { managerView: deps.managerViewLookup } : {}) });
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
      if (deps.about) await registerAboutRoutes(api, { release: deps.about.release, guard });
      // Register multipart ONCE for the whole API (task/chat attachments + avatar/project images use req.file()).
      if (deps.attachmentService || deps.chatService || deps.chatAttachmentStorage || deps.companyService /* companies: logos */ || deps.portal /* 1.23.7: client uploads */) {
        await api.register(multipart, { limits: { fileSize: deps.attachmentMaxSizeBytes ?? 10 * 1024 * 1024, files: 1 } });
      }
      // Per-project authorization (T2.7). Defaults to admin-only when no manager lookup is wired.
      const projectAuthz =
        deps.projectAuthz ??
        createProjectAuthz({
          managers: { async managesProject() { return false; }, async projectIdOfColumn() { return null; }, async projectIdOfTask() { return null; } },
        });
      // Object-level view authorization (undefined ⇒ endpoints stay open, e.g. in unit tests).
      const access = deps.projectAccess;
      const canViewTask = access ? (u: string, r: string[], t: string) => access.canViewTask(u, r, t) : undefined;
      const canViewProject = access ? (u: string, r: string[], p: string) => access.canViewProject(u, r, p) : undefined;
      // companies: routes pass the request's pick, `deps.accessibleProjectIds(u, r, await pickOf(req))` (from MC1 Task 8).
      const accessibleProjectIds = access ? (u: string, r: string[], pick?: string | null) => access.accessibleProjectIds(u, r, pick) : undefined;
      // 1.22 (owner, 4 Nov): the person's OWN tasks are listed from here — "Show my projects only" never narrows them.
      const ownProjectIds = access?.ownProjectIds ? (u: string, r: string[], pick: string | null) => access.ownProjectIds!(u, r, pick) : undefined;
      // 1.22.3 review: the projects whose tasks a person may open — the object check canViewTask makes
      // (no pick: an administrator's every one, null; "Show my projects only" not applied). A task's
      // number shown as a chip that opens it (a notice, a meeting note, an action item) only for these.
      const openableProjectIds = access ? (u: string, r: string[]) => access.accessibleProjectIds(u, r) : undefined;
      const mAccess = deps.meetingAccess;
      // companies (MC1 Task 10): someone invited from outside a project's companies has the invitee view
      // of that one meeting. The meeting routes get the full-view check, which refuses an invitee with
      // 403 INVITEE_ONLY, and `viewOf` where the invitee view is served (the meeting, its people and
      // agenda, approved minutes, their own action items and answer). Elsewhere (a task's meeting link,
      // its PDF) an invitee simply has no full view.
      const meetingViewOf = mAccess?.viewOf ? (u: string, r: string[], m: string) => mAccess.viewOf(u, r, m) : undefined;
      const canViewMeetingQuietly = mAccess ? (u: string, r: string[], m: string) => mAccess.canViewMeeting(u, r, m) : undefined;
      const canViewMeeting = meetingViewOf ? fullViewOrInviteeRefusal(meetingViewOf) : canViewMeetingQuietly;
      const meetingTargetOf = deps.meetingService ? async (meetingId: string) => inviteTargetOf(await deps.meetingService!.getMeeting(meetingId)) : undefined;
      const knownIds = deps.companyAccess
        ? async (viewer: { id: string; roles: string[] }, ids: string[]) => (await keepKnownPeople(deps.companyAccess!, viewer, ids.map((id) => ({ id })))).map((p) => p.id)
        : undefined;
      // companies: the request's picked company (X-Company-Id), checked once per request; it narrows
      // `list` routes only (see modules/companies/route-classes.ts). Without the module: no pick.
      const pickOf: PickOf = deps.companyAccess ? createPickResolver(deps.companyAccess) : NO_PICK;
      const meetingAccessibleProjectIds = mAccess ? (u: string, r: string[], pick?: string | null) => mAccess.accessibleProjectIds(u, r, pick) : undefined;
      // companies: a company's active people (an administrator's Workload and Reports with a pick show them).
      const companies = deps.companyAccess;
      // 1.22 "Show my projects only": does this administrator list like a team member? (Lists that have
      // their own "administrators see everything" branch ask it; the project scope itself is in
      // projectAccess.accessibleProjectIds — a call naming the pick is a list.)
      const myProjectsOnly = companies ? (viewer: { id: string; roles: string[] }) => companies.myProjectsOnly(viewer) : undefined;
      const companyPeople = companies ? (companyId: string) => companies.projectCompanyPeople([companyId]) : undefined;
      // companies: a person's active companies, and who a search may find (colleagues, the viewer too;
      // with a pick that company's people; an administrator without a pick everyone: null).
      const companiesOf = companies ? (userId: string) => companies.activeCompanyIds(userId) : undefined;
      const searchPeople = companies
        ? async (viewer: { id: string; roles: string[] }, pick: string | null): Promise<ReadonlySet<string> | null> => {
            if (pick) return new Set(await companies.projectCompanyPeople([pick]));
            const known = await companies.knownPeople(viewer);
            if (known === 'everyone') return null;
            return new Set([viewer.id, ...[...known].filter(([, k]) => k.colleague).map(([id]) => id)]);
          }
        : undefined;
      // companies: a cross-project PDF's brand — the one project's main company, else the picked
      // company, else the reader's primary one (MC1 Task 14). A pick that can't be used only drops the brand.
      const brands = deps.pdfBranding;
      const scopeBrand = brands
        ? async (req: FastifyRequest, projectId: string | null = null) =>
            projectId ? brands.project(projectId) : brands.scope({ id: req.user!.id, roles: req.user!.roles ?? [] }, await pickOf(req).catch(() => null))
        : undefined;
      // 1.22: an archived project is read-only on the server too — each write route about one of its
      // tasks, comments, files, checklists or meetings answers 409 PROJECT_ARCHIVED (companies/archive-guard.ts).
      // Installed before the routes that need it; it answers only for what the person may see.
      if (deps.archiveLookup) {
        installArchiveGuard(
          api,
          createArchiveGuard({
            lookup: deps.archiveLookup,
            canSeeProject: canViewProject ?? (async () => true),
            canSeeMeeting: meetingViewOf ? async (u, r, m) => (await meetingViewOf(u, r, m)) !== null : (canViewMeetingQuietly ?? (async () => true)),
          }),
          '/api/v1',
        );
      }
      // 1.23.1: a merged task's id (an old link, a notice, the phone app) reads as its main task; a change
      // sent to it is refused. Installed before the routes, like the archive guard.
      if (deps.taskMergeService) {
        const merges = deps.taskMergeService;
        installMergedTaskRedirect(
          api,
          {
            resolve: (id) => merges.resolveMerged(id),
            canViewTask,
            keyOf: deps.taskService ? async (id) => (await deps.taskService!.getTask(id).catch(() => null))?.key ?? null : undefined,
          },
          '/api/v1',
        );
      }
      if (deps.projectService) {
        await registerProjectRoutes(api, {
          projectService: deps.projectService,
          guard,
          // Manager View: an administrator's "may change it" — the projects they run.
          managerView: deps.managerViewLookup,
          listProjectTasks: deps.taskService ? (projectId) => deps.taskService!.listTasks({ projectId }) : undefined,
          timeZone: deps.appConfig?.timeZone,
          overview: deps.projectOverview,
          audit: deps.auditService,
          storage: deps.chatAttachmentStorage,
          imageMaxBytes: deps.attachmentMaxSizeBytes,
          authz: projectAuthz,
          notices: deps.projectNotices,
          // companies: its companies in the payload, the picked company as a new project's default.
          companies: deps.projectCompanies,
          pickOf,
          activity: deps.activityService,
          onAudienceChanged: deps.onProjectAudienceChanged,
          // 1.23.5: the cards' health; a project edit (its completion mode, dates, owner) reads it again.
          health: deps.projectHealth,
        });
      }
      if (deps.projectHealth && canViewProject) {
        // 1.23.5 Project overview & health: staff only (client sessions are refused by the guard's route table).
        const activity = deps.activityService;
        await registerHealthRoutes(api, {
          guard,
          health: deps.projectHealth,
          canViewProject,
          recentActivity: activity ? (projectId, limit) => activity.listRecent(limit, [projectId]) : undefined,
          canViewTask,
        });
      }
      if (deps.projectService && (deps.timelineSource || deps.workloadStore)) {
        await registerPlanningRoutes(api, {
          guard,
          projectService: deps.projectService,
          timeline: deps.timelineSource,
          workload: deps.workloadStore,
          settings: deps.settingsService,
          // companies: the Workload's days off — the shown project's company, else the pick's, else the reader's (MC1 Task 15).
          workingHoursFor: deps.companyTime
            ? async (req, projectId) => deps.companyTime!.hoursFor({ projectId, viewer: { id: req.user!.id, roles: req.user!.roles ?? [] }, pick: await pickOf(req).catch(() => null) })
            : undefined,
          timeZone: deps.appConfig?.timeZone ?? defaultCompanyTimeZone(),
          now: deps.planningNow,
          pickOf, // companies: Timeline and Workload follow the pick
          companyPeople,
          myProjectsOnly,
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
          // The same meeting check as the task's details (GET /tasks/:id).
          canViewMeeting: deps.taskMeeting?.canView ?? canViewMeetingQuietly,
          userName: deps.reportNames ? (id) => deps.reportNames!.user(id) : undefined,
          timeZone: deps.appConfig?.timeZone ?? 'Asia/Muscat',
          readAttachment: deps.readAttachment,
          pictureThumbnail: deps.pictureThumbnail,
          readProjectImage: deps.readProjectImage,
          printableProjectImage: deps.printableProjectImage,
          // companies: the task's project's company on its PDF (MC1 Task 14).
          pdfBrand: brands ? (taskId) => brands.task(taskId) : undefined,
        });
      }
      if (deps.memberService) {
        await registerMemberRoutes(api, { memberService: deps.memberService, authz: projectAuthz, guard, audit: deps.auditService, canViewProject, notices: deps.projectNotices });
      }
      if (deps.taskService) {
        await registerTaskRoutes(api, {
          taskService: deps.taskService,
          guard,
          broadcast: deps.onTaskEvent,
          canDeleteTask: (userId, roles, taskId) => projectAuthz.canManageTask(userId, roles, taskId),
          canViewTask,
          accessibleProjectIds,
          ownProjectIds, // 1.22: My Tasks and the caller's own tasks on the calendar
          pickOf, // companies: the task lists and the calendar follow the pick
          tagService: deps.tagService,
          assigneeService: deps.assigneeService,
          carryForwardService: deps.carryForwardService,
          countSeries: deps.seriesInstanceCount,
          taskMeeting: deps.taskMeeting ?? taskMeetingFrom(deps),
          taskInspectionForm: deps.taskInspectionForm,
          taskApproval: deps.taskApprovalDetails,
          // 1.23.1: the tasks merged into a task (its "Merged from" panel opens from them).
          mergedFrom: deps.taskMergeService ? (id) => deps.taskMergeService!.mergedInto(id) : undefined,
          // Duplicate Task: "Duplicated from MSSP-34" and "Copies: …" (only those the reader may open).
          duplicateLinks: deps.duplicateLinks,
          checklistDue: deps.checklistDue,
          projectOwnerOf: deps.projectService
            ? async (projectId) => (await deps.projectService!.getProject(projectId)).ownerId
            : undefined,
        });
      }
      if (deps.taskService && deps.approvalSource) {
        await registerTaskApprovalRoutes(api, {
          taskService: deps.taskService,
          source: deps.approvalSource,
          guard,
          broadcast: deps.onTaskEvent,
          canViewTask,
          audit: deps.auditService,
          logger: deps.logger,
          accessibleProjectIds, // companies: the To approve list follows the pick
          pickOf,
        });
      }
      if (deps.dashboardPriorities || deps.dashboardLayouts) {
        // 1.23.4 Smarter Dashboard: staff only (client sessions are refused by the guard's route table).
        const approvals = deps.approvalSource;
        await registerDashboardRoutes(api, {
          guard,
          priorities: deps.dashboardPriorities,
          layouts: deps.dashboardLayouts,
          canApprove: approvals ? (viewer) => approvals.canApproveAny(viewer) : undefined,
          pickOf, // companies: the priorities follow the pick
          audit: deps.auditService,
          logger: deps.logger,
        });
      }
      if (deps.taskMoveService) {
        await registerTaskMoveRoutes(api, { service: deps.taskMoveService, guard, broadcast: deps.onTaskEvent, canViewTask, audit: deps.auditService, logger: deps.logger });
      }
      if (deps.taskMergeService) {
        await registerTaskMergeRoutes(api, { service: deps.taskMergeService, guard, broadcast: deps.onTaskEvent, canViewTask, audit: deps.auditService, logger: deps.logger });
      }
      if (deps.taskDuplicateService) {
        // Duplicate Task: staff only (client sessions are refused by the guard's route table).
        await registerTaskDuplicateRoutes(api, { service: deps.taskDuplicateService, guard, ...(deps.duplicatesPerMinute ? { perMinute: deps.duplicatesPerMinute } : {}) });
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
          recordActivity: deps.recordTaskActivity,
          onItemAssigned: deps.onChecklistItemAssigned,
          namesOf: deps.namesOfUsers,
          myItems: deps.checklistMine,
          ownProjectIds,
          pickOf,
        });
      }
      if (deps.externalContactService) {
        await registerExternalContactRoutes(api, {
          service: deps.externalContactService,
          guard,
          canViewTask,
          // The task's own edit rule (as PUT /tasks/:id): whoever can see the task may change it.
          canEditTask: canViewTask,
          canViewProject,
          broadcast: deps.onTaskEvent,
          taskOf: deps.taskService ? (taskId) => deps.taskService!.getTask(taskId) : undefined,
          recordActivity: deps.recordTaskActivity,
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
          recordActivity: deps.recordTaskActivity,
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
          shrinkImage: deps.shrinkImage,
          accessibleProjectIds, // companies: with a pick, the conversation list and chat search keep only its projects' channels
          pickOf,
        });
      }
      if (deps.attachmentService) {
        await registerAttachmentRoutes(api, {
          attachmentService: deps.attachmentService,
          guard,
          maxSizeBytes: deps.attachmentMaxSizeBytes ?? 10 * 1024 * 1024,
          canViewTask,
          recordActivity: deps.recordTaskActivity,
          // 1.23.7 "Show to client" on a file: who runs the task's project (or an administrator), as for the task.
          ...(deps.taskService
            ? {
                canManageTask: async (u: string, r: string[], taskId: string) => {
                  const t = await deps.taskService!.getTask(taskId).catch(() => null);
                  return t ? projectAuthz.canManageProject(u, r, t.projectId) : false;
                },
              }
            : {}),
          onShownToClient: deps.onFileShownToClient,
          audit: deps.auditService,
        });
      }
      if (deps.dependencyService) {
        await registerDependencyRoutes(api, { dependencyService: deps.dependencyService, guard, canViewTask, recordActivity: deps.recordTaskActivity });
      }
      if (deps.userPreferences) {
        // A static path, so /users/me/preferences is never read as the admin route /users/:id.
        await registerPreferenceRoutes(api, { repo: deps.userPreferences, guard });
      }
      if (deps.managerViewStore) {
        // Manager View's switch: a static path too (never the admin route /users/:id), and never refused by it.
        await registerManagerViewRoutes(api, { store: deps.managerViewStore, guard, audit: deps.auditService });
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
          welcome: deps.welcomeService,
          // Onboarding: the duplicate check, "Send password reset", "Mark email as verified".
          identityLookup: deps.identityLookup,
          adminPasswordReset: deps.adminPasswordReset,
          verification: deps.emailVerification,
          invitationDays: deps.invitationDays,
          // companies: people's companies, and the picked company as a new person's default.
          membership: deps.companyMembership,
          pickOf,
          // companies: the directory lists the people the caller knows (MC1 Task 9).
          knownPeople: deps.companyAccess ? (viewer) => deps.companyAccess!.knownPeople(viewer) : undefined,
        });
      }
      if (deps.notificationService) {
        // companies: the bell follows the person's projects and the pick.
        // companies: the bell hides notices about projects outside the person's active companies (and the
        // pick); the team rule stays as in 1.20 (an assignee off the team keeps their task's notices).
        const companies = deps.companyAccess;
        const noticeScope = companies ? (u: string, r: string[], pick?: string | null) => companies.companyProjectIds({ id: u, roles: r }, pick ?? null) : accessibleProjectIds;
        // 1.22.3 review: …but a task notice names the task's number now only when the reader may open the task.
        await registerNotificationRoutes(api, { notificationService: deps.notificationService, guard, accessibleProjectIds: noticeScope, pickOf, visibleProjectIds: openableProjectIds });
      }
      if (deps.dailyEmails) {
        await registerDailyEmailRoutes(api, { ...deps.dailyEmails, guard, audit: deps.auditService });
      }
      if (deps.deviceTokenService) {
        await registerDeviceTokenRoutes(api, { deviceTokenService: deps.deviceTokenService, guard });
      }
      if (deps.reportService) {
        // companies: every report and export follows the pick; its PDFs carry the scope's brand.
        await registerReportRoutes(api, { reportService: deps.reportService, guard, names: deps.reportNames, pickOf, accessibleProjectIds, companyPeople, pdfBrand: scopeBrand, myProjectsOnly });
      }
      if (deps.searchService) {
        // companies: both searches follow the pick; people are colleagues (with a pick, that company's).
        await registerSearchRoutes(api, { searchService: deps.searchService, guard, accessibleProjectIds, taskSearch: deps.taskSearch, pickOf, peopleFor: searchPeople, companiesOf, myProjectsOnly, everything: deps.searchEverything, savedSearches: deps.savedSearches, logger: deps.logger, ...(deps.searchPerMinute ? { perMinute: deps.searchPerMinute } : {}) });
      }
      if (deps.meetingService) {
        await registerMeetingRoutes(api, {
          meetingService: deps.meetingService, guard, broadcast: deps.onTaskEvent, canViewMeeting, accessibleProjectIds: meetingAccessibleProjectIds, notify: deps.meetingNotifyService, logger: deps.logger, listCounts: deps.meetingListCounts, series: deps.meetingSeriesService, projectMeetings: deps.projectMeetings, freeTimes: deps.meetingFreeTimes, attendeeService: deps.attendeeService, agendaService: deps.agendaService, isActiveUser: deps.isActiveUser,
          // companies (MC1 Task 10): the invitee view, a standalone meeting's company, who may be invited.
          viewOf: meetingViewOf, pickOf, meetingCompany: deps.meetingCompany, invitees: deps.meetingInvitees, knownIds, myProjectsOnly,
          namedSeries: deps.namedSeriesService, // 1.23: "New meeting in this series", the list's series names
          teams: deps.meetingTeams, // 1.23: automatic Teams links
        });
      }
      if (deps.namedSeriesService) {
        await registerNamedSeriesRoutes(api, { service: deps.namedSeriesService, guard });
      }
      if (deps.attendeeService) {
        // companies: the roster names the meeting's people (organizer first) for whoever may see it.
        const options = deps.personOptions;
        const meetings = deps.meetingService;
        const meetingPeople = options
          ? async (meetingId: string, attendeeUserIds: string[]) => {
              const organizerId = meetings ? (await meetings.getMeeting(meetingId).catch(() => null))?.organizerId : undefined;
              const ids = [...new Set([...(organizerId ? [organizerId] : []), ...attendeeUserIds])];
              const byId = new Map((await options(ids)).map((p) => [p.id, p]));
              return ids.flatMap((pid) => {
                const p = byId.get(pid);
                return p ? [{ id: pid, name: `${p.firstName} ${p.lastName}`.trim() || p.username, avatarUrl: p.avatarUrl, ...(p.client ? { client: true } : {}) }] : [];
              });
            }
          : undefined;
        await registerAttendeeRoutes(api, { attendeeService: deps.attendeeService, guard, canViewMeeting, viewOf: meetingViewOf, invitees: deps.meetingInvitees, inviteTargetOf: meetingTargetOf, peopleOf: meetingPeople });
      }
      if (deps.agendaService) {
        await registerAgendaRoutes(api, { agendaService: deps.agendaService, guard, canViewMeeting, viewOf: meetingViewOf });
      }
      if (deps.actionItemService) {
        // companies: an assignee / creator keeps their own item while its meeting is theirs to reach.
        const companyRules = deps.companyAccess;
        const meetings = deps.meetingService;
        const ownItemOpen =
          companyRules && meetings
            ? async (userId: string, roles: string[], meetingId: string): Promise<boolean> => {
                if (meetingViewOf && (await meetingViewOf(userId, roles, meetingId)) !== null) return true;
                const m = await meetings.getMeeting(meetingId).catch(() => null);
                if (!m) return false;
                if (m.projectId) return ((await companyRules.companyProjectIds({ id: userId, roles }, null)) ?? [m.projectId]).includes(m.projectId);
                const companyId = (m as { companyId?: string | null }).companyId ?? null;
                return !companyId || (await companyRules.activeCompanyIds(userId)).includes(companyId);
              }
            : undefined;
        await registerActionItemRoutes(api, {
          ownItemOpen,
          actionItemService: deps.actionItemService,
          guard,
          canViewMeeting,
          viewOf: meetingViewOf,
          resolveMeetingProjectId: deps.resolveMeetingProjectId,
          resolveTaskKeys: deps.resolveTaskKeys,
          visibleProjectIds: openableProjectIds, // 1.22.3 review: a linked task's number only for a reader who may open it
          pickOf, // companies: My Action Items follows the pick (1.22: "Show my projects only" doesn't narrow it — owner, 4 Nov)
        });
      }
      if (deps.noteService) {
        await registerNoteRoutes(api, {
          noteService: deps.noteService,
          guard,
          canViewMeeting,
          noteTaskService: deps.noteTaskService,
          accessibleProjectIds,
          resolveTaskKeys: deps.resolveTaskKeys,
        });
      }
      if (deps.meetingService && deps.attendeeService && deps.agendaService && deps.noteService && deps.resolveUserNames) {
        await registerMinutesRoutes(api, {
          meetingService: deps.meetingService,
          attendeeService: deps.attendeeService,
          agendaService: deps.agendaService,
          noteService: deps.noteService,
          actionItemService: deps.actionItemService,
          guard,
          canViewMeeting,
          resolveUserNames: deps.resolveUserNames,
          resolveProject: deps.resolveProject,
          readProjectImage: deps.readProjectImage,
          printableProjectImage: deps.printableProjectImage,
          finalMinutes: deps.finalMinutesRepository,
          draftMinutesWithAi: deps.draftMinutesWithAi,
          finalMinutesAi: deps.finalMinutesAi,
          onFinalMinutesChanged: deps.onFinalMinutesChanged,
          resolveTaskKeys: deps.resolveTaskKeys,
          notify: deps.meetingNotifyService,
          viewOf: meetingViewOf,
          // companies: the minutes email asks each of the meeting's users' view with their current roles.
          rolesOf: deps.userState ? async (userId: string) => (await deps.userState!(userId))?.roles ?? [] : undefined,
          clientMinutes: deps.clientMinutes,
          // companies: the meeting's company on its minutes PDF (MC1 Task 14).
          pdfBrand: brands ? (meetingId) => brands.meeting(meetingId) : undefined,
          // 1.22: the minutes email's To and Cc — its "Sent" log, the audit log, and who may be picked or added.
          minutesSends: deps.minutesSendRepository,
          audit: deps.auditService,
          recipientViewOf: mAccess?.recipientViewOf ? (u, r, m) => mAccess.recipientViewOf(u, r, m) : undefined,
          invitees: deps.meetingInvitees,
          inviteTargetOf: meetingTargetOf,
          // 1.22 review: a typed address shows its owner's name only to a colleague of theirs.
          isColleague: companies ? (viewer, otherId) => companies.isColleague(viewer, otherId) : undefined,
          // 1.23: "Series: …" and "Open from earlier meetings" in the minutes.
          seriesFacts: deps.namedSeriesService ? (meeting, who) => deps.namedSeriesService!.minutesSeries(meeting, who) : undefined,
        });
      }
      if (deps.activityService) {
        await registerActivityRoutes(api, { activityService: deps.activityService, guard, canViewTask, accessibleProjectIds, pickOf, timeZone: deps.appConfig?.timeZone ?? defaultCompanyTimeZone() });
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
        await registerAiFeatureRoutes(api, { aiFeatureService: deps.aiFeatureService, guard, agendaSources: deps.meetingAgendaSources, userNames: deps.resolveUserNames, pickOf });
      }
      if (deps.micoAiService) {
        await registerMicoAiRoutes(api, { micoAiService: deps.micoAiService, guard, pickOf, pdfBrand: scopeBrand }); // companies: asking follows the pick; pdfBrand
      }
      if (deps.emailWebhookService) {
        await registerEmailWebhookRoutes(api, { emailWebhookService: deps.emailWebhookService, token: deps.mailjetWebhookToken });
      }
      if (deps.templateService) {
        await registerTemplateRoutes(api, { templateService: deps.templateService, guard, projectService: deps.projectService, audit: deps.auditService, notices: deps.projectNotices, pickOf, companies: deps.projectCompanies });
      }
      if (deps.clientView) {
        await registerClientViewRoutes(api, {
          ...deps.clientView,
          guard,
          // Without object-level access wired, only administrators can see (and so share) a project.
          canViewProject: canViewProject ?? (async (_u, roles) => roles.includes('ADMIN')),
          canManageProject: (u, r, p) => projectAuthz.canManageProject(u, r, p),
          canViewTask,
          canViewMeeting,
          recordActivity: deps.recordTaskActivity,
          audit: deps.auditService,
          broadcast: deps.onTaskEvent,
          onMinutesChanged: deps.onFinalMinutesChanged,
        });
      }
      if (deps.management) {
        await registerManagementRoutes(api, { ...deps.management, guard, pickOf, pdfBrand: scopeBrand }); // companies: follows the pick; pdfBrand
      }
      if (deps.inspections) {
        // companies: a form's usage counts follow the person's projects and the pick.
        await registerInspectionRoutes(api, { ...deps.inspections, guard, broadcast: deps.onTaskEvent, accessibleProjectIds, pickOf });
      }
      if (deps.backups) {
        await registerBackupRoutes(api, { ...deps.backups, guard, audit: deps.auditService });
      }
      // 1.23 Client accounts and the Client portal.
      if (deps.clientAccounts) {
        await registerClientAccountRoutes(api, {
          accounts: deps.clientAccounts,
          guard,
          welcome: deps.welcomeService,
          canViewProject: canViewProject ?? (async (_u, roles) => roles.includes('ADMIN')),
          audit: deps.auditService,
          invitationDays: deps.invitationDays,
          // 1.23.7 Preview as client: the portal's own reads, for administrators.
          ...(deps.portal ? { portal: deps.portal } : {}),
        });
      }
      if (deps.portal) await registerPortalRoutes(api, { service: deps.portal, guard, pdfsPerMinute: deps.portalPdfsPerMinute });
      // 1.23: Settings → Microsoft Teams and Make Teams link (staff only; the meeting's own view and edit rules).
      if (deps.microsoft) {
        await registerMicrosoftRoutes(api, { ...deps.microsoft, canViewMeeting: deps.microsoft.canViewMeeting ?? canViewMeetingQuietly, guard, audit: deps.auditService });
      }
      // companies: the Companies admin API and GET /me/companies.
      if (deps.companyService) {
        await registerCompanyRoutes(api, { service: deps.companyService, guard });
      }
      // 1.22.4: the Error log — browsers' reports (any page, signed in or not) and its admin page.
      if (deps.errorLog) {
        await registerErrorLogRoutes(api, { service: deps.errorLog, guard, userIdOf, audit: deps.auditService, databaseCheck: deps.databaseCheck });
      }
      // companies: people for pickers inside projects — GET /people/candidates (MC1 Task 9).
      if (deps.companyAccess && deps.personOptions) {
        await registerPeopleRoutes(api, {
          guard,
          companyAccess: deps.companyAccess,
          personOptions: deps.personOptions,
          canManageProject: (u, r, p) => projectAuthz.canManageProject(u, r, p),
          projectCompanyIds: deps.projectCompanyIds,
        });
      }
    },
    { prefix: '/api/v1' },
  );

  return app;
}

/** The meeting lookup for task details, from the meeting service and meeting access when both are wired. */
function taskMeetingFrom(deps: AppDeps): TaskMeetingLookup | undefined {
  const { meetingService, meetingAccess } = deps;
  if (!meetingService || !meetingAccess) return undefined;
  return {
    async summary(meetingId) {
      try {
        const meeting = await meetingService.getMeeting(meetingId);
        return { id: meeting.id, title: meeting.title, startAt: meeting.startAt };
      } catch (err) {
        // A deleted (or missing) meeting leaves no link.
        if (err instanceof NotFoundError) return null;
        throw err;
      }
    },
    canView: (userId, roles, meetingId) => meetingAccess.canViewMeeting(userId, roles, meetingId),
  };
}
