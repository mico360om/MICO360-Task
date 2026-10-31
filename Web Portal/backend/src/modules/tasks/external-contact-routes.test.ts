import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { ProjectAccess } from '../projects/project-access';
import { approvalWorld } from './task-approval.fixture';
import { createExternalContactService } from './external-contact-service';
import { createMemoryExternalContactRepository } from './memory-external-contact-repository';
import type { TaskActivityEvent } from '../activity/task-activity';

const tokenService = createTokenService({
  accessSecret: 'xc-access',
  refreshSecret: 'xc-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

let app: Awaited<ReturnType<typeof buildApp>>;
let taskId = '';
let hiddenId = '';
let events: { projectId: string; event: string; payload: unknown }[];
let activity: TaskActivityEvent[];

beforeEach(async () => {
  const world = approvalWorld();
  taskId = (await world.make({})).id;
  hiddenId = (await world.make({ projectId: 'p2', columnId: 'q-doing' })).id;
  const live = new Map([...world.rows.values()].map((t) => [t.id, t.projectId]));
  const service = createExternalContactService({
    repo: createMemoryExternalContactRepository({ liveTasks: live }),
    taskLookup: { exists: async (id) => live.has(id) },
  });
  events = [];
  activity = [];
  app = await buildApp({
    authService,
    tokenService,
    taskService: world.svc,
    externalContactService: service,
    onTaskEvent: (projectId, event, payload) => events.push({ projectId, event, payload }),
    recordTaskActivity: async (e) => {
      activity.push(e);
    },
    // Omar can't see project p2 or its tasks.
    projectAccess: {
      async canViewTask(u: string, _r: string[], id: string) { return !(u === 'omar' && id === hiddenId); },
      async canViewProject(u: string, _r: string[], projectId: string) { return !(u === 'omar' && projectId === 'p2'); },
      async canViewColumn() { return true; },
      async accessibleProjectIds() { return null; },
    } as unknown as ProjectAccess,
  });
});

const ahmed = { name: 'Ahmed Al Said', company: 'OXY', designation: 'Site lead', email: 'ahmed@oxy.com', phone: '+968 9912 3456', remarks: 'Call before 10' };

describe('External contact routes', () => {
  it('adds a contact (201), lists it, and the task’s details carry it', async () => {
    const headers = await bearer('sara');
    const add = await app.inject({ method: 'POST', url: `/api/v1/tasks/${taskId}/external-contacts`, headers, payload: ahmed });
    expect(add.statusCode).toBe(201);
    expect(add.json().data).toMatchObject({ ...ahmed, taskId, position: 0, createdById: 'sara' });
    const list = await app.inject({ method: 'GET', url: `/api/v1/tasks/${taskId}/external-contacts`, headers });
    expect(list.json().data.map((c: { name: string }) => c.name)).toEqual(['Ahmed Al Said']);
  });

  it('refuses a contact without a name in plain words, saying which field', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/tasks/${taskId}/external-contacts`, headers: await bearer('sara'), payload: { company: 'OXY', email: 'bad' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toEqual({
      code: 'VALIDATION',
      message: 'Enter the contact’s name.',
      details: { fields: { name: 'Enter the contact’s name.', email: 'Enter a valid email address, like name@company.com.' } },
    });
  });

  it('changes and removes a contact, writing each to the task’s history', async () => {
    const headers = await bearer('sara');
    const id = (await app.inject({ method: 'POST', url: `/api/v1/tasks/${taskId}/external-contacts`, headers, payload: { name: 'Ahmed', company: 'OXY' } })).json().data.id;
    const put = await app.inject({ method: 'PUT', url: `/api/v1/external-contacts/${id}`, headers, payload: { name: 'Ahmed Al Said', phone: '+968 1234' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toMatchObject({ id, name: 'Ahmed Al Said', company: 'OXY', phone: '+968 1234' });
    // Saving it unchanged writes no history.
    await app.inject({ method: 'PUT', url: `/api/v1/external-contacts/${id}`, headers, payload: { name: 'Ahmed Al Said' } });
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/external-contacts/${id}`, headers });
    expect(del.statusCode).toBe(204);
    expect(activity).toEqual([
      { taskId, userId: 'sara', action: 'EXTERNAL_CONTACT_ADDED', meta: { name: 'Ahmed', company: 'OXY' } },
      { taskId, userId: 'sara', action: 'EXTERNAL_CONTACT_CHANGED', meta: { name: 'Ahmed Al Said', company: 'OXY' } },
      { taskId, userId: 'sara', action: 'EXTERNAL_CONTACT_REMOVED', meta: { name: 'Ahmed Al Said', company: 'OXY' } },
    ]);
    const again = await app.inject({ method: 'DELETE', url: `/api/v1/external-contacts/${id}`, headers });
    expect(again.statusCode).toBe(404);
    expect(again.json().error.message).toBe('This contact isn’t on the task any more. Someone may have removed it.');
  });

  it('tells everyone looking at the board that the task changed, with the task as it is now', async () => {
    const headers = await bearer('sara');
    await app.inject({ method: 'POST', url: `/api/v1/tasks/${taskId}/external-contacts`, headers, payload: ahmed });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ projectId: 'p1', event: 'task:updated', payload: { id: taskId } });
  });

  it('someone who can’t see the task can’t see, add, change or remove its contacts', async () => {
    const sara = await bearer('sara');
    const omar = await bearer('omar');
    const id = (await app.inject({ method: 'POST', url: `/api/v1/tasks/${hiddenId}/external-contacts`, headers: sara, payload: ahmed })).json().data.id;
    for (const req of [
      { method: 'GET' as const, url: `/api/v1/tasks/${hiddenId}/external-contacts` },
      { method: 'POST' as const, url: `/api/v1/tasks/${hiddenId}/external-contacts`, payload: ahmed },
      { method: 'PUT' as const, url: `/api/v1/external-contacts/${id}`, payload: { name: 'X' } },
      { method: 'DELETE' as const, url: `/api/v1/external-contacts/${id}` },
    ]) {
      const res = await app.inject({ ...req, headers: omar });
      expect(res.statusCode, `${req.method} ${req.url}`).toBe(403);
    }
  });

  it('suggests contacts used earlier on the project’s tasks, by what was typed', async () => {
    const headers = await bearer('sara');
    await app.inject({ method: 'POST', url: `/api/v1/tasks/${taskId}/external-contacts`, headers, payload: ahmed });
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects/p1/external-contacts?q=ahm', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([ahmed]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/projects/p2/external-contacts?q=ahm', headers: await bearer('omar') })).statusCode).toBe(403);
  });

  it('a failing history never fails the change itself', async () => {
    const world = approvalWorld();
    const t = await world.make({});
    const live = new Map([[t.id, t.projectId]]);
    const a = await buildApp({
      authService,
      tokenService,
      taskService: world.svc,
      externalContactService: createExternalContactService({ repo: createMemoryExternalContactRepository({ liveTasks: live }), taskLookup: { exists: async (id) => live.has(id) } }),
      recordTaskActivity: async () => {
        throw new Error('activity store down');
      },
    });
    const res = await a.inject({ method: 'POST', url: `/api/v1/tasks/${t.id}/external-contacts`, headers: await bearer('sara'), payload: ahmed });
    expect(res.statusCode).toBe(201);
  });
});
