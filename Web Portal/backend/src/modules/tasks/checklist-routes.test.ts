import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createChecklistService } from './checklist-service';
import { createMemoryChecklistStore } from './checklist-store';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';

const tokenService = createTokenService({
  accessSecret: 'cl-access',
  refreshSecret: 'cl-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});

function service(extra: Partial<Parameters<typeof createChecklistService>[0]> = {}) {
  return createChecklistService({
    store: createMemoryChecklistStore({ liveTasks: () => ['t1', 't2'] }),
    taskLookup: { async exists(id) { return id === 't1' || id === 't2'; } },
    eligibleAssignees: async (_t, ids) => ids.filter((id) => ['u1', 'u2'].includes(id)),
    namesOf: async (ids) => new Map(ids.map((id) => [id, id === 'u2' ? 'Mariam Said' : 'Khurram'])),
    ...extra,
  });
}

async function makeApp(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  return buildApp({
    authService,
    tokenService,
    checklistService: service(),
    namesOfUsers: async (ids) => new Map(ids.map((id) => [id, id === 'u2' ? 'Mariam Said' : 'Khurram'])),
    ...extra,
  });
}
async function token(id = 'u1', roles = ['EMPLOYEE']) {
  return (await tokenService.issueTokens({ id, roles })).accessToken;
}

let app: Awaited<ReturnType<typeof makeApp>>;
let headers: { authorization: string };
beforeEach(async () => {
  app = await makeApp();
  headers = { authorization: `Bearer ${await token()}` };
});
const post = (url: string, payload: unknown = {}, a = app) => a.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload: payload as object });
const put = (url: string, payload: unknown, a = app) => a.inject({ method: 'PUT', url: `/api/v1${url}`, headers, payload: payload as object });
const get = (url: string, a = app) => a.inject({ method: 'GET', url: `/api/v1${url}`, headers });
const del = (url: string, a = app) => a.inject({ method: 'DELETE', url: `/api/v1${url}`, headers });

describe('Checklist routes — the old flat API keeps working', () => {
  it('records who added, ticked, renamed, reopened, reordered and removed a step (task timeline)', async () => {
    const events: { action: string; meta: Record<string, unknown> }[] = [];
    const a = await makeApp({ recordTaskActivity: async (e) => { events.push(e as never); } });
    const item = (await post('/tasks/t1/checklist', { text: 'Verify' }, a)).json().data;
    await put(`/checklist/${item.id}`, { done: true }, a);
    await put(`/checklist/${item.id}`, { text: 'Verify quote' }, a);
    await put(`/checklist/${item.id}`, { done: false }, a);
    await put('/tasks/t1/checklist/reorder', { orderedIds: [item.id] }, a);
    const removed = (await del(`/checklist/${item.id}`, a)).json().data;
    expect(events.map((e) => [e.action, e.meta])).toEqual([
      ['CHECKLIST_ADDED', { itemId: item.id, text: 'Verify', listTitle: 'Checklist' }],
      ['CHECKLIST_DONE', { itemId: item.id, text: 'Verify' }],
      ['CHECKLIST_RENAMED', { itemId: item.id, from: 'Verify', to: 'Verify quote' }],
      ['CHECKLIST_REOPENED', { itemId: item.id, text: 'Verify quote' }],
      ['CHECKLIST_REORDERED', { count: 1 }],
      ['CHECKLIST_REMOVED', { itemId: item.id, text: 'Verify quote', count: 1, batchId: removed.batchId }],
    ]);
  });

  it('a failing timeline never fails the change itself', async () => {
    const a = await makeApp({ recordTaskActivity: async () => { throw new Error('activity store down'); } });
    expect((await post('/tasks/t1/checklist', { text: 'Still added' }, a)).statusCode).toBe(201);
  });

  it('adds (201), ticks, rewords and lists with progress and X-of-Y, in one flat list', async () => {
    const add = await post('/tasks/t1/checklist', { text: 'Verify quotation' });
    expect(add.statusCode).toBe(201);
    expect(add.json().data).toMatchObject({ text: 'Verify quotation', done: false, position: 0, depth: 0, parentId: null });
    const id = add.json().data.id;
    expect((await put(`/checklist/${id}`, { text: 'new text' })).json().data.text).toBe('new text');
    await put(`/checklist/${id}`, { done: true });
    const list = (await get('/tasks/t1/checklist')).json().data;
    expect(list).toMatchObject({ progress: 100, done: 1, total: 1, lists: [{ title: 'Checklist', done: 1, total: 1 }] });
    expect(list.items).toHaveLength(1);
  });

  it('reorders items via PUT /tasks/:id/checklist/reorder', async () => {
    const a = (await post('/tasks/t1/checklist', { text: 'A' })).json().data.id;
    const b = (await post('/tasks/t1/checklist', { text: 'B' })).json().data.id;
    const res = await put('/tasks/t1/checklist/reorder', { orderedIds: [b, a] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((i: { text: string }) => i.text)).toEqual(['B', 'A']);
  });

  it('rejects unauthenticated access (401), unknown items (404) and blank or overlong text (400)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/checklist' })).statusCode).toBe(401);
    expect((await put('/checklist/ghost', { done: true })).statusCode).toBe(404);
    expect((await del('/checklist/ghost')).statusCode).toBe(404);
    expect((await post('/tasks/t1/checklist', { text: '   ' })).statusCode).toBe(400);
    expect((await post('/tasks/t1/checklist', { text: 'x'.repeat(192) })).statusCode).toBe(400);
  });

  it('ticking a parent from an older app is refused with the plain message (400)', async () => {
    const parent = (await post('/tasks/t1/checklist', { text: 'Panel' })).json().data;
    await post('/tasks/t1/checklist', { text: 'Label', parentId: parent.id });
    await post('/tasks/t1/checklist', { text: 'Test', parentId: parent.id });
    const res = await put(`/checklist/${parent.id}`, { done: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'CHECKLIST_PARENT', message: '2 sub-items still open.' });
    // The flat list an older app reads has every item, in order.
    expect((await get('/tasks/t1/checklist')).json().data.items.map((i: { text: string; depth: number }) => `${i.depth}${i.text}`)).toEqual(['0Panel', '1Label', '1Test']);
  });
});

describe('Checklist routes — nested checklists (1.23.3)', () => {
  it('adds several items at once with one history line, and checklists with titles', async () => {
    const events: { action: string; meta: Record<string, unknown> }[] = [];
    const a = await makeApp({ recordTaskActivity: async (e) => { events.push(e as never); } });
    const list = (await post('/tasks/t1/checklists', { title: 'Electrical' }, a)).json().data;
    expect(list).toMatchObject({ title: 'Electrical', done: 0, total: 0, position: 0 });
    const res = await post('/tasks/t1/checklist/batch', { texts: ['One', 'Two', 'Three'], listId: list.id }, a);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.items.map((i: { text: string }) => i.text)).toEqual(['One', 'Two', 'Three']);
    expect(events.at(-1)).toMatchObject({ action: 'CHECKLIST_ADDED', meta: { count: 3, texts: ['One', 'Two', 'Three'], listTitle: 'Electrical' } });
    expect((await post('/tasks/t1/checklist/batch', { texts: [] }, a)).statusCode).toBe(400);
  });

  it('renames, duplicates and deletes a checklist, and restores it', async () => {
    const events: { action: string; meta: Record<string, unknown> }[] = [];
    const a = await makeApp({ recordTaskActivity: async (e) => { events.push(e as never); } });
    const list = (await post('/tasks/t1/checklists', { title: 'Electrical' }, a)).json().data;
    await post('/tasks/t1/checklist/batch', { texts: ['One', 'Two'], listId: list.id }, a);
    expect((await put(`/checklists/${list.id}`, { title: 'Wiring' }, a)).json().data.title).toBe('Wiring');
    const copy = await post(`/checklists/${list.id}/duplicate`, {}, a);
    expect(copy.statusCode).toBe(201);
    expect(copy.json().data).toMatchObject({ title: 'Wiring (copy)', total: 2 });
    const gone = (await del(`/checklists/${list.id}`, a)).json().data;
    expect(gone).toMatchObject({ count: 2, taskId: 't1' });
    const deleted = (await get('/tasks/t1/checklist/deleted', a)).json().data;
    expect(deleted).toEqual([expect.objectContaining({ batchId: gone.batchId, kind: 'list', title: 'Wiring', count: 2, deletedBy: { id: 'u1', name: 'Khurram' } })]);
    expect((await post('/tasks/t1/checklist/restore', { batchId: gone.batchId }, a)).json().data).toEqual({ restored: 3, taskId: 't1' });
    expect((await get('/tasks/t1/checklist', a)).json().data.lists.map((l: { title: string }) => l.title)).toEqual(['Wiring', 'Wiring (copy)']);
    expect(events.map((e) => e.action)).toEqual([
      'CHECKLIST_LIST_ADDED', 'CHECKLIST_ADDED', 'CHECKLIST_LIST_RENAMED', 'CHECKLIST_LIST_DUPLICATED', 'CHECKLIST_LIST_REMOVED', 'CHECKLIST_RESTORED',
    ]);
    expect(events[3]!.meta).toMatchObject({ title: 'Wiring', count: 2 });
    expect(events[4]!.meta).toMatchObject({ title: 'Wiring', count: 2, batchId: gone.batchId });
  });

  it('moves (indent, outdent, up, down) and refuses circular nesting with a plain 400', async () => {
    const a = (await post('/tasks/t1/checklist', { text: 'A' })).json().data;
    const b = (await post('/tasks/t1/checklist', { text: 'B' })).json().data;
    const moved = await post(`/checklist/${b.id}/move`, { action: 'indent' });
    expect(moved.json().data).toMatchObject({ parentId: a.id, depth: 1 });
    const circular = await post(`/checklist/${a.id}/move`, { parentId: b.id, afterId: null });
    expect(circular.statusCode).toBe(400);
    expect(circular.json().error).toMatchObject({ code: 'CHECKLIST_CIRCULAR', message: 'An item can’t go under itself or one of its sub-items.' });
    expect((await post(`/checklist/${a.id}/move`, { action: 'sideways' })).statusCode).toBe(400);
  });

  it('duplicates an item with its sub-items (201) and deletes with Undo', async () => {
    const a = (await post('/tasks/t1/checklist', { text: 'A' })).json().data;
    await post('/tasks/t1/checklist', { text: 'A1', parentId: a.id });
    const dup = await post(`/checklist/${a.id}/duplicate`);
    expect(dup.statusCode).toBe(201);
    expect(dup.json().data).toMatchObject({ count: 2, item: { text: 'A (copy)' } });
    const gone = (await del(`/checklist/${a.id}`)).json().data;
    expect(gone.count).toBe(2);
    await post('/tasks/t1/checklist/restore', { batchId: gone.batchId });
    expect((await get('/tasks/t1/checklist')).json().data.items.map((i: { text: string }) => i.text)).toEqual(['A', 'A1', 'A (copy)', 'A1']);
    expect((await post('/tasks/t1/checklist/restore', { batchId: gone.batchId })).statusCode).toBe(404);
  });

  it('gives an item to someone with a due day: history lines and a notice for them (not for oneself)', async () => {
    const events: { action: string; meta: Record<string, unknown> }[] = [];
    const told: unknown[] = [];
    const a = await makeApp({ recordTaskActivity: async (e) => { events.push(e as never); }, onChecklistItemAssigned: async (n) => { told.push(n); } });
    const item = (await post('/tasks/t1/checklist', { text: 'Label circuits' }, a)).json().data;
    const res = await put(`/checklist/${item.id}`, { assigneeId: 'u2', dueDate: '2026-11-10' }, a);
    expect(res.json().data).toMatchObject({ assigneeId: 'u2', assignee: { id: 'u2', name: 'Mariam Said' }, dueDate: '2026-11-10' });
    expect(told).toEqual([{ taskId: 't1', itemId: item.id, text: 'Label circuits', assigneeId: 'u2', actorId: 'u1' }]);
    await put(`/checklist/${item.id}`, { assigneeId: 'u1' }, a);
    expect(told).toHaveLength(1);
    await put(`/checklist/${item.id}`, { assigneeId: null, dueDate: null }, a);
    expect(events.slice(1).map((e) => [e.action, e.meta])).toEqual([
      ['CHECKLIST_ASSIGNED', { itemId: item.id, text: 'Label circuits', assigneeId: 'u2', assignee: 'Mariam Said' }],
      ['CHECKLIST_DUE', { itemId: item.id, text: 'Label circuits', from: null, to: '2026-11-10' }],
      ['CHECKLIST_ASSIGNED', { itemId: item.id, text: 'Label circuits', assigneeId: 'u1', assignee: 'Khurram' }],
      ['CHECKLIST_UNASSIGNED', { itemId: item.id, text: 'Label circuits', assigneeId: 'u1', assignee: 'Khurram' }],
      ['CHECKLIST_DUE', { itemId: item.id, text: 'Label circuits', from: '2026-11-10', to: null }],
    ]);
    expect((await put(`/checklist/${item.id}`, { assigneeId: 'stranger' }, a)).statusCode).toBe(400);
    expect((await put(`/checklist/${item.id}`, { dueDate: '2026-02-30' }, a)).statusCode).toBe(400);
  });

  it('My Tasks lists the items given to me, in my own scope', async () => {
    const asked: unknown[] = [];
    const a = await makeApp({
      checklistMine: async (userId, projectIds) => {
        asked.push([userId, projectIds]);
        return [];
      },
    });
    expect((await get('/me/checklist-items', a)).json()).toEqual({ data: [] });
    expect(asked).toEqual([['u1', null]]);
  });
});

describe('Checklist routes — object-level authorization', () => {
  // u1 can see t1 only; t2 belongs to a project u1 is not in.
  const projectAccess = {
    async canViewProject() { return true; },
    async canViewTask(userId: string, roles: string[], taskId: string) { return roles.includes('ADMIN') || (userId === 'u1' && taskId === 't1'); },
    async canViewColumn() { return true; },
    async accessibleProjectIds() { return null; },
  };
  async function build() {
    const a = await makeApp({ projectAccess });
    const admin = { authorization: `Bearer ${await token('admin', ['ADMIN'])}` };
    const inject = (url: string, payload: object) => a.inject({ method: 'POST', url: `/api/v1${url}`, headers: admin, payload });
    const hidden = (await inject('/tasks/t2/checklist', { text: 'secret' })).json().data.id as string;
    const hiddenList = (await inject('/tasks/t2/checklists', { title: 'Secret list' })).json().data.id as string;
    const own = (await inject('/tasks/t1/checklist', { text: 'mine' })).json().data.id as string;
    return { app: a, hidden, hiddenList, own, admin };
  }

  it('403s every change to an item or checklist of a task the caller cannot see, and leaves it unchanged', async () => {
    const { app: a, hidden, hiddenList, admin } = await build();
    expect((await put(`/checklist/${hidden}`, { text: 'hacked', done: true }, a)).statusCode).toBe(403);
    expect((await del(`/checklist/${hidden}`, a)).statusCode).toBe(403);
    expect((await post(`/checklist/${hidden}/move`, { action: 'up' }, a)).statusCode).toBe(403);
    expect((await post(`/checklist/${hidden}/duplicate`, {}, a)).statusCode).toBe(403);
    expect((await put(`/checklists/${hiddenList}`, { title: 'x' }, a)).statusCode).toBe(403);
    expect((await post(`/checklists/${hiddenList}/duplicate`, {}, a)).statusCode).toBe(403);
    expect((await del(`/checklists/${hiddenList}`, a)).statusCode).toBe(403);
    expect((await post('/tasks/t2/checklists', { title: 'x' }, a)).statusCode).toBe(403);
    expect((await post('/tasks/t2/checklist/batch', { texts: ['x'] }, a)).statusCode).toBe(403);
    expect((await get('/tasks/t2/checklist/deleted', a)).statusCode).toBe(403);
    expect((await post('/tasks/t2/checklist/restore', { batchId: 'b' }, a)).statusCode).toBe(403);
    const list = await a.inject({ method: 'GET', url: '/api/v1/tasks/t2/checklist', headers: admin });
    expect(list.json().data.items[0]).toMatchObject({ text: 'secret', done: false });
    expect(list.json().data.lists.map((l: { title: string }) => l.title)).toEqual(['Checklist', 'Secret list']);
  });

  it('still lets a member edit and delete items of their own task', async () => {
    const { app: a, own } = await build();
    expect((await put(`/checklist/${own}`, { done: true }, a)).statusCode).toBe(200);
    expect((await del(`/checklist/${own}`, a)).statusCode).toBe(200);
  });
});
