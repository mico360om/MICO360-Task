import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createTaskService } from './task-service';
import { createNewTask } from './task-create';
import { createMemoryIdempotencyStore } from '../../lib/idempotency';
import type { CreateTaskData, TaskRecord, TaskRepository } from './task-repository';
import type { AssigneeService } from './assignee-service';
import type { UserState } from '../auth/auth-guard';

// Review fix #15 (13 Nov 2026): once a new task is saved, what follows it (its history line, the
// assignees' notices, reading its assignees back, a waiting task's notice) is best effort: a failure is
// logged and the saved task still answers 201 — so a client's retry with the same key replays it
// instead of creating a duplicate.
const blip = () => Object.assign(new Error("Can't reach database server at `db:3306`"), { name: 'PrismaClientInitializationError', errorCode: 'P1001' });

function fakeTasks() {
  const rows: TaskRecord[] = [];
  const repo = {
    async create(data: CreateTaskData) {
      const now = new Date();
      const rec = {
        ...data, id: `t${rows.length + 1}`, position: 0, progress: 0, columnCategory: 'TODO', version: 0, createdAt: now, updatedAt: now,
        description: data.description ?? null, completedAt: null, recurrenceRule: null, recurrenceParentId: null, formerKeys: [],
      } as unknown as TaskRecord;
      rows.push(rec);
      return rec;
    },
    async findById(id: string) { return rows.find((r) => r.id === id) ?? null; },
    async countByProject() { return rows.length; },
    async findColumn(id: string) { return { id, projectId: 'p1', category: id === 'done' ? 'DONE' : 'TODO' }; },
  } as unknown as TaskRepository;
  return { repo, rows };
}
const projects = { async getCodeById() { return 'P1'; }, async getTaskSettings() { return { defaultDueToday: true }; } };

describe('createTask: what follows the save is best effort', () => {
  it('the history line (onCreated) failing: the task is still returned, the failure is logged', async () => {
    const { repo, rows } = fakeTasks();
    const errors: string[] = [];
    const svc = createTaskService({ tasks: repo, projects, onCreated: async () => { throw blip(); }, onError: (_e, taskId, what) => void errors.push(`${what} ${taskId}`) });
    const t = await svc.createTask({ title: 'Pour slab', projectId: 'p1', columnId: 'c1', createdById: 'u1' } as never);
    expect(t.id).toBe('t1');
    expect(rows).toHaveLength(1);
    expect(errors).toEqual(['recording the new task t1']);
  });

  it('when the history line succeeds it still carries autoDue (KPIs) exactly as before', async () => {
    const { repo } = fakeTasks();
    const seen: Array<{ autoDue: boolean } | undefined> = [];
    const svc = createTaskService({ tasks: repo, projects, onCreated: async (_t, info) => void seen.push(info) });
    await svc.createTask({ title: 'No date', projectId: 'p1', columnId: 'c1', createdById: 'u1' } as never);
    await svc.createTask({ title: 'Dated', projectId: 'p1', columnId: 'c1', createdById: 'u1', dueDate: new Date('2030-01-02T00:00:00Z') } as never);
    expect(seen).toEqual([{ autoDue: true }, { autoDue: false }]);
  });

  it('a task created waiting for approval: its approvers’ notice failing doesn’t fail the create', async () => {
    const { repo, rows } = fakeTasks();
    const errors: string[] = [];
    const svc = createTaskService({
      tasks: repo,
      projects,
      approvals: { canApprove: async () => false, columnsOf: async () => [{ id: 'rev', category: 'IN_REVIEW', position: 1, enabled: true }, { id: 'done', category: 'DONE', position: 2, enabled: true }] } as never,
      onMoved: async () => { throw blip(); },
      onError: (_e, taskId, what) => void errors.push(`${what} ${taskId}`),
    });
    const t = await svc.createTask({ title: 'Sign-off', projectId: 'p1', columnId: 'done', createdById: 'u1', needsApproval: true } as never);
    expect(t.columnId).toBe('rev');
    expect(rows).toHaveLength(1);
    expect(errors).toEqual(['telling the approvers t1']);
  });
});

describe('createNewTask: the assignees’ notices and read-back are best effort', () => {
  function pipeline(assignees: Partial<AssigneeService>) {
    const { repo, rows } = fakeTasks();
    const errors: string[] = [];
    return {
      rows,
      errors,
      p: {
        taskService: createTaskService({ tasks: repo, projects }),
        scopeOf: async () => null,
        assigneeService: { assertAssignable: async (_p: string, ids: string[]) => ids, ...assignees } as unknown as AssigneeService,
        onError: (_e: unknown, what: string, taskId: string) => void errors.push(`${what} ${taskId}`),
      },
    };
  }

  it('the notices failing: the task is returned with its assignees, the failure logged', async () => {
    const { p, rows, errors } = pipeline({
      notifyAssigned: async () => { throw blip(); },
      listAssignees: async () => [{ id: 'u7', username: 'sara', email: '', firstName: 'Sara', lastName: 'K' }],
    });
    const t = await createNewTask(p, { id: 'u1', roles: ['EMPLOYEE'] }, { title: 'Pour slab', projectId: 'p1', columnId: 'c1', assigneeIds: ['u7'] } as never);
    expect(rows).toHaveLength(1);
    expect(t.assignees).toEqual([{ id: 'u7', username: 'sara', email: '', firstName: 'Sara', lastName: 'K' }]);
    expect(errors).toEqual(['telling the assignees t1']);
  });

  it('reading the assignees back failing: the task is returned (as one made without assignees is), the failure logged', async () => {
    const { p, rows, errors } = pipeline({ notifyAssigned: async () => undefined, listAssignees: async () => { throw blip(); } });
    const t = await createNewTask(p, { id: 'u1', roles: ['EMPLOYEE'] }, { title: 'Pour slab', projectId: 'p1', columnId: 'c1', assigneeIds: ['u7'] } as never);
    expect(rows).toHaveLength(1);
    expect(t.id).toBe('t1');
    expect(errors).toEqual(['reading its assignees back t1']);
  });
});

describe('POST /tasks after a database hiccup (the reviewers’ repro)', () => {
  const tokenService = createTokenService({
    accessSecret: 'th-access',
    refreshSecret: 'th-refresh',
    accessTtl: 900,
    refreshTtl: 1000,
    refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
  });
  const authService = createAuthService({
    users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
    maxAttempts: 5,
  });
  const states = new Map<string, UserState>([['u1', { active: true, tokenVersion: 0, roles: ['EMPLOYEE'] }]]);
  afterEach(() => undefined);

  it('the history line hits a blip: 201, and the same-key retry replays it — one task, not two', async () => {
    const { repo, rows } = fakeTasks();
    let fail = true;
    const taskService = createTaskService({
      tasks: repo,
      projects: { async getCodeById() { return 'P1'; }, async getTaskSettings() { return null; } },
      onCreated: async () => {
        if (fail) {
          fail = false;
          throw blip();
        }
      },
    });
    const app = await buildApp({
      authService,
      tokenService,
      taskService,
      userState: async (id) => states.get(id) ?? null,
      projectAccess: { async canViewTask() { return true; }, async canViewProject() { return true; }, async canViewColumn() { return true; }, async accessibleProjectIds() { return ['p1']; } } as never,
      idempotencyStore: createMemoryIdempotencyStore(),
      logger: { error() {}, warn() {}, info() {}, debug() {}, job() { return this; } } as never,
    });
    const h = { authorization: `Bearer ${(await tokenService.issueTokens({ id: 'u1', roles: ['EMPLOYEE'], tokenVersion: 0 })).accessToken}`, 'idempotency-key': 'K-dup' };
    const body = { title: 'Pour slab', projectId: 'p1', columnId: 'c1' };
    const first = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: h, payload: body });
    const retry = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: h, payload: body });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(rows).toHaveLength(1);
    await app.close();
  });
});
