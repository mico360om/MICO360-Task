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
  const userService = createUserService({ users: createPrismaUserMgmtRepository(prisma) });

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
