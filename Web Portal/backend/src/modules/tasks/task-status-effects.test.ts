import { describe, it, expect, vi } from 'vitest';
import { createStatusChangeEffects, type StatusEffectsDeps } from './task-status-effects';
import type { TaskRecord } from './task-repository';

const NOW = new Date('2026-10-24T06:00:00Z');
const COLUMNS: Record<string, { name: string; category: string }> = {
  todo: { name: 'To do', category: 'TODO' },
  doing: { name: 'Doing', category: 'IN_PROGRESS' },
  done: { name: 'Finished', category: 'DONE' },
};
const task = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't1', key: 'OPS-17', title: 'Inspect the rig', description: null, projectId: 'ops', columnId: 'done', position: 0, priority: 'NORMAL', startDate: null, dueDate: null,
  estimatedHours: null, actualHours: null, progress: 100, createdById: 'aisha', completedAt: NOW, recurrenceRule: null, recurrenceParentId: null, boardDate: null,
  version: 2, createdAt: NOW, updatedAt: NOW, ...over,
});

function world(over: Partial<StatusEffectsDeps> = {}) {
  const deps = {
    column: vi.fn(async (id: string) => COLUMNS[id] ?? null),
    nextCopy: vi.fn(async () => ({ id: 'copy1' })),
    announceCopy: vi.fn(async () => {}),
    followActionItems: vi.fn(async () => {}),
    recipients: vi.fn(async () => ['omar']),
    notify: vi.fn(async () => undefined),
    record: vi.fn(async () => undefined),
    onError: vi.fn(),
    ...over,
  };
  return { deps, statusChanged: createStatusChangeEffects(deps) };
}

describe('What a status change does', () => {
  it('completing a repeating task: its next copy, its action items, a notice to its followers and a timeline line', async () => {
    const w = world();
    await w.statusChanged(task({ recurrenceRule: { freq: 'WEEKLY', interval: 1 } }), 'doing', 'aisha');
    expect(w.deps.nextCopy).toHaveBeenCalledTimes(1);
    expect(w.deps.announceCopy).toHaveBeenCalledWith('copy1', 'ops');
    expect(w.deps.followActionItems).toHaveBeenCalledWith('t1', true);
    expect(w.deps.recipients).toHaveBeenCalledWith('t1', 'aisha');
    expect(w.deps.notify).toHaveBeenCalledWith({ userId: 'omar', type: 'TASK_STATUS', title: 'Task moved to Finished', body: 'OPS-17 · Inspect the rig', entityType: 'task', entityId: 't1' });
    expect(w.deps.record).toHaveBeenCalledWith({ taskId: 't1', projectId: 'ops', userId: 'aisha', action: 'COMPLETED', meta: { from: 'Doing', to: 'Finished' } });
  });

  it('re-opening, and a plain move between open columns', async () => {
    const w = world();
    await w.statusChanged(task({ columnId: 'todo', completedAt: null }), 'done', 'aisha');
    expect(w.deps.followActionItems).toHaveBeenCalledWith('t1', false);
    expect(w.deps.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'REOPENED', meta: { from: 'Finished', to: 'To do' } }));
    await w.statusChanged(task({ columnId: 'doing', completedAt: null }), 'todo', 'aisha');
    expect(w.deps.followActionItems).toHaveBeenCalledTimes(1);
    expect(w.deps.record).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'MOVED', meta: { from: 'To do', to: 'Doing' } }));
    expect(w.deps.nextCopy).not.toHaveBeenCalled();
  });

  it('quietly (a move to another project, which sends its own one notice): everything but the notice', async () => {
    const w = world();
    await w.statusChanged(task({ recurrenceRule: { freq: 'WEEKLY', interval: 1 } }), 'doing', 'aisha', { notify: false });
    expect(w.deps.notify).not.toHaveBeenCalled();
    expect(w.deps.nextCopy).toHaveBeenCalledTimes(1);
    expect(w.deps.followActionItems).toHaveBeenCalledWith('t1', true);
    expect(w.deps.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'COMPLETED' }));
  });

  it('a reorder within a column is no status change; action items that can’t follow are reported, the rest goes on', async () => {
    const w = world({ followActionItems: vi.fn(async () => Promise.reject(new Error('down'))) });
    await w.statusChanged(task(), 'done', 'aisha');
    expect(w.deps.record).not.toHaveBeenCalled();
    await w.statusChanged(task(), 'doing', 'aisha');
    expect(w.deps.onError).toHaveBeenCalledWith(expect.any(Error), 't1');
    expect(w.deps.notify).toHaveBeenCalledTimes(1);
    expect(w.deps.record).toHaveBeenCalledTimes(1);
  });

  it('without someone who did it (the system), no timeline line', async () => {
    const w = world();
    await w.statusChanged(task(), 'doing');
    expect(w.deps.record).not.toHaveBeenCalled();
    expect(w.deps.recipients).toHaveBeenCalledWith('t1', undefined);
  });
});
