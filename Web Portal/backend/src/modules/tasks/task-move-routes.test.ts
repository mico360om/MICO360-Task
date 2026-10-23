import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import { createTaskMoveService } from './task-move-service';
import { createMemoryTaskMoveRepository, type MemoryMoveTask } from './memory-task-move-repository';
import type { MoveProject } from './task-move-repository';
import type { ProjectAccess } from '../projects/project-access';
import type { AuditService } from '../audit/audit-service';

const NOW = new Date('2026-10-24T06:00:00Z');
const project = (id: string, code: string, name: string, status = 'ACTIVE'): MoveProject => ({ id, code, name, status, defaultDueToday: false, color: '#123456', icon: null, imageUrl: null });
const task = (over: Partial<MemoryMoveTask> & Pick<MemoryMoveTask, 'id' | 'key' | 'projectId' | 'columnId'>): MemoryMoveTask => ({
  title: `Task ${over.key}`, description: null, position: 0, priority: 'NORMAL', startDate: null, dueDate: null, estimatedHours: null, actualHours: null,
  progress: 0, isMilestone: false, createdById: 'aisha', completedAt: null, recurrenceRule: null, recurrenceParentId: null, boardDate: null,
  version: 0, createdAt: NOW, updatedAt: NOW, assigneeList: [], ...over,
});
const SARA = { id: 'sara', name: 'Sara Al Balushi' };

const tokenService = createTokenService({
  accessSecret: 'move-access',
  refreshSecret: 'move-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

let events: { projectId: string; event: string; payload: unknown }[] = [];
let audits: unknown[] = [];

async function makeApp() {
  events = [];
  audits = [];
  const repo = createMemoryTaskMoveRepository({
    projects: [project('rig', 'RIG', 'Rig Inspection'), project('ops', 'OPS', 'Operations'), project('adm', 'ADM', 'Admin')],
    columns: [
      { projectId: 'rig', id: 'r-todo', name: 'To do', category: 'TODO', position: 0, enabled: true },
      { projectId: 'ops', id: 'o-todo', name: 'Next', category: 'TODO', position: 0, enabled: true },
      { projectId: 'adm', id: 'a-todo', name: 'To do', category: 'TODO', position: 0, enabled: true },
    ],
    tasks: [
      task({ id: 't1', key: 'RIG-1', title: 'Inspect the rig', projectId: 'rig', columnId: 'r-todo' }),
      task({ id: 't2', key: 'RIG-2', projectId: 'rig', columnId: 'r-todo', assigneeList: [SARA] }),
      task({ id: 'secret', key: 'ADM-1', title: 'Pay rises', projectId: 'adm', columnId: 'a-todo' }),
    ],
    aliases: new Map(),
    teams: new Map([['rig', new Set(['aisha', 'sara'])], ['ops', new Set(['aisha'])]]),
    managers: new Map([['aisha', new Set(['rig', 'ops'])]]),
    admins: new Set(),
    activity: [],
  });
  const taskMoveService = createTaskMoveService({ repo, timeZone: 'Asia/Muscat', now: () => NOW });
  // Aisha can't see the Admin project (or its tasks).
  const projectAccess = {
    async canViewTask(_u: string, _r: string[], taskId: string) { return taskId !== 'secret'; },
    async canViewProject(_u: string, _r: string[], projectId: string) { return projectId !== 'adm'; },
    async canViewColumn() { return true; },
    async accessibleProjectIds() { return ['rig', 'ops']; },
  } as unknown as ProjectAccess;
  const auditService = { async record(entry: unknown) { audits.push(entry); return entry; }, async list() { return []; } } as unknown as AuditService;
  const app = await buildApp({
    authService,
    tokenService,
    taskMoveService,
    projectAccess,
    auditService,
    onTaskEvent: (projectId, event, payload) => { events.push({ projectId, event, payload }); },
  });
  return { app, repo };
}

let app: Awaited<ReturnType<typeof makeApp>>['app'];
let repo: Awaited<ReturnType<typeof makeApp>>['repo'];
beforeEach(async () => {
  ({ app, repo } = await makeApp());
});

describe('GET /tasks/move-targets', () => {
  it('says where the signed-in person may move tasks, and whose tasks', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/move-targets', headers: await bearer('aisha') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      managesAll: false,
      managedProjectIds: ['rig', 'ops'],
      projects: [
        { id: 'rig', code: 'RIG', name: 'Rig Inspection', status: 'ACTIVE', color: '#123456', icon: null, imageUrl: null },
        { id: 'ops', code: 'OPS', name: 'Operations', status: 'ACTIVE', color: '#123456', icon: null, imageUrl: null },
      ],
    });
  });

  it('needs a signed-in user', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/tasks/move-targets' })).statusCode).toBe(401);
  });
});

describe('next to the task routes', () => {
  it('the move routes are never taken for a task id (/tasks/:id)', async () => {
    const { createTaskService } = await import('./task-service');
    const lookups: string[] = [];
    const taskService = createTaskService({
      tasks: { async findById(id: string) { lookups.push(id); return null; } } as never,
      projects: { async getCodeById() { return null; }, async getTaskSettings() { return null; } },
    });
    const repo = createMemoryTaskMoveRepository({ projects: [project('ops', 'OPS', 'Operations')], columns: [], tasks: [], aliases: new Map(), teams: new Map(), managers: new Map(), admins: new Set(), activity: [] });
    const both = await buildApp({ authService, tokenService, taskService, taskMoveService: createTaskMoveService({ repo }) });
    const res = await both.inject({ method: 'GET', url: '/api/v1/tasks/move-targets', headers: await bearer('aisha', ['ADMIN']) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.managesAll).toBe(true);
    expect(lookups).toEqual([]);
  });
});

describe('POST /tasks/move-preview', () => {
  it('says what moving the tasks would change', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/move-preview', headers: await bearer('aisha'), payload: { taskIds: ['t1', 't2'], projectId: 'ops' } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.project).toMatchObject({ id: 'ops', name: 'Operations' });
    expect(data.columns).toEqual([{ id: 'o-todo', name: 'Next', category: 'TODO', position: 0, enabled: true }]);
    expect(data.tasks.map((t: { key: string; newKey: string }) => [t.key, t.newKey])).toEqual([['RIG-1', 'OPS-1'], ['RIG-2', 'OPS-2']]);
    expect(data.outsiders).toEqual([SARA]);
  });

  it('a task the person can’t see is “not found”, without its key, title or project', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/move-preview', headers: await bearer('aisha'), payload: { taskIds: ['secret', 't1'], projectId: 'ops' } });
    expect(res.statusCode).toBe(200);
    const [hidden, shown] = res.json().data.tasks;
    expect(hidden).toEqual({ id: 'secret', key: '', title: '', from: null, canMove: false, reason: 'Task not found.', newKey: null, currentCategory: null, completed: false, columnId: null, milestoneCleared: false, dueDate: null, repeat: null, outsiders: [] });
    expect(shown).toMatchObject({ key: 'RIG-1', newKey: 'OPS-1' });
    expect(res.body).not.toContain('Pay rises');
  });

  it('refuses a request without tasks or a project', async () => {
    const headers = await bearer('aisha');
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/move-preview', headers, payload: { taskIds: [], projectId: 'ops' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/move-preview', headers, payload: { taskIds: ['t1'] } })).statusCode).toBe(400);
  });
});

describe('POST /tasks/:id/move-to-project', () => {
  it('moves the task and tells both projects’ boards: gone from one, new on the other', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/move-to-project', headers: await bearer('aisha'), payload: { projectId: 'ops' } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.task).toMatchObject({ id: 't1', key: 'OPS-1', projectId: 'ops', formerKeys: ['RIG-1'] });
    expect(data.from).toEqual({ projectId: 'rig', name: 'Rig Inspection', key: 'RIG-1' });
    expect(data.to).toEqual({ projectId: 'ops', name: 'Operations', key: 'OPS-1' });
    // The old board drops it (an update: the task now belongs elsewhere — never a deletion, which the
    // apps would show as "This task was deleted"), the new board adds it.
    expect(events.map((e) => [e.projectId, e.event, (e.payload as { id: string; key: string }).key])).toEqual([
      ['rig', 'task:updated', 'OPS-1'],
      ['ops', 'task:created', 'OPS-1'],
    ]);
  });

  it('refuses with the people to choose for when someone assigned isn’t on the new team', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t2/move-to-project', headers: await bearer('aisha'), payload: { projectId: 'ops' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      code: 'ASSIGNEES_NOT_ON_TEAM',
      message: 'Sara Al Balushi isn’t on the Operations team. Choose whether to add them to the team or unassign them.',
      details: { people: [SARA] },
    });
    expect(events).toEqual([]);
  });

  it('adding them to the team is recorded in the audit log', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/t2/move-to-project', headers: await bearer('aisha'), payload: { projectId: 'ops', assignees: 'ADD_TO_TEAM' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.addedToTeam).toEqual([SARA]);
    expect(audits).toEqual([expect.objectContaining({ userId: 'aisha', module: 'members', action: 'member.add', entityId: 'ops', newValue: { userIds: ['sara'], taskId: 't2', reason: 'task moved from Rig Inspection' } })]);
  });

  it('a task the person can’t see is not found; one they can’t move is refused, saying why', async () => {
    const hidden = await app.inject({ method: 'POST', url: '/api/v1/tasks/secret/move-to-project', headers: await bearer('aisha'), payload: { projectId: 'ops' } });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().error.message).toBe('Task not found.');
    const notMine = await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/move-to-project', headers: await bearer('omar'), payload: { projectId: 'ops' } });
    expect(notMine.statusCode).toBe(403);
    expect(notMine.json().error.message).toBe('You need to manage Rig Inspection to move its tasks.');
  });

  it('checks what it is sent', async () => {
    const headers = await bearer('aisha');
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/move-to-project', headers, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/tasks/t1/move-to-project', headers, payload: { projectId: 'ops', assignees: 'MAYBE' } })).statusCode).toBe(400);
  });
});

describe('POST /tasks/move-to-project (many)', () => {
  it('reports each task, moves the ones it can and tells the boards about those', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/move-to-project', headers: await bearer('aisha'), payload: { taskIds: ['t1', 'secret', 't2'], projectId: 'ops' } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.moved).toBe(1);
    expect(data.failed).toBe(2);
    expect(data.results.map((r: { taskId: string; ok: boolean; error?: { code: string } }) => [r.taskId, r.ok, r.error?.code ?? null])).toEqual([
      ['t1', true, null],
      ['secret', false, 'NOT_FOUND'],
      ['t2', false, 'ASSIGNEES_NOT_ON_TEAM'],
    ]);
    expect(data.results[1].error.message).toBe('Task not found.');
    expect(events.map((e) => [e.projectId, e.event])).toEqual([
      ['rig', 'task:updated'],
      ['ops', 'task:created'],
    ]);
    expect(repo.state.tasks.find((t) => t.id === 'secret')!.projectId).toBe('adm');
  });

  it('a destination the person can’t move tasks into refuses the whole request', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/tasks/move-to-project', headers: await bearer('aisha'), payload: { taskIds: ['t1'], projectId: 'adm' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('You need to manage Admin to move tasks into it.');
  });
});

describe('when the audit log can’t be written after a move', () => {
  async function appWithFailingAudit() {
    const made = await makeApp();
    const errors: unknown[][] = [];
    const logger = { error: (...a: unknown[]) => { errors.push(a); }, warn: () => {}, info: () => {}, debug: () => {}, child: () => logger };
    const auditService = { async record() { throw new Error('audit table is down'); }, async list() { return []; } } as unknown as AuditService;
    const projectAccess = { async canViewTask() { return true; }, async canViewProject() { return true; }, async canViewColumn() { return true; }, async accessibleProjectIds() { return null; } } as unknown as ProjectAccess;
    const failing = await buildApp({
      authService,
      tokenService,
      taskMoveService: createTaskMoveService({ repo: made.repo, timeZone: 'Asia/Muscat', now: () => NOW }),
      projectAccess,
      auditService,
      logger: logger as never,
      onTaskEvent: (projectId, event, payload) => { events.push({ projectId, event, payload }); },
    });
    return { app: failing, errors, repo: made.repo };
  }

  it('the saved move still answers 200, both boards hear it, and the failure is logged', async () => {
    const { app: failing, errors } = await appWithFailingAudit();
    const res = await failing.inject({ method: 'POST', url: '/api/v1/tasks/t2/move-to-project', headers: await bearer('aisha'), payload: { projectId: 'ops', assignees: 'ADD_TO_TEAM' } });
    expect(res.statusCode).toBe(200);
    expect(events.map((e) => [e.projectId, e.event])).toEqual([['rig', 'task:updated'], ['ops', 'task:created']]);
    expect(errors).toHaveLength(1);
  });

  it('moving several: every moved task is still announced, and all the results come back', async () => {
    const { app: failing, repo: state } = await appWithFailingAudit();
    state.state.tasks.push({ ...state.state.tasks.find((t) => t.id === 't2')!, id: 't3', key: 'RIG-3', assigneeList: [SARA] });
    const res = await failing.inject({ method: 'POST', url: '/api/v1/tasks/move-to-project', headers: await bearer('aisha'), payload: { taskIds: ['t2', 't3'], projectId: 'ops', assignees: 'ADD_TO_TEAM' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.moved).toBe(2);
    expect(events.filter((e) => e.event === 'task:created')).toHaveLength(2);
  });
});
