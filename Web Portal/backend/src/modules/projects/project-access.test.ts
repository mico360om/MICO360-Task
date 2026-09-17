import { describe, it, expect } from 'vitest';
import { createProjectAccess } from './project-access';

function make(
  memberOf: Record<string, string[]>,
  taskProject: Record<string, string>,
  columnProject: Record<string, string>,
  taskAssignees: Record<string, string[]> = {},
) {
  return createProjectAccess({
    projects: {
      async isAccessibleTo(projectId, userId) {
        return (memberOf[projectId] ?? []).includes(userId);
      },
      async listForUser(userId) {
        return Object.entries(memberOf)
          .filter(([, users]) => users.includes(userId))
          .map(([id]) => ({ id }));
      },
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

  it('lets an assignee view a task even in a project they don’t belong to', async () => {
    // emp1 is NOT a member of p2, but is assigned task t2.
    const withAssignee = make({ p1: ['emp1'], p2: ['emp2'] }, { t1: 'p1', t2: 'p2' }, { c1: 'p1' }, { t2: ['emp1'] });
    expect(await withAssignee.canViewTask('emp1', ['EMPLOYEE'], 't2')).toBe(true);
    // …but still can't view the project itself or an unassigned task there.
    expect(await withAssignee.canViewProject('emp1', ['EMPLOYEE'], 'p2')).toBe(false);
    expect(await withAssignee.canViewTask('emp1', ['EMPLOYEE'], 't1')).toBe(true); // owns via p1 membership
  });

  it('lists only the projects a user belongs to', async () => {
    expect(await access.accessibleProjectIds('emp1', ['EMPLOYEE'])).toEqual(['p1']);
    expect(await access.accessibleProjectIds('emp2', ['EMPLOYEE'])).toEqual(['p2']);
    expect(await access.accessibleProjectIds('nobody', ['EMPLOYEE'])).toEqual([]);
  });
});
