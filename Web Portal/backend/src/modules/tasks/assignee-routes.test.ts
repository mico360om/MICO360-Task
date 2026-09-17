import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createAssigneeService } from './assignee-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { AssigneeRepository, AssigneeUser, TaskLookup } from './assignee-repository';
import type { TaskService } from './task-service';

function inMemory() {
  const links = new Set<string>();
  const users: Record<string, AssigneeUser> = {
    u1: { id: 'u1', username: 'ada', email: 'ada@x', firstName: 'Ada', lastName: 'L' },
  };
  const repo: AssigneeRepository = {
    async add(taskId, userId) { links.add(`${taskId}:${userId}`); },
    async remove(taskId, userId) { links.delete(`${taskId}:${userId}`); },
    async list(taskId) {
      return [...links].filter((l) => l.startsWith(`${taskId}:`)).map((l) => users[l.split(':')[1]!]!).filter(Boolean);
    },
  };
  const taskLookup: TaskLookup = { async exists(id) { return id === 't1'; } };
  return { repo, taskLookup };
}

const tokenService = createTokenService({
  accessSecret: 'asg-access',
  refreshSecret: 'asg-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const events: { projectId: string; event: string; payload: unknown }[] = [];

async function makeApp() {
  const assigneeService = createAssigneeService(inMemory());
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  // A stub task service lets the assignee-broadcast scope resolve to the task's project.
  const taskService = { async getTask() { return { projectId: 'p1' }; } } as unknown as TaskService;
  return buildApp({
    authService,
    tokenService,
    assigneeService,
    taskService,
    onTaskEvent: (projectId, event, payload) => { events.push({ projectId, event, payload }); },
  });
}
async function token() {
  return (await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  events.length = 0;
  app = await makeApp();
});

describe('Assignee routes', () => {
  it('assigns users to a task (200) and lists them', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/assignees',
      headers: { authorization: `Bearer ${await token()}` },
      payload: { userIds: ['u1'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].username).toBe('ada');
  });

  it('rejects an unauthenticated assign (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/assignees', payload: { userIds: ['u1'] } });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when assigning to an unknown task', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/ghost/assignees',
      headers: { authorization: `Bearer ${await token()}` },
      payload: { userIds: ['u1'] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('unassigns a user (204)', async () => {
    const headers = { authorization: `Bearer ${await token()}` };
    await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/assignees', headers, payload: { userIds: ['u1'] } });
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/tasks/t1/assignees/u1', headers });
    expect(del.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/assignees', headers });
    expect(list.json().data).toEqual([]);
  });

  it('broadcasts task:assignees (with the fresh list) on assign and unassign', async () => {
    const headers = { authorization: `Bearer ${await token()}` };
    await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/assignees', headers, payload: { userIds: ['u1'] } });
    await app.inject({ method: 'DELETE', url: '/api/v1/tasks/t1/assignees/u1', headers });

    const assigneeEvents = events.filter((e) => e.event === 'task:assignees');
    expect(assigneeEvents).toHaveLength(2);
    expect(assigneeEvents[0]!.projectId).toBe('p1');
    expect((assigneeEvents[0]!.payload as { assignees: { username: string }[] }).assignees[0]!.username).toBe('ada');
    expect((assigneeEvents[1]!.payload as { assignees: unknown[] }).assignees).toEqual([]); // empty after unassign
  });
});

describe('Assignee routes — object-level authorization', () => {
  // Every fixture task lives in p1; only u1 is a member of p1.
  const members = new Set(['u1']);
  const projectAccess = {
    async canViewProject(userId: string, roles: string[]) { return roles.includes('ADMIN') || members.has(userId); },
    async canViewTask(userId: string, roles: string[]) { return roles.includes('ADMIN') || members.has(userId); },
    async canViewColumn() { return true; },
    async accessibleProjectIds(userId: string, roles: string[]) { return roles.includes('ADMIN') ? null : members.has(userId) ? ['p1'] : []; },
  };
  async function build() {
    const assigneeService = createAssigneeService(inMemory());
    const authService = createAuthService({
      users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
      maxAttempts: 5,
    });
    const taskService = { async getTask() { return { projectId: 'p1' }; } } as unknown as TaskService;
    return buildApp({ authService, tokenService, assigneeService, taskService, projectAccess });
  }
  const tokenFor = async (id: string, roles: string[]) => (await tokenService.issueTokens({ id, roles })).accessToken;

  it('403s a non-member reading or changing assignees, but allows a member', async () => {
    const a = await build();
    const outsider = { authorization: `Bearer ${await tokenFor('u9', ['EMPLOYEE'])}` };
    const member = { authorization: `Bearer ${await tokenFor('u1', ['EMPLOYEE'])}` };
    expect((await a.inject({ method: 'GET', url: '/api/v1/tasks/t1/assignees', headers: outsider })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: '/api/v1/tasks/t1/assignees', headers: outsider, payload: { userIds: ['u1'] } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: '/api/v1/tasks/t1/assignees/u1', headers: outsider })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: '/api/v1/tasks/t1/assignees', headers: member, payload: { userIds: ['u1'] } })).statusCode).toBe(200);
  });
});
