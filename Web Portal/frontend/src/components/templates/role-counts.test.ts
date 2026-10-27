import { describe, it, expect } from 'vitest';
import { roleCounts } from './role-counts';

// The same cases as the server's template-service tests ("Rig 7"): its tasks' people, in order.
const assignments = [['omar', 'sara'], ['sara', 'omar'], ['layla'], []];
const people = ['omar', 'sara', 'layla'];

describe('what each role gets (the server’s rule)', () => {
  it('a task names the role of the first of its people who has one', () => {
    const c = roleCounts(assignments, people, { sara: 'Inspector' });
    expect(c.roles).toEqual([{ name: 'Inspector', tasks: 2 }]);
    expect(c.fromPerson.get('sara')).toBe(2);
    expect(c.unassigned).toBe(2);
  });

  it('two people with the same name make one role (its first spelling); the first person with a role wins', () => {
    const c = roleCounts(assignments, people, { omar: 'Site lead', sara: 'Inspector', layla: 'site LEAD' });
    expect(c.roles).toEqual([{ name: 'Site lead', tasks: 2 }, { name: 'Inspector', tasks: 1 }]);
    expect([c.fromPerson.get('omar'), c.fromPerson.get('sara'), c.fromPerson.get('layla')]).toEqual([1, 1, 1]);
    expect(c.unassigned).toBe(1);
  });

  it('a role nobody is first for gets nothing; blank names are no role', () => {
    const c = roleCounts([['omar', 'sara']], ['omar', 'sara'], { omar: 'Inspector', sara: 'Driver', layla: '  ' });
    expect(c.roles).toEqual([{ name: 'Inspector', tasks: 1 }, { name: 'Driver', tasks: 0 }]);
    expect(c.fromPerson.get('sara')).toBeUndefined();
  });
});
