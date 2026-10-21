import { describe, it, expect } from 'vitest';
import { ApiError, NetworkError } from './api-client';
import { addableUsers, canEditProject, canManageProject, memberLabel, memberProblem, membersInOrder, removeQuestion, roleAction, teamManagers } from './project-team';
import type { ApiMember } from './types';

const member = (id: string, role: 'MEMBER' | 'MANAGER', first = id, last = ''): ApiMember => ({ id, username: id.toLowerCase(), email: `${id}@x`, firstName: first, lastName: last, role });

describe('who may run the team', () => {
  const members = [member('u1', 'MANAGER'), member('u2', 'MEMBER')];

  it('is the server’s rule: an administrator, or a manager of this project', () => {
    expect(canManageProject({ id: 'admin', roles: ['ADMIN'] }, [])).toBe(true);
    expect(canManageProject({ id: 'u1', roles: ['EMPLOYEE'] }, members)).toBe(true);
    expect(canManageProject({ id: 'u2', roles: ['EMPLOYEE'] }, members)).toBe(false);
    expect(canManageProject({ id: 'u9', roles: ['EMPLOYEE'] }, members)).toBe(false);
    expect(canManageProject(null, members)).toBe(false);
  });

  it('lets only an administrator change the project itself (the server refuses anyone else)', () => {
    expect(canEditProject({ id: 'a', roles: ['ADMIN'] })).toBe(true);
    expect(canEditProject({ id: 'u1', roles: ['EMPLOYEE'] })).toBe(false);
    expect(canEditProject(null)).toBe(false);
  });
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
