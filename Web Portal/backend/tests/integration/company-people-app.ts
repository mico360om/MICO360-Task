import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { createTokenService } from '../../src/modules/auth/token-service';
import { createAuthService } from '../../src/modules/auth/auth-service';
import { createPrismaPeopleLookup, createPrismaProjectRepository } from '../../src/modules/projects/prisma-project-repository';
import { createProjectService } from '../../src/modules/projects/project-service';
import { createPrismaMemberRepository, createPrismaProjectExistsLookup, createPrismaProjectManagerLookup } from '../../src/modules/projects/prisma-member-repository';
import { createProjectAccess } from '../../src/modules/projects/project-access';
import { createProjectAuthz } from '../../src/modules/projects/project-authz';
import { createMemberService } from '../../src/modules/projects/member-service';
import { createCompanyAccess } from '../../src/modules/companies/company-access';
import { createPrismaPersonOptions } from '../../src/modules/companies/person-options';
import { createTaskService } from '../../src/modules/tasks/task-service';
import { createPrismaProjectLookup, createPrismaTaskRepository } from '../../src/modules/tasks/prisma-task-repository';
import { createCommentService } from '../../src/modules/tasks/comment-service';
import { createPrismaCommentRepository } from '../../src/modules/tasks/prisma-comment-repository';
import { createPrismaTaskLookup } from '../../src/modules/tasks/prisma-assignee-repository';
import { createTaskMoveService } from '../../src/modules/tasks/task-move-service';
import { createPrismaTaskMoveRepository } from '../../src/modules/tasks/prisma-task-move-repository';
import { createMessageService } from '../../src/modules/chat/message-service';
import {
  createPrismaChatAttachmentRepository,
  createPrismaChatMemberLookup,
  createPrismaConversationRepository,
  createPrismaMessageRepository,
  createPrismaParticipantRepository,
  createPrismaReactionRepository,
} from '../../src/modules/chat/prisma-chat-repository';
import { createUserService } from '../../src/modules/users/user-service';
import { createPrismaUserRepository as createPrismaUserMgmtRepository } from '../../src/modules/users/prisma-user-repository';
import type { Viewer } from '../../src/modules/companies/company-access';
import { fallbackProjectCompanyId } from '../../src/modules/companies/company-access';
import { createPrismaMeetingRepository } from '../../src/modules/meetings/prisma-meeting-repository';
import { createMeetingService } from '../../src/modules/meetings/meeting-service';
import { createMeetingAccess } from '../../src/modules/meetings/meeting-access';
import { createMeetingSeriesService } from '../../src/modules/meetings/meeting-series-service';
import { createPrismaAttendeeRepository } from '../../src/modules/meetings/prisma-attendee-repository';
import { createAttendeeService } from '../../src/modules/meetings/attendee-service';
import { createPrismaAgendaRepository } from '../../src/modules/meetings/prisma-agenda-repository';
import { createAgendaService } from '../../src/modules/meetings/agenda-service';
import { createPrismaNoteRepository } from '../../src/modules/meetings/prisma-note-repository';
import { createNoteService } from '../../src/modules/meetings/note-service';
import { createActionItemService } from '../../src/modules/meetings/action-item-service';
import { createPrismaActionItemRepository } from '../../src/modules/meetings/prisma-action-item-repository';
import { createPrismaFinalMinutesRepository } from '../../src/modules/meetings/final-minutes-repository';
import { createPrismaProjectMeetingsSource } from '../../src/modules/meetings/prisma-project-meetings';
import { createPrismaMeetingInvitees } from '../../src/modules/meetings/meeting-invitees';
import { createMeetingCompanyRule } from '../../src/modules/meetings/meeting-company';

/**
 * The people and meetings parts of the server, wired from real Prisma services as server.ts wires
 * them (companies: MC1 Tasks 9–10), behind buildApp — so the DB tests ask over HTTP, as a browser does.
 */
export async function buildPeopleApp(prisma: PrismaClient) {
  const tokenService = createTokenService({
    accessSecret: 'people-access',
    refreshSecret: 'people-refresh',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const projectRepository = createPrismaProjectRepository(prisma);
  const peopleLookup = createPrismaPeopleLookup(prisma);
  const managers = createPrismaProjectManagerLookup(prisma);
  const companyAccess = createCompanyAccess(prisma);
  const projectService = createProjectService({ projects: projectRepository, people: peopleLookup });
  const projectAccess = createProjectAccess({ projects: projectRepository, managers });
  const projectAuthz = createProjectAuthz({ managers });
  const memberService = createMemberService({
    repo: createPrismaMemberRepository(prisma),
    projects: createPrismaProjectExistsLookup(prisma),
    people: peopleLookup,
    whoCanSee: (projectId, userIds) => companyAccess.whoCanSeeProject(projectId, userIds),
  });
  const taskService = createTaskService({ tasks: createPrismaTaskRepository(prisma), projects: createPrismaProjectLookup(prisma) });
  const commentService = createCommentService({ repo: createPrismaCommentRepository(prisma), taskLookup: createPrismaTaskLookup(prisma) });
  const taskMoveService = createTaskMoveService({ repo: createPrismaTaskMoveRepository(prisma) });
  const chatService = createMessageService({
    conversations: createPrismaConversationRepository(prisma),
    participants: createPrismaParticipantRepository(prisma),
    messages: createPrismaMessageRepository(prisma),
    reactions: createPrismaReactionRepository(prisma),
    attachments: createPrismaChatAttachmentRepository(prisma),
    members: createPrismaChatMemberLookup(prisma),
  });
  const userMgmt = createPrismaUserMgmtRepository(prisma);
  const userService = createUserService({ users: userMgmt });

  // Meetings, as server.ts wires them (companies: the invitee view, a company for standalone meetings).
  const tz = 'Asia/Muscat';
  const meetingRepository = createPrismaMeetingRepository(prisma);
  const isActiveUser = async (userId: string) => (await prisma.user.count({ where: { id: userId, deletedAt: null, status: 'ACTIVE' } })) > 0;
  const meetingAccess = createMeetingAccess({
    meetings: meetingRepository,
    projectAccess: {
      canViewProject: (userId, roles, projectId) => projectAccess.canViewProject(userId, roles, projectId),
      accessibleProjectIds: (userId, roles) => projectAccess.accessibleProjectIds(userId, roles),
      canManageProject: (userId, roles, projectId) => projectAuthz.canManageProject(userId, roles, projectId),
    },
    meetingView: (viewer, m) => companyAccess.meetingView(viewer, m),
  });
  const canEditMeeting = (userId: string, roles: string[], meetingId: string) => meetingAccess.canEditMeeting(userId, roles, meetingId);
  const meetingService = createMeetingService({ meetings: meetingRepository, access: meetingAccess, defaultTimeZone: tz, isActiveUser });
  const attendeeRepository = createPrismaAttendeeRepository(prisma);
  const meetingSeriesService = createMeetingSeriesService({ meetings: meetingRepository, attendees: attendeeRepository, defaultTimeZone: tz });
  const attendeeService = createAttendeeService({ attendees: attendeeRepository, canEditMeeting });
  const agendaService = createAgendaService({ agenda: createPrismaAgendaRepository(prisma), canEditMeeting });
  const noteService = createNoteService({ notes: createPrismaNoteRepository(prisma), canEditMeeting });
  const actionItemService = createActionItemService({ actionItems: createPrismaActionItemRepository(prisma), timeZone: tz, canEditMeeting });
  const resolveUserNames = async (ids: string[]) => {
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, username: true } });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.username]));
  };
  const resolveProject = async (projectId: string) => {
    const p = await projectRepository.findById(projectId).catch(() => null);
    return p ? { name: p.name, code: p.code, number: p.number, color: p.color, icon: p.icon, imageUrl: p.imageUrl, clientName: p.clientName, status: p.status, ownerId: p.ownerId, startDate: p.startDate ? p.startDate.toISOString() : null, targetDate: p.targetDate ? p.targetDate.toISOString() : null } : null;
  };
  const personOptions = createPrismaPersonOptions(prisma);
  const app: FastifyInstance = await buildApp({
    authService,
    tokenService,
    projectService,
    projectAccess,
    projectAuthz,
    companyAccess,
    personOptions,
    memberService,
    taskService,
    commentService,
    taskMoveService,
    chatService,
    userService,
    meetingService,
    meetingSeriesService,
    meetingAccess,
    attendeeService,
    agendaService,
    noteService,
    actionItemService,
    resolveUserNames,
    resolveProject,
    resolveMeetingProjectId: async (meetingId) => (await meetingRepository.accessCore(meetingId))?.projectId ?? null,
    finalMinutesRepository: createPrismaFinalMinutesRepository(prisma),
    projectMeetings: { load: createPrismaProjectMeetingsSource(prisma).load, timeZone: tz },
    meetingFreeTimes: { busy: meetingRepository, workingHours: async () => ({ days: [0, 1, 2, 3, 4], start: '08:00', end: '17:00' }), userNames: resolveUserNames, timeZone: tz },
    isActiveUser,
    meetingInvitees: createPrismaMeetingInvitees(prisma, { companyAccess, personOptions }),
    meetingCompany: createMeetingCompanyRule({ checkPick: (viewer, id) => companyAccess.checkPick(viewer, id), fallbackCompanyId: (organizerId) => fallbackProjectCompanyId(prisma, organizerId) }),
  });

  type Answer = { status: number; data: any; error: any; body: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  async function call(viewer: Viewer, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
    const authorization = `Bearer ${tokenService.issueAccessToken({ id: viewer.id, roles: viewer.roles })}`;
    const res = await app.inject({ method, url: `/api/v1${url}`, headers: { authorization, ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    let json: { data?: unknown; error?: unknown } = {};
    try {
      json = res.json();
    } catch {
      /* not JSON (a PDF, an empty 204) */
    }
    return { status: res.statusCode, data: json.data, error: json.error, body: res.body };
  }
  return {
    app,
    tokenFor: (viewer: Viewer) => tokenService.issueAccessToken({ id: viewer.id, roles: viewer.roles }),
    companyAccess,
    chat: chatService,
    move: taskMoveService,
    get: (viewer: Viewer, url: string, headers?: Record<string, string>) => call(viewer, 'GET', url, undefined, headers),
    post: (viewer: Viewer, url: string, payload: unknown = {}, headers?: Record<string, string>) => call(viewer, 'POST', url, payload, headers),
    put: (viewer: Viewer, url: string, payload: unknown = {}) => call(viewer, 'PUT', url, payload),
    patch: (viewer: Viewer, url: string, payload: unknown = {}) => call(viewer, 'PATCH', url, payload),
    del: (viewer: Viewer, url: string) => call(viewer, 'DELETE', url),
    close: () => app.close(),
  };
}
