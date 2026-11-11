import { describe, expect, it } from 'vitest';
import { releaseOf, stampDueChange, type StampDeps } from './kpi-stamps';

// `boss` is an administrator; `mgr` runs p1; `ann` is on t1; `mgr` was once on t2.
const deps: StampDeps = {
  isAdmin: async (u) => u === 'boss',
  runsProject: async (u, p) => u === 'mgr' && p === 'p1',
  everOnTask: async (t, u) => (t === 't1' && u === 'ann') || (t === 't2' && u === 'mgr'),
};
const meta = () => ({ changes: [{ field: 'title', from: 'a', to: 'b' }, { field: 'dueDate', from: '2026-11-10', to: '2026-11-20' }] });
const agreedOf = async (actorId: string, taskId = 't1', projectId = 'p1') => ((await stampDueChange(meta(), { actorId, taskId, projectId }, deps)).changes[1] as Record<string, unknown>).agreed;

describe('stamping a due-date change when it is made', () => {
  it('whoever runs the project (never on the task) and administrators agree an extension', async () => {
    expect(await agreedOf('mgr')).toBe(true);
    expect(await agreedOf('boss')).toBe(true);
  });

  it('the assignee, a colleague, a runner who was ever on the task, or a runner of another project don’t', async () => {
    expect(await agreedOf('ann')).toBe(false);
    expect(await agreedOf('bob')).toBe(false);
    expect(await agreedOf('mgr', 't2')).toBe(false);
    expect(await agreedOf('mgr', 't1', 'p2')).toBe(false);
  });

  it('other changes are left as they are; no due-date change, no mark', async () => {
    const out = await stampDueChange(meta(), { actorId: 'mgr', taskId: 't1', projectId: 'p1' }, deps);
    expect(out.changes[0]).toEqual({ field: 'title', from: 'a', to: 'b' });
    const none = await stampDueChange({ changes: [{ field: 'title', from: 'a', to: 'b' }] }, { actorId: 'mgr', taskId: 't1', projectId: 'p1' }, deps);
    expect(none.changes[0]).not.toHaveProperty('agreed');
  });
});

describe('stamping a taking-off', () => {
  it('released by whoever runs the project or an administrator, of someone else; never by taking yourself off', async () => {
    expect(await releaseOf({ actorId: 'mgr', assigneeId: 'ann', projectId: 'p1' }, deps)).toBe(true);
    expect(await releaseOf({ actorId: 'boss', assigneeId: 'ann', projectId: 'p1' }, deps)).toBe(true);
    expect(await releaseOf({ actorId: 'ann', assigneeId: 'ann', projectId: 'p1' }, deps)).toBe(false);
    expect(await releaseOf({ actorId: 'mgr', assigneeId: 'mgr', projectId: 'p1' }, deps)).toBe(false);
    expect(await releaseOf({ actorId: 'bob', assigneeId: 'ann', projectId: 'p1' }, deps)).toBe(false);
  });
});
