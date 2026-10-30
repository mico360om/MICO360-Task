import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { createTokenService } from '../auth/token-service';
import { createAuthService } from '../auth/auth-service';
import type { ProjectAccess } from '../projects/project-access';
import type { AuditService } from '../audit/audit-service';
import { approvalWorld, APPROVERS } from './task-approval.fixture';
import { isAwaitingApproval } from './task-approval';
import type { ApprovalSource } from './task-approval-routes';

const tokenService = createTokenService({
  accessSecret: 'approve-access',
  refreshSecret: 'approve-refresh',
  accessTtl: 900,
  refreshTtl: 1000,
  refreshStore: { async save() {}, async findValid() { return null; }, async revoke() {}, async revokeAllForUser() {} },
});
const authService = createAuthService({
  users: { async findByIdentifier() { return null; }, async findById() { return null; }, async applyFailedAttempt() {}, async resetFailedAttempts() {} },
  maxAttempts: 5,
});
const bearer = async (id: string, roles = ['EMPLOYEE']) => ({ authorization: `Bearer ${(await tokenService.issueTokens({ id, roles })).accessToken}` });

let world: ReturnType<typeof approvalWorld>;
let audits: { action: string; entityId: string; newValue: Record<string, unknown> }[];
let events: { projectId: string; event: string }[];
let app: Awaited<ReturnType<typeof buildApp>>;
let waitingId = '';
let hiddenId = '';

beforeEach(async () => {
  // Project p2 ticks its new tasks ("New tasks in this project need approval").
  world = approvalWorld({ p2: { newTasksNeedApproval: true } });
  audits = [];
  events = [];
  const t = await world.make({ needsApproval: true });
  waitingId = (await world.svc.moveTask(t.id, 'done', undefined, 'sara')).id;
  const h = await world.make({ projectId: 'p2', columnId: 'q-doing', needsApproval: true });
  hiddenId = (await world.svc.moveTask(h.id, 'q-done', undefined, 'sara')).id;
  const source: ApprovalSource = {
    async list(v) {
      if (!APPROVERS.has(v.id)) return [];
      return [...world.rows.values()]
        .filter((r) => isAwaitingApproval(r))
        .map((r) => ({ ...r, project: { id: r.projectId, code: 'RIG', name: 'Rig', color: null, icon: null, imageUrl: null }, requestedBy: { id: 'sara', name: 'Sara' } }));
    },
    async canApproveAny(v) {
      return APPROVERS.has(v.id);
    },
  };
  app = await buildApp({
    authService,
    tokenService,
    taskService: world.svc,
    approvalSource: source,
    // Omar can't see project p2's tasks.
    projectAccess: {
      async canViewTask(u: string, _r: string[], taskId: string) { return !(u === 'omar' && taskId === hiddenId); },
      async canViewProject() { return true; },
      async canViewColumn() { return true; },
      async accessibleProjectIds() { return null; },
    } as unknown as ProjectAccess,
    auditService: { async record(e: never) { audits.push(e); return e; }, async list() { return []; } } as unknown as AuditService,
    onTaskEvent: (projectId, event) => { events.push({ projectId, event }); },
  });
});

describe('GET /tasks/approvals', () => {
  it('the waiting tasks a person can approve, and whether they approve at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/approvals', headers: await bearer('omar') });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.canApprove).toBe(true);
    expect(res.json().data.tasks.map((t: { id: string }) => t.id)).toContain(waitingId);
  });
  it('someone who approves nothing: an empty list, canApprove false', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/approvals', headers: await bearer('sara') });
    expect(res.json().data).toEqual({ canApprove: false, tasks: [] });
  });
  it('needs a signed-in person', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/tasks/approvals' })).statusCode).toBe(401);
  });
});

describe('POST /tasks/:id/approve', () => {
  it('an approver: done, written to the audit log, open boards told', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/approve`, headers: await bearer('omar'), payload: { expectedVersion: world.rows.get(waitingId)!.version } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: waitingId, columnId: 'done', approvedById: 'omar', approvalRequestedAt: null });
    expect(audits).toEqual([expect.objectContaining({ action: 'task.approve', module: 'tasks', entityId: waitingId })]);
    expect(events).toEqual([{ projectId: 'p1', event: 'task:moved' }]);
  });
  it('someone who can’t approve: 403 in plain words, nothing changes', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/approve`, headers: await bearer('sara'), payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('Only the people who run this project can approve its tasks or send them back.');
    expect(isAwaitingApproval(world.rows.get(waitingId)!)).toBe(true);
    expect(audits).toEqual([]);
  });
  it('a task the person can’t open: 404', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/tasks/${hiddenId}/approve`, headers: await bearer('omar'), payload: {} });
    expect(res.statusCode).toBe(404);
  });
  it('not waiting any more: 409 NOT_WAITING; from an old copy: 409 VERSION_CONFLICT', async () => {
    const stale = await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/approve`, headers: await bearer('omar'), payload: { expectedVersion: 0 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/approve`, headers: await bearer('omar'), payload: {} });
    const again = await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/approve`, headers: await bearer('admin', ['ADMIN']), payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toEqual({ code: 'NOT_WAITING', message: 'This task isn’t waiting for approval any more.' });
  });
});

describe('POST /tasks/:id/send-back', () => {
  it('with a reason: back in progress, the reason in the audit log', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/send-back`, headers: await bearer('omar'), payload: { reason: ' Wrong revision ' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ columnId: 'doing', approvalRequestedAt: null });
    expect(audits).toEqual([expect.objectContaining({ action: 'task.send-back', newValue: expect.objectContaining({ reason: 'Wrong revision' }) })]);
    expect(world.moved.at(-1)).toMatchObject({ approval: 'SENT_BACK', reason: 'Wrong revision' });
  });
  it('without a reason: 400 in plain words, nothing changes', async () => {
    for (const payload of [{ reason: '   ' }, {}]) {
      const res = await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/send-back`, headers: await bearer('omar'), payload });
      expect(res.statusCode).toBe(400);
    }
    const blank = await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/send-back`, headers: await bearer('omar'), payload: { reason: ' ' } });
    expect(blank.json().error.message).toBe('Say why you’re sending it back.');
    expect(isAwaitingApproval(world.rows.get(waitingId)!)).toBe(true);
  });
  it('someone who can’t approve: 403', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/tasks/${waitingId}/send-back`, headers: await bearer('bilal'), payload: { reason: 'No' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('the task API carries the tick', () => {
  it('create with needsApproval, and an edit that turns it on', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: await bearer('sara'), payload: { title: 'Datasheet', projectId: 'p1', columnId: 'todo', needsApproval: true, assigneeIds: [] } });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.needsApproval).toBe(true);
    const plain = await world.make();
    const edited = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${plain.id}`, headers: await bearer('sara'), payload: { needsApproval: true } });
    expect(edited.json().data.needsApproval).toBe(true);
  });
  it('a move to Done by someone who can’t approve answers with the task where it waits', async () => {
    const t = await world.make({ needsApproval: true });
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/tasks/${t.id}/move`, headers: await bearer('sara'), payload: { columnId: 'done' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ columnId: 'rev', completedAt: null, approvalRequestedById: 'sara' });
  });
});

describe('turning approval off: only the project’s managers and admins (owner, 30 Oct)', () => {
  it('someone on the team who doesn’t run it: PUT needsApproval false → 403 in plain words, nothing changes', async () => {
    const t = await world.make({ needsApproval: true });
    const res = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${t.id}`, headers: await bearer('sara'), payload: { needsApproval: false } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('Only the project’s managers can turn off approval for this task.');
    expect(world.rows.get(t.id)).toMatchObject({ needsApproval: true, version: 0 });
  });
  it('whoever runs the project, and an admin: 200, turned off', async () => {
    const t = await world.make({ needsApproval: true });
    const res = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${t.id}`, headers: await bearer('omar'), payload: { needsApproval: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.needsApproval).toBe(false);
    const u = await world.make({ needsApproval: true });
    expect((await app.inject({ method: 'PUT', url: `/api/v1/tasks/${u.id}`, headers: await bearer('admin', ['ADMIN']), payload: { needsApproval: false } })).json().data.needsApproval).toBe(false);
  });
  it('an edit from an older app that leaves the field out changes nothing about it', async () => {
    const t = await world.make({ needsApproval: true });
    const res = await app.inject({ method: 'PUT', url: `/api/v1/tasks/${t.id}`, headers: await bearer('sara'), payload: { title: 'Pressure test, rev 2' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ title: 'Pressure test, rev 2', needsApproval: true });
  });
  it('creating in a project that ticks new tasks: kept on for someone who doesn’t run it, even when they send false; off for its manager', async () => {
    const sara = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: await bearer('sara'), payload: { title: 'Valve log', projectId: 'p2', columnId: 'q-todo', needsApproval: false, assigneeIds: [] } });
    expect(sara.statusCode).toBe(201);
    expect(sara.json().data.needsApproval).toBe(true);
    const omar = await app.inject({ method: 'POST', url: '/api/v1/tasks', headers: await bearer('omar'), payload: { title: 'Valve log', projectId: 'p2', columnId: 'q-todo', needsApproval: false, assigneeIds: [] } });
    expect(omar.json().data.needsApproval).toBe(false);
  });
});
