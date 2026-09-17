import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createChecklistService } from './checklist-service';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { ChecklistItemRecord, ChecklistRepository } from './checklist-repository';
import type { TaskLookup } from './assignee-repository';

function inMemory() {
  const rows: ChecklistItemRecord[] = [];
  let seq = 0;
  const repo: ChecklistRepository = {
    async add(taskId, text, position) {
      const item = { id: `i${seq++}`, taskId, text, done: false, position };
      rows.push(item);
      return item;
    },
    async toggle(itemId, done) {
      const item = rows.find((r) => r.id === itemId)!;
      item.done = done;
      return item;
    },
    async editText(itemId, text) {
      const item = rows.find((r) => r.id === itemId)!;
      item.text = text;
      return item;
    },
    async list(taskId) {
      return rows.filter((r) => r.taskId === taskId).sort((a, b) => a.position - b.position);
    },
    async reorder(taskId, orderedIds) {
      orderedIds.forEach((id, index) => {
        const item = rows.find((r) => r.id === id && r.taskId === taskId);
        if (item) item.position = index;
      });
      return rows.filter((r) => r.taskId === taskId).sort((a, b) => a.position - b.position);
    },
    async remove(itemId) {
      const i = rows.findIndex((r) => r.id === itemId);
      if (i < 0) return null;
      const [removed] = rows.splice(i, 1);
      return { taskId: removed!.taskId };
    },
  };
  const taskLookup: TaskLookup = { async exists(id) { return id === 't1'; } };
  return { repo, taskLookup };
}

const tokenService = createTokenService({
  accessSecret: 'cl-access',
  refreshSecret: 'cl-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

async function makeApp() {
  const checklistService = createChecklistService(inMemory());
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({ authService, tokenService, checklistService });
}
async function token() {
  return (await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'] })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('Checklist routes', () => {
  it('adds an item (201) and reports progress on list', async () => {
    const add = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/checklist',
      headers: { authorization: `Bearer ${await token()}` },
      payload: { text: 'Verify quotation' },
    });
    expect(add.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/checklist', headers: { authorization: `Bearer ${await token()}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.progress).toBe(0);
    expect(list.json().data.items).toHaveLength(1);
  });

  it('toggling an item updates progress to 100', async () => {
    const add = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks/t1/checklist',
      headers: { authorization: `Bearer ${await token()}` },
      payload: { text: 'x' },
    });
    const itemId = add.json().data.id;
    await app.inject({
      method: 'PUT',
      url: `/api/v1/checklist/${itemId}`,
      headers: { authorization: `Bearer ${await token()}` },
      payload: { done: true },
    });
    const list = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/checklist', headers: { authorization: `Bearer ${await token()}` } });
    expect(list.json().data.progress).toBe(100);
  });

  it('edits an item’s text via PUT and reports X-of-Y counts on list', async () => {
    const headers = { authorization: `Bearer ${await token()}` };
    const add = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/checklist', headers, payload: { text: 'old' } });
    const itemId = add.json().data.id;
    const put = await app.inject({ method: 'PUT', url: `/api/v1/checklist/${itemId}`, headers, payload: { text: 'new text' } });
    expect(put.json().data.text).toBe('new text');
    const list = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/checklist', headers });
    expect(list.json().data).toMatchObject({ done: 0, total: 1, progress: 0 });
  });

  it('reorders items via PUT /tasks/:id/checklist/reorder', async () => {
    const headers = { authorization: `Bearer ${await token()}` };
    const a = (await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/checklist', headers, payload: { text: 'A' } })).json().data.id;
    const b = (await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/checklist', headers, payload: { text: 'B' } })).json().data.id;
    const res = await app.inject({ method: 'PUT', url: '/api/v1/tasks/t1/checklist/reorder', headers, payload: { orderedIds: [b, a] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((i: { text: string }) => i.text)).toEqual(['B', 'A']);
  });

  it('rejects unauthenticated access (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/checklist' });
    expect(res.statusCode).toBe(401);
  });
});
