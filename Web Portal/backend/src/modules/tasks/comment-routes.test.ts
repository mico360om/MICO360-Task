import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createCommentService } from './comment-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { CommentRecord, CommentRepository } from './comment-repository';
import type { TaskLookup } from './assignee-repository';
import type { TaskService } from './task-service';

function inMemory() {
  const rows = new Map<string, CommentRecord>();
  let seq = 0;
  const repo: CommentRepository = {
    async create(taskId, userId, body, parentId) {
      const rec = { id: `c${seq++}`, taskId, userId, body, parentId: parentId ?? null, editedAt: null, createdAt: new Date() };
      rows.set(rec.id, rec);
      return rec;
    },
    async findById(id) { return rows.get(id) ?? null; },
    async list(taskId) { return [...rows.values()].filter((c) => c.taskId === taskId); },
    async update(id, body) { const r = { ...rows.get(id)!, body, editedAt: new Date() }; rows.set(id, r); return r; },
    async delete(id) { rows.delete(id); },
  };
  const taskLookup: TaskLookup = { async exists(id) { return id === 't1'; } };
  return { repo, taskLookup };
}

const tokenService = createTokenService({
  accessSecret: 'cm-access',
  refreshSecret: 'cm-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

const events: { projectId: string; event: string; payload: unknown }[] = [];

async function makeApp() {
  const commentService = createCommentService(inMemory());
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const taskService = { async getTask() { return { projectId: 'p1' }; } } as unknown as TaskService;
  return buildApp({
    authService,
    tokenService,
    commentService,
    taskService,
    onTaskEvent: (projectId, event, payload) => { events.push({ projectId, event, payload }); },
  });
}
async function token(id: string) {
  return (await tokenService.issueTokens({ id, roles: ['EMPLOYEE'] })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  events.length = 0;
  app = await makeApp();
});

describe('Comment routes', () => {
  it('adds a comment (201) and lists it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/comments',
      headers: { authorization: `Bearer ${await token('u1')}` },
      payload: { body: 'Looks good @ada' },
    });
    expect(res.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/comments', headers: { authorization: `Bearer ${await token('u1')}` } });
    expect(list.json().data).toHaveLength(1);
  });

  it('forbids a different user from editing a comment (403)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/comments',
      headers: { authorization: `Bearer ${await token('u1')}` },
      payload: { body: 'mine' },
    });
    const id = created.json().data.id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/comments/${id}`,
      headers: { authorization: `Bearer ${await token('u2')}` },
      payload: { body: 'hacked' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects unauthenticated access (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/comments' });
    expect(res.statusCode).toBe(401);
  });

  it('broadcasts comment:created on add and comment:deleted on delete', async () => {
    const headers = { authorization: `Bearer ${await token('u1')}` };
    const created = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/comments', headers, payload: { body: 'hi' } });
    const id = created.json().data.id;
    await app.inject({ method: 'DELETE', url: `/api/v1/comments/${id}`, headers });

    const names = events.map((e) => e.event);
    expect(names).toContain('comment:created');
    expect(names).toContain('comment:deleted');
    expect(events.every((e) => e.projectId === 'p1')).toBe(true);
  });
});
