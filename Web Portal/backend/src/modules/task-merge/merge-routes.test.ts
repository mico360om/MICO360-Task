import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createTaskService } from '../tasks/task-service';
import type { TaskRecord } from '../tasks/task-repository';
import type { ProjectAccess } from '../projects/project-access';
import type { AuditService } from '../audit/audit-service';
import type { TaskMergeService } from './merge-service';
import { ForbiddenError } from '../../lib/http-errors';

const NOW = new Date('2026-11-05T06:00:00Z');
const tokenService = createTokenService({
  accessSecret: 'merge-access',
  refreshSecret: 'merge-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

const record = (id: string, key: string): TaskRecord =>
  ({
    id, key, title: `Task ${key}`, description: null, projectId: 'rig', columnId: 'c1', columnCategory: 'TODO', position: 0, priority: 'NORMAL', startDate: null, dueDate: null,
    estimatedHours: null, actualHours: null, progress: 0, isMilestone: false, createdById: 'aisha', completedAt: null, boardDate: null, recurrenceRule: null, recurrenceParentId: null,
    version: 0, createdAt: NOW, updatedAt: NOW, formerKeys: [],
  }) as unknown as TaskRecord;

let calls: { name: string; args: unknown[] }[] = [];
let added: string[] = [];
let events: { projectId: string; event: string; payload: unknown }[] = [];
let audits: Record<string, unknown>[] = [];

/** A merge service that records what it is asked: the routes' own work is what is tested here. */
function fakeService(): TaskMergeService {
  const log = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };
  return {
    async preview(actor: unknown, input: { taskIds: string[] }) {
      log('preview')(actor, input);
      return { tasks: input.taskIds.map((id) => ({ id, key: id.toUpperCase(), canMerge: true, reason: null })), mainTaskId: input.taskIds[0] ?? null, canMerge: true } as never;
    },
    async merge(actor: { id: string }, input: unknown) {
      log('merge')(actor, input);
      if (actor.id === 'emp') throw new ForbiddenError('You need to manage Rig Inspection to merge its tasks.');
      return { mergeId: 'm1', mainTaskId: 't1', mainKey: 'RIG-1', mainProjectId: 'rig', mainProjectBefore: 'rig', merged: [{ id: 't2', key: 'RIG-2', projectId: 'ops' }], addedToTeam: [], leftOff: [], text: 'Merged RIG-2 into RIG-1' };
    },
    async mergedFrom(_a: unknown, id: string) {
      log('mergedFrom')(id);
      return { merges: [], labels: { comments: {}, checklist: {}, activity: {}, files: {} } };
    },
    async mergedRecord(mergeId: string, taskId: string) {
      log('mergedRecord')(mergeId, taskId);
      return { id: taskId } as never;
    },
    async resolveMerged(id: string) {
      return id === 't2' ? { mainTaskId: 't1', key: 'RIG-2', mergedAt: NOW, mergedByName: 'Aisha Khan' } : id === 'secret-merged' ? { mainTaskId: 'secret', key: 'ADM-2', mergedAt: NOW, mergedByName: 'X' } : null;
    },
    async undoPreview(_a: unknown, mergeId: string) {
      log('undoPreview')(mergeId);
      return { mergeId, mainTaskId: 't1', canUndo: true } as never;
    },
    async undo(_a: unknown, mergeId: string) {
      log('undo')(mergeId);
      return { mergeId, mainTaskId: 't1', mainKey: 'RIG-1', mainProjectId: 'rig', restored: [{ id: 't2', key: 'RIG-2', projectId: 'ops' }], text: 'Undid the merge' };
    },
    async mergeMain(mergeId: string) {
      return mergeId === 'm1' ? { mainTaskId: 't1' } : mergeId === 'm-secret' ? { mainTaskId: 'secret' } : null;
    },
    async mergedInto(id: string) {
      return id === 't1' ? [{ id: 't2', key: 'RIG-2', mergeId: 'm1' }] : [];
    },
  } as unknown as TaskMergeService;
}

async function makeApp() {
  calls = [];
  added = [];
  events = [];
  audits = [];
  const tasks = new Map([
    ['t1', record('t1', 'RIG-1')],
    ['t3', record('t3', 'RIG-3')],
  ]);
  const comments: string[] = [];
  const taskService = createTaskService({
    tasks: { async findById(id: string) { return tasks.get(id) ?? null; } } as never,
    projects: { async getCodeById() { return 'RIG'; }, async getTaskSettings() { return null; } },
  });
  // Aisha can't see the Admin project's tasks ('secret').
  const projectAccess = {
    async canViewTask(_u: string, _r: string[], taskId: string) { return taskId !== 'secret'; },
    async canViewProject() { return true; },
    async canViewColumn() { return true; },
    async accessibleProjectIds() { return ['rig', 'ops']; },
  } as unknown as ProjectAccess;
  const auditService = { async record(entry: Record<string, unknown>) { audits.push(entry); return entry; }, async list() { return []; } } as unknown as AuditService;
  const app = await buildApp({
    authService,
    tokenService,
    taskService,
    taskMergeService: fakeService(),
    projectAccess,
    auditService,
    commentService: {
      async listComments(id: string) { comments.push(id); return []; },
      async mentionable() { return []; },
      async addComment(taskId: string, _userId: string, body: string) { added.push(`comment:${taskId}`); return { id: 'c9', taskId, body }; },
    } as never,
    onTaskEvent: (projectId, event, payload) => { events.push({ projectId, event, payload }); },
  });
  return { app, comments };
}

let app: Awaited<ReturnType<typeof makeApp>>['app'];
let comments: string[];
beforeEach(async () => {
  ({ app, comments } = await makeApp());
});

describe('POST /tasks/merge-preview', () => {
  it('previews only the tasks the caller may see; one they can’t looks like one that doesn’t exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/merge-preview', headers: await bearer('aisha'), payload: { taskIds: ['t1', 'secret', 't3'] } });
    expect(res.statusCode).toBe(200);
    expect(calls[0]!.args[1]).toMatchObject({ taskIds: ['t1', 't3'] });
    expect(res.json().data.tasks.map((t: { id: string; reason: string | null }) => [t.id, t.reason])).toEqual([['t1', null], ['secret', 'Task not found.'], ['t3', null]]);
  });

  it('takes at most 10 tasks, and only known choices', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/merge-preview', headers: await bearer('aisha'), payload: { taskIds: ids } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/merge-preview', headers: await bearer('aisha'), payload: { taskIds: ['t1'], choices: { colour: 't1' } } })).statusCode).toBe(400);
  });

  it('needs a signed-in staff member (a client account is refused)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/merge-preview', payload: { taskIds: ['t1'] } })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/merge-preview', headers: await bearer('client-1', ['CLIENT']), payload: { taskIds: ['t1'] } });
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe('POST /tasks/merge', () => {
  it('merges, tells every board involved and records it in the audit log', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/merge', headers: await bearer('aisha'), payload: { taskIds: ['t1', 't3'], mainTaskId: 't1', choices: { priority: 't3' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.text).toBe('Merged RIG-2 into RIG-1');
    expect(events).toEqual([
      { projectId: 'rig', event: 'task:updated', payload: { id: 't1', projectId: 'rig' } },
      { projectId: 'ops', event: 'task:deleted', payload: { id: 't2', mergedIntoId: 't1' } },
    ]);
    expect(audits).toEqual([expect.objectContaining({ module: 'tasks', action: 'task.merged', entityId: 't1', newValue: expect.objectContaining({ mainKey: 'RIG-1', merged: ['RIG-2'], choices: { priority: 't3' } }) })]);
  });

  it('a task the caller can’t see: 404, nothing merged; fewer than 2 tasks: 400', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/merge', headers: await bearer('aisha'), payload: { taskIds: ['t1', 'secret'], mainTaskId: 't1' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/merge', headers: await bearer('aisha'), payload: { taskIds: ['t1'], mainTaskId: 't1' } })).statusCode).toBe(400);
    expect(calls.filter((c) => c.name === 'merge')).toEqual([]);
  });

  it('the service’s refusal (an employee): 403 with its words', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/merge', headers: await bearer('emp'), payload: { taskIds: ['t1', 't3'], mainTaskId: 't1' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('You need to manage Rig Inspection to merge its tasks.');
    expect(events).toEqual([]);
  });
});

describe('a merged task’s id keeps working', () => {
  it('GET /tasks/:id of a merged task answers with the main task, saying which was asked for', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t2', headers: await bearer('aisha') });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ id: 't1', key: 'RIG-1', mergeNotice: { key: 'RIG-2', mergedByName: 'Aisha Khan' } });
    expect(data.mergeNotice.mergedAt).toBe(NOW.toISOString());
  });

  it('the main task lists the tasks merged into it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t1', headers: await bearer('aisha') });
    expect(res.json().data).toMatchObject({ id: 't1', mergedFrom: [{ id: 't2', key: 'RIG-2', mergeId: 'm1' }] });
    expect(res.json().data.mergeNotice).toBeUndefined();
  });

  it('its comments, files, checklist… (what the phone app reads by the id it opened) are the main task’s', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/t2/comments', headers: await bearer('aisha') });
    expect(res.statusCode).toBe(200);
    expect(comments).toEqual(['t1']);
  });

  it('something added to a merged task’s id (a comment from a stale screen or the app’s queue) lands on the main task, saying so', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t2/comments', headers: await bearer('aisha'), payload: { body: 'hi' } });
    expect(res.statusCode).toBe(201);
    expect(added).toEqual(['comment:t1']);
    expect(res.json()).toMatchObject({ data: { taskId: 't1' }, mergedInto: { taskId: 't1', key: 'RIG-1', fromKey: 'RIG-2' } });
    // Added to a main task the person can't open: the route's own refusal, nothing added.
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/secret-merged/comments', headers: await bearer('aisha'), payload: { body: 'hi' } })).statusCode).toBe(403);
    expect(added).toEqual(['comment:t1']);
  });

  it('a change to a merged task’s own fields (or deleting it) is refused, naming the main task; to someone who can’t open it, 404', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/tasks/t2', headers: await bearer('aisha'), payload: { title: 'x' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'TASK_MERGED', message: 'RIG-2 was merged into RIG-1. Open RIG-1 to change it.', details: { mainTaskId: 't1', mainKey: 'RIG-1' } });
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/tasks/t2', headers: await bearer('aisha') })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/tasks/secret-merged', headers: await bearer('aisha'), payload: { title: 'x' } })).statusCode).toBe(404);
    expect(comments).toEqual([]);
  });
});

describe('the "Merged from" panel, a merged record and Undo', () => {
  it('only for someone who may open the main task', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/tasks/t1/merges', headers: await bearer('aisha') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/task-merges/m1/tasks/t2', headers: await bearer('aisha') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/task-merges/m-secret/tasks/x', headers: await bearer('aisha') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/task-merges/nope/undo-preview', headers: await bearer('aisha') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/task-merges/m-secret/undo', headers: await bearer('aisha') })).statusCode).toBe(404);
    expect(calls.filter((c) => c.name === 'undo')).toEqual([]);
  });

  it('Undo tells the boards the tasks are back and records it', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/task-merges/m1/undo', headers: await bearer('aisha') });
    expect(res.statusCode).toBe(200);
    expect(events).toEqual([
      { projectId: 'rig', event: 'task:updated', payload: { id: 't1', projectId: 'rig' } },
      { projectId: 'ops', event: 'task:created', payload: { id: 't2', projectId: 'ops' } },
    ]);
    expect(audits).toEqual([expect.objectContaining({ action: 'task.merge-undone', entityId: 't1' })]);
  });
});
