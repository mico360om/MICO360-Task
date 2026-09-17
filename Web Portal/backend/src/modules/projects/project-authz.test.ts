import { describe, it, expect } from 'vitest';
import { createProjectAuthz, type ProjectManagerLookup } from './project-authz';

function authz(managerOf: Record<string, string[]> = {}, colProj: Record<string, string> = {}, taskProj: Record<string, string> = {}) {
  const managers: ProjectManagerLookup = {
    async isManager(userId, projectId) { return (managerOf[projectId] ?? []).includes(userId); },
    async projectIdOfColumn(columnId) { return colProj[columnId] ?? null; },
    async projectIdOfTask(taskId) { return taskProj[taskId] ?? null; },
  };
  return createProjectAuthz({ managers });
}

describe('project-authz', () => {
  it('admins can manage any project', async () => {
    const a = authz();
    expect(await a.canManageProject('u1', ['ADMIN'], 'p1')).toBe(true);
  });

  it('a project manager can manage only their project', async () => {
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
});
