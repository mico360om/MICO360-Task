import { describe, it, expect } from 'vitest';
import { createProjectAccess } from './project-access';

function make(
  memberOf: Record<string, string[]>,
  taskProject: Record<string, string>,
  columnProject: Record<string, string>,
  taskAssignees: Record<string, string[]> = {},
  /** companies: each project's companies (a pick narrows lists to one). */
  companiesOf: Record<string, string[]> = {},
  /** 1.22: the administrators who turned on "Show my projects only". */
  myProjectsOnly: string[] = [],
  reads: string[] = [],
) {
  const inPick = (id: string, pick?: string | null) => !pick || (companiesOf[id] ?? []).includes(pick);
  return createProjectAccess({
    projects: {
      async isAccessibleTo(projectId, userId) {
        return (memberOf[projectId] ?? []).includes(userId);
      },
      async listForUser(userId, pick) {
        return Object.entries(memberOf)
          .filter(([id, users]) => users.includes(userId) && inPick(id, pick))
          .map(([id]) => ({ id }));
      },
      async list(pick) {
        return Object.keys(memberOf)
          .filter((id) => inPick(id, pick))
          .map((id) => ({ id }));
      },
      async listTeamOf(userId, pick) {
        return Object.entries(memberOf)
          .filter(([id, users]) => users.includes(userId) && inPick(id, pick))
          .map(([id]) => ({ id }));
      },
    },
    myProjectsOnly: async (userId) => {
      reads.push(userId);
      return myProjectsOnly.includes(userId);
    },
    managers: {
      async projectIdOfTask(taskId) {
        return taskProject[taskId] ?? null;
      },
      async projectIdOfColumn(columnId) {
        return columnProject[columnId] ?? null;
      },
    },
    assignees: {
      async isAssignee(taskId, userId) {
        return (taskAssignees[taskId] ?? []).includes(userId);
      },
    },
  });
}

describe('ProjectAccess', () => {
  const access = make({ p1: ['emp1'], p2: ['emp2'] }, { t1: 'p1', t2: 'p2' }, { c1: 'p1', c2: 'p2' });

  it('lets an admin view anything', async () => {
    expect(await access.canViewProject('x', ['ADMIN'], 'p2')).toBe(true);
    expect(await access.canViewTask('x', ['ADMIN'], 't2')).toBe(true);
    expect(await access.canViewColumn('x', ['ADMIN'], 'c2')).toBe(true);
    expect(await access.accessibleProjectIds('x', ['ADMIN'])).toBeNull();
  });

  it('lets a member view their own project, task and column', async () => {
    expect(await access.canViewProject('emp1', ['EMPLOYEE'], 'p1')).toBe(true);
    expect(await access.canViewTask('emp1', ['EMPLOYEE'], 't1')).toBe(true);
    expect(await access.canViewColumn('emp1', ['EMPLOYEE'], 'c1')).toBe(true);
  });

  it('blocks a non-member from another project, its tasks and columns', async () => {
    expect(await access.canViewProject('emp1', ['EMPLOYEE'], 'p2')).toBe(false);
    expect(await access.canViewTask('emp1', ['EMPLOYEE'], 't2')).toBe(false);
    expect(await access.canViewColumn('emp1', ['EMPLOYEE'], 'c2')).toBe(false);
  });

  it('denies view when the task/column has no resolvable project', async () => {
    expect(await access.canViewTask('emp1', ['EMPLOYEE'], 'ghost')).toBe(false);
    expect(await access.canViewColumn('emp1', ['EMPLOYEE'], 'ghost')).toBe(false);
  });

  it('does not let an assignment grant access to a project the user doesn’t belong to', async () => {
    // emp1 is NOT a member of p2 but is (still) assigned task t2 — e.g. they left the project.
    const withAssignee = make({ p1: ['emp1'], p2: ['emp2'] }, { t1: 'p1', t2: 'p2' }, { c1: 'p1' }, { t2: ['emp1'] });
    expect(await withAssignee.canViewTask('emp1', ['EMPLOYEE'], 't2')).toBe(false);
    expect(await withAssignee.canViewProject('emp1', ['EMPLOYEE'], 'p2')).toBe(false);
    expect(await withAssignee.canViewTask('emp1', ['EMPLOYEE'], 't1')).toBe(true); // via p1 membership
  });

  it('lists only the projects a user belongs to', async () => {
    expect(await access.accessibleProjectIds('emp1', ['EMPLOYEE'])).toEqual(['p1']);
    expect(await access.accessibleProjectIds('emp2', ['EMPLOYEE'])).toEqual(['p2']);
    expect(await access.accessibleProjectIds('nobody', ['EMPLOYEE'])).toEqual([]);
  });

  it('a picked company narrows the list; an admin with a pick gets that company’s projects, not “all”', async () => {
    const picked = make({ p1: ['emp1'], p2: ['emp1'], p3: ['emp2'] }, {}, {}, {}, { p1: ['A'], p2: ['B'], p3: ['A'] });
    expect(await picked.accessibleProjectIds('emp1', ['EMPLOYEE'], 'A')).toEqual(['p1']);
    expect(await picked.accessibleProjectIds('emp1', ['EMPLOYEE'], null)).toEqual(['p1', 'p2']);
    expect(await picked.accessibleProjectIds('x', ['ADMIN'], 'A')).toEqual(['p1', 'p3']);
    expect(await picked.accessibleProjectIds('x', ['ADMIN'], null)).toBeNull();
  });

  // 1.22 "Show my projects only": a list (the pick is named, even null) treats such an administrator
  // like a team member; an object check (no pick) stays admin-wide.
  it('an administrator with “Show my projects only” lists their own projects; object checks stay admin-wide', async () => {
    const reads: string[] = [];
    const a = make({ p1: ['boss', 'emp1'], p2: ['emp2'], p3: ['boss'] }, { t2: 'p2' }, { c2: 'p2' }, {}, { p1: ['A'], p2: ['A'], p3: ['B'] }, ['boss'], reads);
    expect(await a.accessibleProjectIds('boss', ['ADMIN'], null)).toEqual(['p1', 'p3']);
    expect(await a.accessibleProjectIds('boss', ['ADMIN'], 'A')).toEqual(['p1']); // with a pick both apply
    expect(await a.accessibleProjectIds('boss', ['ADMIN'], 'B')).toEqual(['p3']);
    // Object checks: one project, task or column by its link, and "may I use this project".
    expect(await a.accessibleProjectIds('boss', ['ADMIN'])).toBeNull();
    expect(await a.canViewProject('boss', ['ADMIN'], 'p2')).toBe(true);
    expect(await a.canViewTask('boss', ['ADMIN'], 't2')).toBe(true);
    expect(await a.canViewColumn('boss', ['ADMIN'], 'c2')).toBe(true);
    // Another administrator (setting off) still lists everything.
    expect(await a.accessibleProjectIds('other', ['ADMIN'], null)).toBeNull();
    expect(await a.accessibleProjectIds('other', ['ADMIN'], 'A')).toEqual(['p1', 'p2']);
    // Employees always list by the team rule: their setting is never even read.
    reads.length = 0;
    expect(await a.accessibleProjectIds('emp1', ['EMPLOYEE'], null)).toEqual(['p1']);
    expect(reads).toEqual([]);
  });
});
