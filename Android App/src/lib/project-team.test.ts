import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';
import { addableUsers, canCreateProject, canManageProject, memberLabel, memberProblem, membersInOrder, PROJECT_CHANGE_REFUSED, removeQuestion, roleAction, teamManagers } from './project-team';
import type { ApiMember } from './types';

const member = (id: string, role: 'MEMBER' | 'MANAGER', first = id, last = ''): ApiMember => ({ id, username: id.toLowerCase(), email: `${id}@x`, firstName: first, lastName: last, role });

describe('who may run the team', () => {
  const members = [member('u1', 'MANAGER'), member('u2', 'MEMBER')];

  it('without the server’s canManage (an older server): an administrator, or a MANAGER member of this project', () => {
    expect(canManageProject({ id: 'admin', roles: ['ADMIN'] }, {}, [])).toBe(true);
    expect(canManageProject({ id: 'u1', roles: ['EMPLOYEE'] }, undefined, members)).toBe(true);
    expect(canManageProject({ id: 'u2', roles: ['EMPLOYEE'] }, {}, members)).toBe(false);
    expect(canManageProject({ id: 'u9', roles: ['EMPLOYEE'] }, null, members)).toBe(false);
    expect(canManageProject(null, {}, members)).toBe(false);
  });
});

const emp = { id: 'u2', roles: ['EMPLOYEE'] };
it('the server’s canManage decides: owners and named managers too, not only MANAGER members', () => {
  expect(canManageProject(emp, { canManage: true }, [])).toBe(true);
  expect(canManageProject(emp, { canManage: false }, [{ id: 'u2', role: 'MANAGER' }])).toBe(false);
  expect(canManageProject(emp, {}, [{ id: 'u2', role: 'MANAGER' }])).toBe(true);
  expect(canManageProject({ id: 'a', roles: ['ADMIN'] }, { canManage: false })).toBe(true);
  expect(canManageProject(null, { canManage: true })).toBe(false);
});
it('anyone signed in may create a project', () => {
  expect(canCreateProject(emp)).toBe(true);
  expect(canCreateProject(null)).toBe(false);
});
describe.skipIf(!hasWeb('backend/src/modules/projects/project-routes.ts'))('the server’s words', () => {
  it('refuses a change in the server’s words', () => expect(readWeb('backend/src/modules/projects/project-routes.ts')).toContain(`export const CHANGE_REFUSED = '${PROJECT_CHANGE_REFUSED}';`));
});
it('nothing says only an administrator can create or change a project', () => {
  for (const f of ['screens/ProjectFormScreen.tsx', 'screens/ProjectsScreen.tsx', 'screens/ProjectDetailScreen.tsx', 'lib/project-list.ts', 'lib/board-columns.ts']) expect(src(f), f).not.toMatch(/Only an administrator (or a manager of this project )?can (create|change)/);
  expect(src('screens/ProjectFormScreen.tsx')).toMatch(/PROJECT_CHANGE_REFUSED/);
});
it('the screens ask the project (its canManage), not roles alone', () => {
  expect(src('screens/ProjectDetailScreen.tsx')).toMatch(/canManageProject\(user, project, members\)/);
  expect(src('screens/ProjectsScreen.tsx')).toMatch(/canCreateProject\(user\)/);
  expect(src('screens/ProjectsScreen.tsx')).toMatch(/canManageProject\(user, item\)/);
  expect(src('screens/ProjectFormScreen.tsx')).toMatch(/canManageProject\(user, project/);
  expect(src('screens/DashboardScreen.tsx')).toMatch(/roles\.includes\('ADMIN'\)/);
  expect(src('screens/TaskDetailScreen.tsx')).toMatch(/canDeleteTask\(session\?\.user \?\? null, projectQ\.data, members\)/);
  for (const f of ['screens/ProjectFormScreen.tsx', 'screens/ProjectsScreen.tsx', 'screens/ProjectDetailScreen.tsx', 'screens/DashboardScreen.tsx']) expect(src(f), f).not.toMatch(/canEditProject/);
});

describe('the team list', () => {
  it('puts managers first, then everyone by name', () => {
    const list = membersInOrder([member('u3', 'MEMBER', 'Zainab'), member('u1', 'MEMBER', 'Ali'), member('u2', 'MANAGER', 'Omar')]);
    expect(list.map((m) => m.id)).toEqual(['u2', 'u1', 'u3']);
  });

  it('names the project’s managers for the Overview, or says none is named', () => {
    expect(teamManagers([member('u2', 'MANAGER', 'Omar', 'Said'), member('u1', 'MEMBER', 'Ali')], 'Aisha')).toEqual({ names: ['Omar Said'], text: 'Omar Said' });
    expect(teamManagers([member('u1', 'MEMBER', 'Ali')], 'Aisha')).toEqual({ names: [], text: 'No manager named — owner · Aisha' });
  });

  it('reads each person with their username and role, and says which one is you', () => {
    expect(memberLabel(member('u2', 'MANAGER', 'Omar', 'Said'), 'u1')).toBe('Omar Said, @u2, project manager');
    expect(memberLabel(member('u1', 'MEMBER', 'Ali'), 'u1')).toBe('Ali, @u1, member, you');
  });

  it('offers to add only active people who aren’t on the team yet, by name', () => {
    const people = [
      { id: 'u1', username: 'ali', firstName: 'Ali', lastName: '' },
      { id: 'u4', username: 'zara', firstName: 'Zara', lastName: 'Khan' },
      { id: 'u5', username: 'basil', firstName: '', lastName: '' },
      { id: 'u6', username: 'gone', firstName: 'Gone', lastName: 'Away', active: false },
    ];
    expect(addableUsers(people, [member('u1', 'MEMBER')])).toEqual([
      { value: 'u5', label: 'basil', hint: '@basil' },
      { value: 'u4', label: 'Zara Khan', hint: '@zara' },
    ]);
  });
});

describe('changing the team', () => {
  it('offers the other role, named for TalkBack', () => {
    expect(roleAction(member('u2', 'MANAGER', 'Omar'))).toEqual({ role: 'MEMBER', label: 'Make member', a11y: 'Make Omar a member' });
    expect(roleAction(member('u1', 'MEMBER', 'Ali'))).toEqual({ role: 'MANAGER', label: 'Make manager', a11y: 'Make Ali a manager' });
  });

  it('asks before taking someone off, and warns you about yourself', () => {
    expect(removeQuestion(member('u2', 'MEMBER', 'Omar'), 'u1')).toEqual({ title: 'Remove Omar?', message: 'Omar is taken off this project and its tasks at once.' });
    expect(removeQuestion(member('u1', 'MANAGER', 'Ali'), 'u1')).toEqual({ title: 'Remove yourself?', message: 'You are taken off this project and its tasks at once, and may no longer see it.' });
  });

  it('says plainly why a change didn’t happen', () => {
    expect(memberProblem(new NetworkError('offline'), 'add')).toBe('You’re offline — the team can be changed when you’re connected.');
    expect(memberProblem(new NetworkError('slow', { timedOut: true }), 'remove')).toBe('The server didn’t answer in time. Pull down to see whether the change was made.');
    expect(memberProblem(new ApiError(403, 'FORBIDDEN', 'Only an admin or a manager of this project can do that.'), 'role')).toBe('Only an admin or a manager of this project can do that.');
    expect(memberProblem(new ApiError(500, 'ERROR', 'Request failed (500)'), 'add')).toBe('Couldn’t add the member. Please try again.');
    expect(memberProblem(new Error('x'), 'remove')).toBe('Couldn’t remove the member. Please try again.');
    expect(memberProblem(new ApiError(500, 'ERROR', 'Request failed (500)'), 'role')).toBe('Couldn’t change the role. Please try again.');
  });
});
