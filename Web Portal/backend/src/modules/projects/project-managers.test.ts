import { describe, it, expect } from 'vitest';
import { managedProjectsWhere, managesProject } from './project-managers';

describe('Who manages a project', () => {
  const project = { ownerId: 'owner', managerId: 'named', members: [{ userId: 'boss', role: 'MANAGER' }, { userId: 'mate', role: 'MEMBER' }] };

  it('its owner, its named manager and the managers on its team — not other members', () => {
    expect(managesProject(project, 'owner')).toBe(true);
    expect(managesProject(project, 'named')).toBe(true);
    expect(managesProject(project, 'boss')).toBe(true);
    expect(managesProject(project, 'mate')).toBe(false);
    expect(managesProject(project, 'stranger')).toBe(false);
    expect(managesProject({ ownerId: null, managerId: null, members: [] }, 'owner')).toBe(false);
  });

  it('the same rule as a database filter', () => {
    expect(managedProjectsWhere('u1')).toEqual({ OR: [{ ownerId: 'u1' }, { managerId: 'u1' }, { members: { some: { userId: 'u1', role: 'MANAGER' } } }] });
  });
});
