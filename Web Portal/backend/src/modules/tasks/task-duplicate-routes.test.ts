import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createTaskService } from './task-service';
import { createMemoryIdempotencyStore } from '../../lib/idempotency';
import { ForbiddenError, NotFoundError } from '../../lib/http-errors';
import type { TaskRecord } from './task-repository';
import type { ProjectAccess } from '../projects/project-access';
import type { DuplicateOptions, DuplicatePrefill, TaskDuplicateService } from './task-duplicate';

const NOW = new Date('2026-11-10T06:00:00Z');
const tokenService = createTokenService({
  accessSecret: 'dup-access',
  refreshSecret: 'dup-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

const record = (id: string, key: string, projectId = 'mssp'): TaskRecord =>
  ({
    id, key, title: `Task ${key}`, description: null, projectId, columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null,
    estimatedHours: null, actualHours: null, progress: 0, isMilestone: false, createdById: 'omar', completedAt: null, boardDate: null, recurrenceRule: null, recurrenceParentId: null,
    version: 0, createdAt: NOW, updatedAt: NOW, formerKeys: [],
  }) as unknown as TaskRecord;

let calls: { name: string; taskId: string; opts?: DuplicateOptions }[] = [];
let made = 0;

/** A duplicate service that records what it is asked: the routes' own work is what is tested here. */
function fakeService(): TaskDuplicateService {
  return {
    async prefill(_actor, taskId) {
      calls.push({ name: 'prefill', taskId });
      if (taskId === 'secret') throw new NotFoundError('Task not found.');
      return { original: { id: taskId, key: 'MSSP-34', title: 'Inspect', projectId: 'mssp' }, task: { title: 'Inspect' }, watchers: [], files: [] } as unknown as DuplicatePrefill;
    },
    async duplicate(_actor, taskId, opts = {}) {
      calls.push({ name: 'duplicate', taskId, opts });
      if (taskId === 'secret') throw new NotFoundError('Task not found.');
      if (opts.body?.projectId === 'admin-only') throw new ForbiddenError('You do not have access to this project.');
      made += 1;
      return { task: record(`copy${made}`, `MSSP-${39 + made}`) as never, files: { total: 2, copied: 1, failed: [{ filename: 'x.dwg', reason: 'It couldn’t be copied.' }] } };
    },
  };
}

// The task t1 and its copies: c1 (MSSP, can be opened), c2 (Admin project, can't).
const DUP_LINKS: Record<string, { from: { id: string; key: string } | null; copies: { id: string; key: string }[] }> = {
  t1: { from: null, copies: [{ id: 'c1', key: 'MSSP-40' }, { id: 'c2', key: 'ADM-7' }] },
  c1: { from: { id: 't1', key: 'MSSP-34' }, copies: [] },
  c3: { from: { id: 'secret', key: 'ADM-1' }, copies: [] },
};

async function makeApp(opts: { idempotency?: boolean; perMinute?: number } = {}) {
  calls = [];
  made = 0;
  const tasks = new Map([
    ['t1', record('t1', 'MSSP-34')],
    ['c1', record('c1', 'MSSP-40')],
    ['c3', record('c3', 'MSSP-41')],
  ]);
  const taskService = createTaskService({
    tasks: { async findById(id: string) { return tasks.get(id) ?? null; } } as never,
    projects: { async getCodeById() { return 'MSSP'; }, async getTaskSettings() { return null; } },
  });
  // Omar can't open the Admin project's tasks (secret, c2).
  const projectAccess = {
    async canViewTask(_u: string, _r: string[], taskId: string) { return taskId !== 'secret' && taskId !== 'c2'; },
    async canViewProject() { return true; },
    async canViewColumn() { return true; },
    async accessibleProjectIds() { return ['mssp']; },
  } as unknown as ProjectAccess;
  return buildApp({
    authService,
    tokenService,
    taskService,
    projectAccess,
    taskDuplicateService: fakeService(),
    duplicateLinks: async (id) => DUP_LINKS[id] ?? { from: null, copies: [] },
    ...(opts.idempotency ? { idempotencyStore: createMemoryIdempotencyStore() } : {}),
    ...(opts.perMinute ? { duplicatesPerMinute: opts.perMinute } : {}),
  });
}

let app: Awaited<ReturnType<typeof makeApp>>;
beforeEach(async () => {
  app = await makeApp();
});

describe('GET /tasks/:id/duplicate (the review form’s pre-fill)', () => {
  it('answers the service’s pre-fill for the person', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('omar') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.original).toMatchObject({ key: 'MSSP-34' });
    expect(calls).toEqual([{ name: 'prefill', taskId: 't1' }]);
  });

  it('a task the person can’t open: 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/tasks/secret/duplicate', headers: await bearer('omar') })).statusCode).toBe(404);
  });

  it('needs a signed-in staff member: a client account is refused', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/duplicate' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('client-1', ['CLIENT']) })).statusCode).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('POST /tasks/:id/duplicate', () => {
  const body = { title: 'Inspect again', projectId: 'mssp', priority: 'HIGH', assigneeIds: ['sara'], dueDate: '2026-11-12', startDate: '2026-11-03' };

  it('makes the copy from the reviewed form (files copied unless unticked) and says how the files went', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('omar'), payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      data: expect.objectContaining({ id: 'copy1', key: 'MSSP-40' }),
      files: { total: 2, copied: 1, failed: [{ filename: 'x.dwg', reason: 'It couldn’t be copied.' }] },
    });
    const asked = calls[0]!.opts!;
    expect(asked.copyFiles).toBe(true);
    expect(asked.body).toMatchObject({ title: 'Inspect again', projectId: 'mssp', priority: 'HIGH', assigneeIds: ['sara'] });
    expect(asked.body!.dueDate).toEqual(new Date('2026-11-12T00:00:00Z'));
    expect(asked.body!.startDate).toEqual(new Date('2026-11-03T00:00:00Z'));
    expect(asked.body!.columnId).toBeUndefined();
  });

  it('a person’s copies are limited per minute (each one copies its files on the server; review M2)', async () => {
    const limited = await makeApp({ perMinute: 2 });
    const send = async () => (await limited.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('omar'), payload: body })).statusCode;
    expect([await send(), await send(), await send()]).toEqual([201, 201, 429]);
    // Someone else's copies aren't counted with theirs.
    expect((await limited.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('sara'), payload: body })).statusCode).toBe(201);
    await limited.close();
  });

  it('passes the tick as sent, a start date of none, and the column chosen', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('omar'), payload: { ...body, copyFiles: false, startDate: null, columnId: 'c9' } });
    expect(calls[0]!.opts).toMatchObject({ copyFiles: false, body: { startDate: null, columnId: 'c9' } });
  });

  it('checks the fields as the New task form’s: a title is needed', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('omar'), payload: { ...body, title: '  ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('omar'), payload: { title: 'x' } })).statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it('the original can’t be opened: 404; the chosen project isn’t theirs: 403 — in the service’s words', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/secret/duplicate', headers: await bearer('omar'), payload: body })).statusCode).toBe(404);
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('omar'), payload: { ...body, projectId: 'admin-only' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('You do not have access to this project.');
  });

  it('a client account is refused before anything is made', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers: await bearer('client-1', ['CLIENT']), payload: body });
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });

  it('a double click (the same Idempotency-Key) makes one copy', async () => {
    const idem = await makeApp({ idempotency: true });
    const headers = { ...(await bearer('omar')), 'idempotency-key': 'dup-key-1' };
    const first = await idem.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers, payload: body });
    const again = await idem.inject({ method: 'POST', url: '/api/v1/tasks/t1/duplicate', headers, payload: body });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.json().data.key).toBe(first.json().data.key);
    expect(calls.filter((c) => c.name === 'duplicate')).toHaveLength(1);
  });
});

describe('GET /tasks/:id: the reference both ways', () => {
  it('a copy names the task it was duplicated from', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/c1', headers: await bearer('omar') });
    expect(res.json().data).toMatchObject({ duplicatedFrom: { id: 't1', key: 'MSSP-34' }, copies: [] });
  });

  it('the original lists only the copies the reader can open (no number of any other)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1', headers: await bearer('omar') });
    expect(res.json().data).toMatchObject({ duplicatedFrom: null, copies: [{ id: 'c1', key: 'MSSP-40' }] });
    expect(res.body).not.toContain('ADM-7');
    expect(res.body).not.toContain('"c2"');
  });

  it('a copy of a task the reader can’t open doesn’t name it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/c3', headers: await bearer('omar') });
    expect(res.json().data.duplicatedFrom).toBeNull();
    expect(res.body).not.toContain('ADM-1');
  });

  it('task lists never carry the reference', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/c1', headers: await bearer('omar') });
    expect(res.json().data.duplicatedFromId).toBeUndefined();
  });
});
