import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, ForbiddenError, ValidationError } from '../../lib/http-errors';
import { approvalWorld as setup, NOW } from './task-approval.fixture';

let s: ReturnType<typeof setup>;
beforeEach(() => {
  s = setup({ p2: { newTasksNeedApproval: true } });
});

describe('creating a task', () => {
  it('takes the project’s "New tasks need approval" when it doesn’t say', async () => {
    expect((await s.make({ projectId: 'p2', columnId: 'q-todo' })).needsApproval).toBe(true);
    expect((await s.make()).needsApproval).toBe(false);
  });
  it('a tick sent (on or off) wins over the project’s setting', async () => {
    expect((await s.make({ projectId: 'p2', columnId: 'q-todo', needsApproval: false })).needsApproval).toBe(false);
    expect((await s.make({ needsApproval: true })).needsApproval).toBe(true);
  });
  it('straight into Done by someone who can’t approve: it waits in Review instead', async () => {
    const t = await s.make({ columnId: 'done', needsApproval: true });
    expect(t).toMatchObject({ columnId: 'rev', completedAt: null, approvalRequestedAt: NOW, approvalRequestedById: 'sara' });
    expect(s.moved).toEqual([{ taskId: t.id, prev: 'rev', actor: 'sara', approval: 'REQUESTED' }]);
  });
  it('straight into Done without a Review column: it waits in the first open column', async () => {
    const t = await s.make({ projectId: 'p2', columnId: 'q-done' });
    expect(t).toMatchObject({ columnId: 'q-todo', completedAt: null, approvalRequestedAt: NOW });
  });
  it('straight into Done by an approver: done, approved by them', async () => {
    const t = await s.make({ columnId: 'done', needsApproval: true, by: 'omar' });
    expect(t).toMatchObject({ columnId: 'done', completedAt: NOW, approvedAt: NOW, approvedById: 'omar', approvalRequestedAt: null });
  });
});

describe('finishing a task that needs approval', () => {
  it('moved to Done by someone who can’t approve: waits in Review, not done', async () => {
    const t = await s.make({ needsApproval: true });
    const after = await s.svc.moveTask(t.id, 'done', undefined, 'sara');
    expect(after).toMatchObject({ columnId: 'rev', columnCategory: 'REVIEW', completedAt: null, approvalRequestedAt: NOW, approvalRequestedById: 'sara' });
    expect(s.moved.at(-1)).toEqual({ taskId: t.id, prev: 'doing', actor: 'sara', approval: 'REQUESTED' });
  });
  it('the same through an edit (PUT with a Done column)', async () => {
    const t = await s.make({ needsApproval: true });
    expect(await s.svc.updateTask(t.id, { columnId: 'done' }, undefined, 'one', 'sara')).toMatchObject({ columnId: 'rev', completedAt: null, approvalRequestedById: 'sara' });
  });
  it('without a Review column it stays in its column, waiting, and the move is still told', async () => {
    const t = await s.make({ projectId: 'p2', columnId: 'q-doing' });
    expect(await s.svc.moveTask(t.id, 'q-done', undefined, 'sara')).toMatchObject({ columnId: 'q-doing', completedAt: null, approvalRequestedAt: NOW });
    expect(s.moved.at(-1)).toMatchObject({ prev: 'q-doing', approval: 'REQUESTED' });
  });
  it('finished again while waiting: nothing changes (no write, no notice)', async () => {
    const t = await s.make({ needsApproval: true });
    const waiting = await s.svc.moveTask(t.id, 'done', undefined, 'sara');
    const n = s.moved.length;
    const again = await s.svc.moveTask(t.id, 'done', 0, 'sara');
    expect(again).toMatchObject({ columnId: 'rev', version: waiting.version });
    expect(s.moved.length).toBe(n);
  });
  it('an approver finishing it: done at once, approved by them', async () => {
    const t = await s.make({ needsApproval: true });
    expect(await s.svc.moveTask(t.id, 'done', undefined, 'omar')).toMatchObject({ columnId: 'done', completedAt: NOW, progress: 100, approvedById: 'omar' });
    expect(s.moved.at(-1)).toMatchObject({ approval: 'APPROVED_ON_FINISH' });
  });
  it('an approver moving a waiting task to Done approves it', async () => {
    const t = await s.make({ needsApproval: true });
    await s.svc.moveTask(t.id, 'done', undefined, 'sara');
    expect(await s.svc.moveTask(t.id, 'done', undefined, 'admin')).toMatchObject({ columnId: 'done', completedAt: NOW, approvedById: 'admin', approvalRequestedAt: null });
    expect(s.moved.at(-1)).toMatchObject({ prev: 'rev', approval: 'APPROVED' });
  });
  it('moved back by hand to In progress: the request is withdrawn', async () => {
    const t = await s.make({ needsApproval: true });
    await s.svc.moveTask(t.id, 'done', undefined, 'sara');
    expect(await s.svc.moveTask(t.id, 'doing', undefined, 'sara')).toMatchObject({ columnId: 'doing', approvalRequestedAt: null, approvalRequestedById: null });
    expect(s.moved.at(-1)).toMatchObject({ approval: 'WITHDRAWN' });
  });
  it('re-opening an approved task clears its approval; finishing it again waits again', async () => {
    const t = await s.make({ needsApproval: true });
    await s.svc.moveTask(t.id, 'done', undefined, 'omar');
    expect(await s.svc.moveTask(t.id, 'doing', undefined, 'sara')).toMatchObject({ completedAt: null, approvedAt: null, approvedById: null });
    expect(await s.svc.moveTask(t.id, 'done', undefined, 'sara')).toMatchObject({ columnId: 'rev', approvalRequestedAt: NOW });
  });
  it('a task that doesn’t need approval completes as before', async () => {
    const t = await s.make();
    expect(await s.svc.moveTask(t.id, 'done', undefined, 'sara')).toMatchObject({ columnId: 'done', completedAt: NOW, approvalRequestedAt: null });
    expect(s.moved.at(-1)).toEqual({ taskId: t.id, prev: 'doing', actor: 'sara' });
  });
  it('ticked in the same edit that moves it to Done: it waits', async () => {
    const t = await s.make();
    expect(await s.svc.updateTask(t.id, { needsApproval: true, columnId: 'done' }, undefined, 'one', 'sara')).toMatchObject({ needsApproval: true, columnId: 'rev', completedAt: null });
  });
});

describe('turning "Needs approval" off', () => {
  it('while it waits: only an approver — then it completes in the first Done column', async () => {
    const t = await s.make({ needsApproval: true });
    await s.svc.moveTask(t.id, 'done', undefined, 'sara');
    await expect(s.svc.updateTask(t.id, { needsApproval: false }, undefined, 'one', 'sara')).rejects.toBeInstanceOf(ForbiddenError);
    expect(await s.svc.updateTask(t.id, { needsApproval: false }, undefined, 'one', 'omar')).toMatchObject({ needsApproval: false, columnId: 'done', completedAt: NOW, approvalRequestedAt: null });
    expect(s.moved.at(-1)).toMatchObject({ prev: 'rev', actor: 'omar', approval: 'SWITCHED_OFF' });
  });
  it('when it isn’t waiting: anyone who can edit it', async () => {
    const t = await s.make({ needsApproval: true });
    expect(await s.svc.updateTask(t.id, { needsApproval: false }, undefined, 'one', 'sara')).toMatchObject({ needsApproval: false, columnId: 'doing' });
  });
});

describe('approve', () => {
  async function waitingTask() {
    const t = await s.make({ needsApproval: true });
    return s.svc.moveTask(t.id, 'done', undefined, 'sara');
  }
  it('moves it to the first Done column: done now, approved by them', async () => {
    const w = await waitingTask();
    const after = await s.svc.approveTask(w.id, 'omar', { expectedVersion: w.version });
    expect(after).toMatchObject({ columnId: 'done', completedAt: NOW, progress: 100, approvedAt: NOW, approvedById: 'omar', approvalRequestedAt: null, approvalRequestedById: null });
    expect(s.moved.at(-1)).toEqual({ taskId: w.id, prev: 'rev', actor: 'omar', approval: 'APPROVED' });
  });
  it('only by someone who runs the project (or an admin)', async () => {
    const w = await waitingTask();
    await expect(s.svc.approveTask(w.id, 'sara')).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('a task that isn’t waiting (approved already, or never asked): 409 NOT_WAITING', async () => {
    const w = await waitingTask();
    await s.svc.approveTask(w.id, 'omar');
    await expect(s.svc.approveTask(w.id, 'admin')).rejects.toMatchObject({ code: 'NOT_WAITING', status: 409 });
    const plain = await s.make();
    await expect(s.svc.approveTask(plain.id, 'omar')).rejects.toMatchObject({ code: 'NOT_WAITING' });
  });
  it('from an old copy: 409 VERSION_CONFLICT', async () => {
    const w = await waitingTask();
    await expect(s.svc.approveTask(w.id, 'omar', { expectedVersion: w.version - 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
  it('two approvers at once: one approval; the other hears it isn’t waiting any more', async () => {
    const w = await waitingTask();
    const results = await Promise.allSettled([s.svc.approveTask(w.id, 'omar'), s.svc.approveTask(w.id, 'admin')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConflictError);
    expect(failed.reason.code).toBe('NOT_WAITING');
    expect(s.moved.filter((m) => m.approval === 'APPROVED')).toHaveLength(1);
  });
});

describe('send back', () => {
  async function waitingTask(projectId = 'p1', columnId = 'doing') {
    const t = await s.make({ projectId, columnId, needsApproval: true });
    return s.svc.moveTask(t.id, projectId === 'p1' ? 'done' : 'q-done', undefined, 'sara');
  }
  it('returns it to the first In progress column, with the reason for the notices and the comment', async () => {
    const w = await waitingTask();
    const after = await s.svc.sendBackTask(w.id, 'omar', '  Please add the pressure readings.  ', { expectedVersion: w.version });
    expect(after).toMatchObject({ columnId: 'doing', completedAt: null, approvalRequestedAt: null, approvalRequestedById: null });
    expect(s.moved.at(-1)).toEqual({ taskId: w.id, prev: 'rev', actor: 'omar', approval: 'SENT_BACK', reason: 'Please add the pressure readings.' });
  });
  it('a reason is required', async () => {
    const w = await waitingTask();
    await expect(s.svc.sendBackTask(w.id, 'omar', '   ')).rejects.toBeInstanceOf(ValidationError);
    await expect(s.svc.sendBackTask(w.id, 'omar', 'x'.repeat(2001))).rejects.toBeInstanceOf(ValidationError);
    expect(s.rows.get(w.id)!.approvalRequestedAt).toEqual(NOW);
  });
  it('only by an approver, and only while it waits', async () => {
    const w = await waitingTask();
    await expect(s.svc.sendBackTask(w.id, 'sara', 'No')).rejects.toBeInstanceOf(ForbiddenError);
    await s.svc.sendBackTask(w.id, 'omar', 'Redo');
    await expect(s.svc.sendBackTask(w.id, 'omar', 'Again')).rejects.toMatchObject({ code: 'NOT_WAITING' });
  });
  it('waiting where it was (no Review column): goes back to In progress all the same, and is told', async () => {
    const w = await waitingTask('p2', 'q-doing');
    expect(await s.svc.sendBackTask(w.id, 'omar', 'Check the totals')).toMatchObject({ columnId: 'q-doing', approvalRequestedAt: null });
    expect(s.moved.at(-1)).toMatchObject({ prev: 'q-doing', approval: 'SENT_BACK' });
  });
});
