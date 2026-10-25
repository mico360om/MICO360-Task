import { describe, it, expect } from 'vitest';
import { createProjectAuthz, type ProjectManagerLookup } from './project-authz';

/** `runs[projectId]` = who runs it: its owner, its named manager or a MANAGER member (project-managers). */
function authz(runs: Record<string, string[]> = {}, colProj: Record<string, string> = {}, taskProj: Record<string, string> = {}, opts: { batch?: boolean } = {}) {
  const asked: string[][] = [];
  const managers: ProjectManagerLookup = {
    async managesProject(userId, projectId) { return (runs[projectId] ?? []).includes(userId); },
    async projectIdOfColumn(columnId) { return colProj[columnId] ?? null; },
    async projectIdOfTask(taskId) { return taskProj[taskId] ?? null; },
    ...(opts.batch
      ? {
          async managedAmong(userId: string, projectIds: string[]) {
            asked.push(projectIds);
            return projectIds.filter((id) => (runs[id] ?? []).includes(userId));
          },
        }
      : {}),
  };
  return { ...createProjectAuthz({ managers }), asked };
}

describe('project-authz', () => {
  it('admins can manage any project', async () => {
    const a = authz();
    expect(await a.canManageProject('u1', ['ADMIN'], 'p1')).toBe(true);
  });

  it('someone who runs a project can manage only that project', async () => {
    const a = authz({ p1: ['u1'] });
    expect(await a.canManageProject('u1', ['EMPLOYEE'], 'p1')).toBe(true);
    expect(await a.canManageProject('u1', ['EMPLOYEE'], 'p2')).toBe(false);
    expect(await a.canManageProject('u2', ['EMPLOYEE'], 'p1')).toBe(false);
  });

  it('resolves the project for a column and checks management', async () => {
    const a = authz({ p1: ['u1'] }, { c1: 'p1', c2: 'p2' });
    expect(await a.canManageColumn('u1', ['EMPLOYEE'], 'c1')).toBe(true);
    expect(await a.canManageColumn('u1', ['EMPLOYEE'], 'c2')).toBe(false);
    expect(await a.canManageColumn('u1', ['EMPLOYEE'], 'unknown')).toBe(false);
  });

  it('resolves the project for a task and checks management', async () => {
    const a = authz({ p1: ['u1'] }, {}, { t1: 'p1' });
    expect(await a.canManageTask('u1', ['EMPLOYEE'], 't1')).toBe(true);
    expect(await a.canManageTask('u2', ['EMPLOYEE'], 't1')).toBe(false);
    expect(await a.canManageTask('admin', ['ADMIN'], 't1')).toBe(true);
  });

  it('says which of a list of projects someone may manage, in one lookup when it can', async () => {
    const batched = authz({ p1: ['u1'], p3: ['u1', 'u2'] }, {}, {}, { batch: true });
    expect([...(await batched.manageableProjectIds('u1', ['EMPLOYEE'], ['p1', 'p2', 'p3']))].sort()).toEqual(['p1', 'p3']);
    expect(batched.asked).toEqual([['p1', 'p2', 'p3']]);
    expect([...(await batched.manageableProjectIds('boss', ['ADMIN'], ['p1', 'p2']))].sort()).toEqual(['p1', 'p2']);
    expect((await batched.manageableProjectIds('u1', ['EMPLOYEE'], [])).size).toBe(0);
    // Without a batch lookup, one question per project gives the same answer.
    const single = authz({ p1: ['u1'] });
    expect([...(await single.manageableProjectIds('u1', ['EMPLOYEE'], ['p1', 'p2']))]).toEqual(['p1']);
  });
});
