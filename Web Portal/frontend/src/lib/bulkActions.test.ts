import { describe, it, expect, vi } from 'vitest';
import { runBulk, type BulkDeps } from './bulkActions';

const tasks = [
  { id: 't1', projectId: 'p1' },
  { id: 't2', projectId: 'p2' },
];

const baseDeps = (): BulkDeps => ({
  update: vi.fn(async () => {}),
  move: vi.fn(async () => {}),
  assign: vi.fn(async () => {}),
  doneColumnFor: vi.fn(async () => null),
});

describe('runBulk', () => {
  it('completes each task by moving it to its own project’s done column', async () => {
    const deps = baseDeps();
    deps.doneColumnFor = vi.fn(async (t) => (t.projectId === 'p1' ? 'done1' : 'done2'));
    const r = await runBulk(tasks, { type: 'complete' }, deps);
    expect(r).toEqual({ succeeded: 2, failed: 0 });
    expect(deps.move).toHaveBeenCalledWith('t1', 'done1');
    expect(deps.move).toHaveBeenCalledWith('t2', 'done2');
  });

  it('counts a task with no resolvable done column as failed (and never moves it)', async () => {
    const deps = baseDeps();
    const r = await runBulk([{ id: 't1', projectId: 'p1' }], { type: 'complete' }, deps);
    expect(r).toEqual({ succeeded: 0, failed: 1 });
    expect(deps.move).not.toHaveBeenCalled();
  });

  it('sets a due date on every task via update', async () => {
    const deps = baseDeps();
    const r = await runBulk(tasks, { type: 'setDueDate', dueDate: '2026-01-01' }, deps);
    expect(r.succeeded).toBe(2);
    expect(deps.update).toHaveBeenCalledWith('t1', { dueDate: '2026-01-01' });
    expect(deps.update).toHaveBeenCalledWith('t2', { dueDate: '2026-01-01' });
  });

  it('assigns a user to every task', async () => {
    const deps = baseDeps();
    await runBulk(tasks, { type: 'assign', userId: 'u9' }, deps);
    expect(deps.assign).toHaveBeenCalledWith('t1', 'u9');
    expect(deps.assign).toHaveBeenCalledWith('t2', 'u9');
  });

  it('moves every task to a given column', async () => {
    const deps = baseDeps();
    await runBulk(tasks, { type: 'move', columnId: 'c5' }, deps);
    expect(deps.move).toHaveBeenCalledWith('t1', 'c5');
    expect(deps.move).toHaveBeenCalledWith('t2', 'c5');
  });

  it('records per-task failures without aborting the batch', async () => {
    const deps = baseDeps();
    deps.update = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValue({});
    const r = await runBulk(tasks, { type: 'setPriority', priority: 'HIGH' }, deps);
    expect(r).toEqual({ succeeded: 1, failed: 1 });
    expect(deps.update).toHaveBeenCalledWith('t2', { priority: 'HIGH' });
  });
});
