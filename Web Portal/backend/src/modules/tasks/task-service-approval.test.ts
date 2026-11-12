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
  it('a tick sent (on or off) wins over the project’s setting — when whoever runs the project sends it', async () => {
    expect((await s.make({ projectId: 'p2', columnId: 'q-todo', needsApproval: false, by: 'omar' })).needsApproval).toBe(false);
    expect((await s.make({ projectId: 'p2', columnId: 'q-todo', needsApproval: false, by: 'admin' })).needsApproval).toBe(false);
    expect((await s.make({ needsApproval: true })).needsApproval).toBe(true);
  });
  it('someone who doesn’t run the project can’t leave it off where the project ticks new tasks: it is kept on (owner, 30 Oct)', async () => {
    const t = await s.make({ projectId: 'p2', columnId: 'q-todo', needsApproval: false });
    expect(t.needsApproval).toBe(true);
    expect(s.rows.get(t.id)!.needsApproval).toBe(true);
  });
  it('where the project doesn’t tick new tasks, anyone may leave it off (or tick it)', async () => {
    expect((await s.make({ needsApproval: false })).needsApproval).toBe(false);
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
  it('when it isn’t waiting: only whoever runs the project or an admin (owner, 30 Oct) — anyone else is refused in plain words, nothing saved', async () => {
    const t = await s.make({ needsApproval: true });
    await expect(s.svc.updateTask(t.id, { needsApproval: false }, undefined, 'one', 'sara')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(s.svc.updateTask(t.id, { needsApproval: false }, undefined, 'one', 'sara')).rejects.toThrow('Only the project’s managers can turn off approval for this task.');
    expect(s.rows.get(t.id)).toMatchObject({ needsApproval: true, version: 0 });
    expect(await s.svc.updateTask(t.id, { needsApproval: false }, undefined, 'one', 'omar')).toMatchObject({ needsApproval: false, columnId: 'doing' });
    const u = await s.make({ needsApproval: true });
    expect(await s.svc.updateTask(u.id, { needsApproval: false }, undefined, 'one', 'admin')).toMatchObject({ needsApproval: false });
  });
  it('without a person (no actor) it can’t be turned off either', async () => {
    const t = await s.make({ needsApproval: true });
    await expect(s.svc.updateTask(t.id, { needsApproval: false })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('unticked in the same edit that moves it to Done: refused for someone who doesn’t run the project — it can’t skip approval', async () => {
    const t = await s.make({ needsApproval: true });
    await expect(s.svc.updateTask(t.id, { needsApproval: false, columnId: 'done' }, undefined, 'one', 'sara')).rejects.toBeInstanceOf(ForbiddenError);
    expect(s.rows.get(t.id)).toMatchObject({ needsApproval: true, columnId: 'doing', completedAt: null, approvalRequestedAt: null });
    expect(s.moved).toEqual([]);
  });
  it('anyone who can edit it may turn it on', async () => {
    const t = await s.make();
    expect(await s.svc.updateTask(t.id, { needsApproval: true }, undefined, 'one', 'sara')).toMatchObject({ needsApproval: true });
  });
  it('an edit that leaves it out (Android 1.11, the extension) changes nothing about it — and isn’t refused', async () => {
    const t = await s.make({ needsApproval: true });
    expect(await s.svc.updateTask(t.id, { title: 'Inspection report, rev 2' }, undefined, 'one', 'sara')).toMatchObject({ title: 'Inspection report, rev 2', needsApproval: true });
  });
  it('sending it as it already is isn’t a change: off on a task without it, on on a task with it', async () => {
    const off = await s.make();
    expect(await s.svc.updateTask(off.id, { needsApproval: false, title: 'Plain' }, undefined, 'one', 'sara')).toMatchObject({ needsApproval: false, title: 'Plain' });
    const on = await s.make({ needsApproval: true });
    expect(await s.svc.updateTask(on.id, { needsApproval: true, title: 'Ticked' }, undefined, 'one', 'sara')).toMatchObject({ needsApproval: true, title: 'Ticked' });
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

describe('what the review found', () => {
  it('a move made from a waiting copy that an approval overtook is refused, never half-applied', async () => {
    const t = await s.make({ needsApproval: true });
    const waiting = await s.svc.moveTask(t.id, 'done', undefined, 'sara');
    // Sara drags it back while Omar approves it: her move was read while it still waited.
    const tasks = s.rows;
    const stale = { ...tasks.get(waiting.id)! };
    await s.svc.approveTask(waiting.id, 'omar');
    const approved = { ...tasks.get(waiting.id)! };
    tasks.set(waiting.id, stale); // the move reads the old copy…
    const read = s.svc.moveTask(waiting.id, 'doing', undefined, 'sara');
    tasks.set(waiting.id, approved); // …and writes after the approval
    await expect(read).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(tasks.get(waiting.id)).toMatchObject({ columnId: 'done', completedAt: NOW });
  });

  it('created straight into Done in a project with only Done columns: refused, not completed without approval', async () => {
    const all = setup();
    await expect(all.svc.createTask({ title: 'x', projectId: 'p3', columnId: 'z-done', createdById: 'sara', needsApproval: true })).rejects.toMatchObject({ status: 409, code: 'NO_OPEN_COLUMN' });
  });

  it('a step after an approval or a send-back that fails never turns the saved decision into a failure', async () => {
    const errors: unknown[] = [];
    const w = setup({}, { failMoved: true, onError: (e) => errors.push(e) });
    const t = await w.make({ needsApproval: true });
    await w.svc.moveTask(t.id, 'done', undefined, 'sara').catch(() => undefined);
    expect(await w.svc.sendBackTask(t.id, 'omar', 'Redo')).toMatchObject({ columnId: 'doing', approvalRequestedAt: null });
    expect(errors).toHaveLength(1);
  });
});


// tbk: bulk lane — Undo of a bulk "Done" that left a task waiting where it was (a project with no Review column).
describe('withdrawing a request (Undo of a bulk Done)', () => {
  it('a waiting task stops waiting where it is; its people are told the request was withdrawn', async () => {
    const t = await s.make({ projectId: 'p2', columnId: 'q-doing' });
    await s.svc.moveTask(t.id, 'q-done', undefined, 'sara');
    const after = await s.svc.withdrawApproval(t.id, 'sara');
    expect(after).toMatchObject({ columnId: 'q-doing', approvalRequestedAt: null, approvalRequestedById: null, completedAt: null });
    expect(s.moved.at(-1)).toMatchObject({ taskId: t.id, approval: 'WITHDRAWN' });
  });
  it('a task that isn’t waiting is left as it is', async () => {
    const t = await s.make();
    const n = s.moved.length;
    expect(await s.svc.withdrawApproval(t.id, 'sara')).toMatchObject({ id: t.id, approvalRequestedAt: null });
    expect(s.moved.length).toBe(n);
  });
});
